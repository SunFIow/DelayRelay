import { randomBytes } from 'crypto';
import net from 'net';
import { decodeAmf0Cmd } from '../../copyof-node-media-server/src/protocol/amf.js';
import Rtmp, { RtmpPacket } from '../../copyof-node-media-server/src/protocol/rtmp.js';
import { LOGGER } from '../logger.js';
import { RTMP_TYPE_FLEX_MESSAGE, RTMP_TYPE_FLEX_STREAM } from '../parsing.js';
import { RTMP_HANDSHAKE_0, RTMP_HANDSHAKE_1, RTMP_HANDSHAKE_2, RTMP_HANDSHAKE_SIZE, RTMP_HANDSHAKE_UNINIT } from './consts.js';

/**
 * @typedef InvokeMessage
 * @property { string | *} cmd
 * @property {*} value
 */

/**
 * RtmpClient
 * - performs a minimal RTMP client handshake (simple mode)
 * - uses the local copy of `Rtmp` helpers to emit RTMP control messages (chunk-size, connect, createStream, publish)
 * - exposes write(buffer) to forward already-chunked RTMP data to the remote
 *
 * Limitations / notes:
 * - This implementation performs a best-effort handshake and issues connect/createStream/publish
 *   but it does not fully await or validate server _result responses. A robust implementation
 *   should parse server responses and use the returned stream id when publishing.
 * - We intentionally avoid modifying `copyof-node-media-server/` code; we only reuse exported helpers.
 */
export class RtmpClient {
	constructor({ name = 'remote', host = '127.0.0.1', port = 1935, app = 'app', streamName = '', streamKey = '' } = {}) {
		this.name = name;
		this.host = host;
		this.port = port;
		this.app = app;
		this.streamName = streamName;
		this.streamKey = streamKey;

		this.ended = false;

		this.remoteSocket = null;
		this.rtmpRemote = null;
		this.rtmpResponse = null;
		this.connected = false;
		this.handshakeState = RTMP_HANDSHAKE_UNINIT;
		this.handShakeBuffer = Buffer.alloc(0);

		this.reconnectDelay = 2000;
		this._reconnectTimer = null;

		this.transId = 1;
		this.streamId = 0; // optimistic default; should be replaced with server returned id
		this.pendingTrans = new Map();

		this.pendingInvokes = [];
	}

	/**
	 * @param {{cmd: (* | string | string | *), value: *}}invokeMessage
	 */
	onCommand(invokeMessage) {
		switch (invokeMessage.cmd) {
			case 'connect':
				this.connectCommand = invokeMessage;
				this.app = invokeMessage.cmdObj.app;
				this.app_type = invokeMessage.cmdObj.type;
				this.flashVer = invokeMessage.cmdObj.flashVer;
				this.objectEncoding = invokeMessage.cmdObj.objectEncoding;
				this._sendConnect();
				break;
			case 'createStream':
				this._sendCreateStream();
				break;
			case 'publish':
				this.streamName = invokeMessage.streamName;
				this.type = invokeMessage.type;
				this._sendPublish();
				break;
			default:
				LOGGER.warn(`[RtmpClient:${this.name}/${this.streamId}] Unknown command`, invokeMessage);
				this._sendInvokeMessage(invokeMessage);
				break;
		}
	}

	connect() {
		if (this.remoteSocket && !this.remoteSocket.destroyed) return;
		this.remoteSocket = new net.Socket();
		this.remoteSocket.setNoDelay(true);

		// route any RTMP-generated outbound bytes through socket
		this.remoteSocket.once('connect', () => {
			LOGGER.info(`[RtmpClient:${this.name}] TCP connected to ${this.host}:${this.port}`);
			this.connected = true;
			this.reconnectDelay = 2000;
			this._beginHandshake();
		});

		this.remoteSocket.on('error', err => {
			LOGGER.error(`[RtmpClient:${this.name}] Socket error: ${err?.message || err}`);
		});

		this.remoteSocket.on('close', hadError => {
			LOGGER.warn(`[RtmpClient:${this.name}] Socket closed (error=${hadError})`);
			this.connected = false;
			this._scheduleReconnect();
		});

		this.remoteSocket.on('data', data => this._onRemoteData(data));

		this.rtmpRemote = new Rtmp();
		this.rtmpRemote.onConnectCallback = () => LOGGER.info('[Client > Server] RTMP Connected');
		this.rtmpRemote.onPlayCallback = () => LOGGER.info('[Client > Server] RTMP Playing');
		this.rtmpRemote.onPushCallback = () => LOGGER.info('[Client > Server] RTMP Pushing');
		this.rtmpRemote.onPacketCallback = pkt => LOGGER.debug('[Client > Server] RTMP Packet:', pkt);
		this.rtmpRemote.onOutputCallback = buf => {
			LOGGER.debug('[Client > Server] RTMP Result:', buf.length);
			this.write(buf);
		};

		this.rtmpResponse = new Rtmp();
		// Override invokeHandler on the rtmpResult parser so we can handle server-side responses
		// (e.g., _result, _error, onStatus) and resolve pending transactions.
		this.rtmpResponse.invokeHandler = () => this._invokeHandler(this.rtmpResponse.parserPacket);

		try {
			this.remoteSocket.connect(this.port, this.host);
		} catch (e) {
			LOGGER.error(`[RtmpClient:${this.name}] Connect failed: ${e}`);
			this._scheduleReconnect();
		}
	}

