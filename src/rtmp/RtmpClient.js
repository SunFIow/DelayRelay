import net from 'net';
import { decodeAmf0Cmd } from '../../copyof-node-media-server/src/protocol/amf.js';
import { LOGGER } from '../logger.js';
import { CodecType, RTMP_HANDSHAKE_COMP, RTMP_HANDSHAKE_UNINIT } from './consts.js';
import { RtmpImpl, generateC0C1 } from './RtmpImpl.js';

/**
 * @typedef CommandMessage
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
export class RtmpClient extends RtmpImpl {
	constructor({ name = 'remote', host = '127.0.0.1', port = 1935, app = 'app', streamName = '', streamKey = '' } = {}) {
		super({ name, role: 'client' });
		this.name = name;
		this.host = host;
		this.port = port;
		this.app = app;
		this.streamName = streamName;
		this.streamKey = streamKey;

		this.ended = false;

		this.transId = 1;
		this.streamId = 0; // optimistic default; should be replaced with server returned id
		this.pendingTrans = new Map();

		this.pendingCommands = [];

		this.connected = false;
		this.reconnectDelay = 2000;
		this.reconnectTimer = null;

		this.remoteSocket = new net.Socket();
		this.remoteSocket.setNoDelay(true);

		// route any RTMP-generated outbound bytes through socket
		this.remoteSocket.once('connect', () => {
			LOGGER.info(`[RtmpClient:${this.name}] TCP connected to ${this.host}:${this.port}`);
			this.connected = true;
			this.reconnectDelay = 2000;
			this.beginHandshake();
		});

		this.remoteSocket.on('error', err => {
			LOGGER.error(`[RtmpClient:${this.name}] Socket error: ${err?.message || err}`);
		});

		this.remoteSocket.on('close', hadError => {
			LOGGER.warn(`[RtmpClient:${this.name}] Socket closed (error=${hadError})`);
			this.connected = false;
			this.scheduleReconnect();
		});

		this.remoteSocket.on('data', data => {
			LOGGER.info(`[RtmpClient:${this.name}/${this.streamId}] Received data`, data.length);
			this.feed(data);
		});

		this.initEvents();
	}

	initEvents() {
		this.once('completedHandshake', () => this.afterHandshake());
		this.on('response', chunks => this.write(chunks));

		this.on('cmd:_result', command => this.handlePendingCommand(command, true));
		this.on('cmd:_error', command => this.handlePendingCommand(command, false));
		this.on('cmd:onStatus', command => LOGGER.trace(`[RtmpClient:${this.name}] onStatus: ${JSON.stringify(command)}`));

		this.on('command', command => LOGGER.trace(`[RtmpClient:${this.name}/${this.streamId}] Received command: ${command.cmd} transId=${command.transId}`));
	}

	/**
	 * @param {{cmd: (* | string | string | *), value: *}}commandMessage
	 */
	relayCommand(commandMessage) {
		try {
			switch (commandMessage.cmd) {
				case 'connect':
					this.connectCommand = commandMessage;
					this.app = commandMessage.cmdObj.app;
					this.app_type = commandMessage.cmdObj.type;
					this.flashVer = commandMessage.cmdObj.flashVer;
					this.objectEncoding = commandMessage.cmdObj.objectEncoding;
					// this.beginHandshake();
					this.sendConnect();
					break;
				case 'createStream':
					this.sendCreateStream();
					break;
				case 'publish':
					this.streamName = commandMessage.streamName;
					this.type = commandMessage.type;
					this.sendPublish();
					break;
				default:
					LOGGER.warn(`[RtmpClient:${this.name}/${this.streamId}] Unknown command relaying as is`, commandMessage);
					this.handleCommandMessage(commandMessage);
					break;
			}
		} catch (error) {
			LOGGER.error(`[RtmpClient:${this.name}] Command handling error: ${error}`);
		}
	}

	connect() {
		if (!this.remoteSocket.pending) {
			LOGGER.warn(`[RtmpClient:${this.name}] Socket not pending, skipping connect`);
			return;
		}
		try {
			this.remoteSocket.connect(this.port, this.host);
		} catch (e) {
			LOGGER.error(`[RtmpClient:${this.name}] Connect failed: ${e}`);
			this.scheduleReconnect();
		}
	}

	scheduleReconnect() {
		if (this.ended) return;
		if (this.reconnectTimer) {
			LOGGER.warn(`[RtmpClient:${this.name}] Reconnect already scheduled, skipping`);
			return;
		}
		LOGGER.info(`[RtmpClient:${this.name}] Scheduling reconnect in ${this.reconnectDelay}ms`);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, this.reconnectDelay);
		// exponential backoff up to 1min
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
	}

	beginHandshake() {
		LOGGER.info(`[RtmpClient:${this.name}] Begin Handshake (simple mode)`);
		try {
			this.handshakeState = RTMP_HANDSHAKE_UNINIT;
			const c0c1 = generateC0C1();
			this.write(c0c1);
			// set state to expect S0+S1+S2
		} catch (e) {
			LOGGER.error(`[RtmpClient:${this.name}] Handshake write failed: ${e}`);
		}
	}

	/** Handle post-handshake initialization */
	afterHandshake() {
		// Use Rtmp helper to emit control messages to the socket
		try {
			// ask for large chunks
			this.sendWindowACK(5000000);
			this.setPeerBandwidth(5000000, 2);
			// LOGGER.info(`[RtmpClient:${this.name}] Setting chunk size`, this.outChunkSize);
			this.setChunkSize(this.outChunkSize);

			if (this.pendingCommands.length > 0) LOGGER.info(`[RtmpClient:${this.name}] Processing pending command messages`);
			while (this.pendingCommands.length > 0) {
				const command = this.pendingCommands.shift();
				LOGGER.info(`[RtmpClient:${this.name}/${this.streamId}] Sending pending command message`, command);
				this.sendCommandMessage(command, this.streamId);
			}
		} catch (error) {
			LOGGER.error(`[RtmpClient:${this.name}/${this.streamId}] Failed to send post-handshake messages: ${error}`);
		}
	}

	async sendConnect() {
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

		const response = await this.sendCommandMessageAsync(connectOpt);
		this.remoteConnected = true;
		LOGGER.trace(`[RtmpClient:${this.name}] connect _result received`, response);
	}

	async sendCreateStream() {
		// createStream and await result so we can use the returned stream id
		const createStreamOpt = {
			cmd: 'createStream',
			cmdObj: null
		};

		const response = await this.sendCommandMessageAsync(createStreamOpt);
		LOGGER.trace(`[RtmpClient:${this.name}] createStream _result received`, response);
		// the createStream result often returns a numeric stream id in `info` or as a value
		if (typeof response.info === 'number') this.streamId = response.info;
		else if (Array.isArray(response.info) && typeof response.info[0] === 'number') this.streamId = response.info[0];
		else if (response.info && typeof response.info === 'object' && typeof response.info.streamId === 'number') this.streamId = response.info.streamId;
		else if (typeof response === 'number') this.streamId = response;
		LOGGER.info(`[RtmpClient:${this.name}] createStream resolved -> streamId=${this.streamId}`);
	}

	sendPublish() {
		// Now publish using the returned stream id
		const publishName = this.streamKey ? `${this.streamName}?${this.streamKey}` : this.streamName;
		const publishOpt = {
			cmd: 'publish',
			cmdObj: null,
			streamName: publishName,
			type: this.type ?? 'live'
		};
		this.handleCommandMessage(publishOpt);
	}

	handleCommandMessage(opt, transId = this.transId++) {
		opt.transId = transId;

		if (this.handshakeState < RTMP_HANDSHAKE_COMP) {
			// If handshake is not done, we can't send invoke messages
			LOGGER.warn(`[RtmpClient:${this.name}] Handshake not done, cannot send invoke message`, opt.cmd);
			// Instead we add them to a queue
			this.pendingCommands.push(opt);
		} else {
			// If handshake is done, send the invoke message immediately
			LOGGER.trace(`[RtmpClient:${this.name}/${this.streamId}] Sending invoke`, opt);
			this.sendCommandMessage(opt, this.streamId);
		}
	}

	/** Send an RTMP command and wait for the server response.
	 *
	 * Resolves when a matching response (e.g. `_result`) is received for the
	 * transaction id, or rejects on `_error` responses or when the timeout elapses.
	 */
	sendCommandMessageAsync(opt, timeoutMs = 5000) {
		return new Promise((resolve, reject) => {
			const tid = this.transId++;
			const pending = { cmd: opt.cmd, resolve, reject, timer: null };
			this.pendingTrans.set(tid, pending);
			this.handleCommandMessage(opt, tid);
			pending.timer = setTimeout(() => {
				if (this.pendingTrans.has(tid)) {
					this.pendingTrans.delete(tid);
					reject(new Error(`Timeout waiting for ${opt.cmd}/${tid} response`));
				}
			}, timeoutMs);
		});
	}

	handlePendingCommand(commandMessage, isSuccess) {
		const tid = commandMessage.transId;
		const pending = this.pendingTrans.get(tid);
		if (pending) {
			LOGGER.info(`[RtmpClient:${this.name}] Response for pending command (${pending.cmd}) transId=${tid} - success=${isSuccess}`);
			this.pendingTrans.delete(tid);
			if (isSuccess) pending.resolve?.(commandMessage);
			else pending.reject?.(commandMessage);
		} else {
			LOGGER.warn(`[RtmpClient:${this.name}] No pending command for response with transId=${tid}`);
		}
	}

	/** @param {Buffer} buffer */
	write(buffer) {
		if (!this.remoteSocket || this.remoteSocket.destroyed) {
			LOGGER.warn(`[RtmpClient > ${this.name}] Socket not connected`);
			return false;
		}
		try {
			LOGGER.trace(`[RtmpClient > ${this.name}] ${buffer.length} bytes`);
			return this.remoteSocket.write(buffer);
		} catch (e) {
			LOGGER.error(`[RtmpClient > ${this.name}] Failed to write buffer: ${e}`);
			return false;
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
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
	}
}

export default RtmpClient;