	_scheduleReconnect() {
		if (this.ended) return;
		if (this._reconnectTimer) {
			LOGGER.warn(`[RtmpClient:${this.name}] Reconnect already scheduled, skipping`);
			return;
		}
		LOGGER.info(`[RtmpClient:${this.name}] Scheduling reconnect in ${this.reconnectDelay}ms`);
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null;
			this.connect();
		}, this.reconnectDelay);
		// exponential backoff up to 1min
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
	}

	sendChunk({ chunk, id }) {
		if (this.remoteSocket?.writable) {
			LOGGER.debug(`[RtmpClient:${this.name}] [Flush] Sending [${id}] ${chunk.length} bytes to Remote`);
			this.remoteSocket.write(chunk);
		} else {
			LOGGER.warn(`[RtmpClient:${this.name}] [Flush] Remote socket not writable, skipping chunk [${id}]`);
		}
	}

	/**  @param {Buffer} data */
	_onRemoteData(data) {
		LOGGER.info(`[RtmpClient:${this.name}/${this.streamId}] Received data`, data.length);

		// accumulate handshake data
		if (this.handshakeState < RTMP_HANDSHAKE_1) this.handShakeBuffer = Buffer.concat([this.handShakeBuffer, data]);

		switch (this.handshakeState) {
			case RTMP_HANDSHAKE_UNINIT: // Did not start handshake
				break;
			case RTMP_HANDSHAKE_0: // Sent C0+C1 => Received S0+S1+S2
				if (this.handShakeBuffer.length >= this._handshakeExpected) {
					// Extract S0,S1,S2
					this._completeHandshake();
				}
				break;
			case RTMP_HANDSHAKE_1: // Completed handshake
				// Parse RTMP messages
				LOGGER.info(`[RtmpClient:${this.name}] parsing remote response`, data.length);
				this.rtmpResponse.parserData(data);
				break;
			default:
				LOGGER.warn(`[RtmpClient:${this.name}] Unexpected handshake state: ${this.handshakeState}`);
				break;
		}
	}

	_beginHandshake() {
		LOGGER.info(`[RtmpClient:${this.name}] Begin Handshake (simple mode)`);
		// Minimal RTMP handshake: send C0 + C1 (simple random)
		const c0 = Buffer.from([3]);
		const c1 = Buffer.alloc(8);
		const now = Math.floor(Date.now() / 1000);
		c1.writeUInt32BE(now, 0);
		c1.writeUInt32BE(0, 4);
		const rndmBytes = randomBytes(RTMP_HANDSHAKE_SIZE - 8);
		try {
			this.remoteSocket.write(Buffer.concat([c0, c1, rndmBytes]));
			// set state to expect S0+S1+S2
			this._handshakeExpected = 1 + RTMP_HANDSHAKE_SIZE + RTMP_HANDSHAKE_SIZE;
			this.handShakeBuffer = Buffer.alloc(0);
			this.handshakeState = RTMP_HANDSHAKE_0;
		} catch (e) {
			LOGGER.error(`[RtmpClient:${this.name}] Handshake write failed: ${e}`);
		}
	}

	/** Handle S0, S1, S3 messages */
	_completeHandshake() {
		LOGGER.info(`[RtmpClient:${this.name}] Complete Handshake (simple mode)`);
		const s0 = this.handShakeBuffer.subarray(0, 1);
		const s1 = this.handShakeBuffer.subarray(1, 1 + RTMP_HANDSHAKE_SIZE);
		const s2 = this.handShakeBuffer.subarray(1 + RTMP_HANDSHAKE_SIZE, 1 + RTMP_HANDSHAKE_SIZE + RTMP_HANDSHAKE_SIZE);
		// TODO: validate S1 is our sent C1
		// Send S1 as C2 (standard client response)
		try {
			this.remoteSocket.write(s1);
			// leave any extra bytes in buffer for RTMP parser
			this.rtmpResponse.handshakeState = RTMP_HANDSHAKE_2;
			LOGGER.info(`[RtmpClient:${this.name}] Handshake completed (simple mode)`);

			const rtmpPayload = this.handShakeBuffer.subarray(1 + RTMP_HANDSHAKE_SIZE + RTMP_HANDSHAKE_SIZE);
			LOGGER.info(`[RtmpClient:${this.name}] RTMP payload after Handshake`, rtmpPayload.length);
			this.rtmpResponse.parserData(rtmpPayload);

			// send initial RTMP control messages via helper Rtmp instance
			this._afterHandshake();
			this.handshakeState = RTMP_HANDSHAKE_1;
		} catch (e) {
			LOGGER.error(`[RtmpClient:${this.name}] Failed to send C2: ${e}`);
		}
	}

	/** Handle post-handshake initialization */
	_afterHandshake() {
		// Use Rtmp helper to emit control messages to the socket
		try {
			// ask for large chunks
			this.rtmpRemote.sendWindowACK(5000000);
			this.rtmpRemote.setPeerBandwidth(5000000, 2);
			this.rtmpRemote.setChunkSize(4096);

			if (this.pendingInvokes.length > 0) LOGGER.info(`[RtmpClient:${this.name}] Processing pending invoke messages`);
			while (this.pendingInvokes.length > 0) {
				const invoke = this.pendingInvokes.shift();
				LOGGER.info(`[RtmpClient:${this.name}/${this.streamId}] Sending pending invoke message`, invoke);
				this.rtmpRemote.sendInvokeMessage(this.streamId, invoke);
			}
		} catch (error) {
			LOGGER.error(`[RtmpClient:${this.name}/${this.streamId}] Failed to send post-handshake messages: ${error}`);
		}
	}

	_sendConnect() {
		// connect command (fire-and-forget)
		const tcUrl = `rtmp://${this.host}:${this.port}/${this.app}`;
		const connectOpt = {
			cmd: 'connect',
			cmdObj: {
				app: this.app,
				type: this.app_type ?? 'nonprivate',
				flashVer: this.flashVer ?? 'FMLE/3.0 (compatible; DelayRelay)',
				swfUrl: tcUrl,
				tcUrl: tcUrl
			}
		};
		if (this.objectEncoding) connectOpt.cmdObj.objectEncoding = this.objectEncoding;

		this._sendInvokeAwaitResult(connectOpt)
			.then(result => {
				this.remoteConnected = true;
				LOGGER.trace(`[RtmpClient:${this.name}] connect _result received`);
			})
			.catch(error => LOGGER.warn(`[RtmpClient:${this.name}] connect failed - ${error}`));
	}

	_sendCreateStream() {
		// createStream and await result so we can use the returned stream id
		const createStreamOpt = {
			cmd: 'createStream',
			cmdObj: null
		};
		this._sendInvokeAwaitResult(createStreamOpt)
			.then(result => {
				// the createStream result often returns a numeric stream id in `info` or as a value
				if (result) {
					if (typeof result.info === 'number') this.streamId = result.info;
					else if (Array.isArray(result.info) && typeof result.info[0] === 'number') this.streamId = result.info[0];
					else if (result.info && typeof result.info === 'object' && typeof result.info.streamId === 'number') this.streamId = result.info.streamId;
					else if (typeof result === 'number') this.streamId = result;
				}
				LOGGER.info(`[RtmpClient:${this.name}] createStream resolved -> streamId=${this.streamId}`);
			})
			.catch(error => {
				LOGGER.error(`[RtmpClient:${this.name}] createStream failed -  ${error}`);
			});
	}

	_sendPublish() {
		// Now publish using the returned stream id
		const publishName = this.streamKey ? `${this.streamName}?${this.streamKey}` : this.streamName;
		const publishOpt = {
			cmd: 'publish',
			cmdObj: null,
			streamName: publishName,
			type: this.type ?? 'live'
		};
		this._sendInvokeMessage(publishOpt);
	}

	_sendInvokeMessage(opt, transId = this.transId++) {
		opt.transId = transId;

		if (this.handshakeState < RTMP_HANDSHAKE_1) {
			// If handshake is not done, we can't send invoke messages
			LOGGER.warn(`[RtmpClient:${this.name}] Handshake not done, cannot send invoke message`, opt.cmd);
			// Instead we add them to a queue
			this.pendingInvokes.push(opt);
		} else {
			// If handshake is done, send the invoke message immediately
			LOGGER.trace(`[RtmpClient:${this.name}/${this.streamId}] Sending invoke`, opt);
			this.rtmpRemote.sendInvokeMessage(this.streamId, opt);
		}
	}

	/** Send an invoke message using rtmp helper and return a Promise resolved when _result/_error arrives
	 */
	_sendInvokeAwaitResult(opt, timeoutMs = 5000) {
		return new Promise((resolve, reject) => {
			const tid = this.transId;
			const pending = { cmd: opt.cmd, resolve, reject, timer: null };
			this.pendingTrans.set(tid, pending);
			this._sendInvokeMessage(opt, tid);
			pending.timer = setTimeout(() => {
				if (this.pendingTrans.has(tid)) {
					this.pendingTrans.delete(tid);
					reject(new Error('timeout waiting for _result'));
				}
			}, timeoutMs);
			// When resolved/rejected, clear timer via the resolve/reject callers in invokeHandler
		});
	}

	write(buffer) {
		// LOGGER.trace(`[RtmpClient:${this.name}] write: ${buffer.length} bytes`);
		if (!this.remoteSocket || this.remoteSocket.destroyed) {
			// LOGGER.warn(`[RtmpClient:${this.name}] write called but socket not connected`);
			return false;
		}
		try {
			// LOGGER.trace(`[RtmpClient:${this.name}] writing: ${buffer.length} bytes`);
			return this.remoteSocket.write(buffer);
		} catch (e) {
			LOGGER.error(`[RtmpClient:${this.name}] Failed to write buffer: ${e}`);
			return false;
		}
	}

	/** @param {RtmpPacket} parserPacket */
	_invokeHandler(parserPacket) {
		if (parserPacket.header.type === RTMP_TYPE_FLEX_STREAM) LOGGER.trace('[RtmpClient] Received FLEX_STREAM message');
		if (parserPacket.header.type === RTMP_TYPE_FLEX_MESSAGE) LOGGER.trace('[RtmpClient] Received FLEX_MESSAGE message');

		const offset = parserPacket.header.type === RTMP_TYPE_FLEX_MESSAGE ? 1 : 0; // FLEX message uses 1-byte prefix TODO: maybe should be flex_stream
		const payload = parserPacket.payload.subarray(offset, parserPacket.header.length);
		const invokeMessage = decodeAmf0Cmd(payload);
		const cmd = invokeMessage.cmd;
		// Debug
		LOGGER.info(`[RtmpClient:${this.name}/${this.streamId}] Received invoke: ${cmd} transId=${invokeMessage.transId}`);
		const tid = invokeMessage.transId;
		const pending = this.pendingTrans.get(tid);
		if (pending) LOGGER.info({ ...pending, timer: undefined });
		else LOGGER.warn(`[RtmpClient:${this.name}] No pending transaction found for transId=${tid}`);
		switch (cmd) {
			case '_result':
				if (pending) {
					this.pendingTrans.delete(tid);
					if (pending.resolve) pending.resolve(invokeMessage);
				}
				break;
			case '_error':
				if (pending) {
					this.pendingTrans.delete(tid);
					if (pending.reject) pending.reject(invokeMessage);
				}
				break;
			case 'onStatus':
				LOGGER.trace(`[RtmpClient:${this.name}] onStatus: ${JSON.stringify(invokeMessage)}`);
				break;
			default:
				LOGGER.warn(`[RtmpClient:${this.name}] Unknown invoke: ${cmd}`);
				break;
		}
	}

	close() {
		this.ended = true;
		try {
			if (this.remoteSocket) {
				this.remoteSocket.end();
				this.remoteSocket.destroy();
			}
		} catch (e) {
			/* ignore */
		}
		if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
		this._reconnectTimer = null;
	}
}

export default RtmpClient;
