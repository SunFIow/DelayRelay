import net from 'net';
import Rtmp from '../../copyof-node-media-server/src/protocol/rtmp.js';
import { LOGGER } from '../logger.js';

/**
 * OutboundRtmpClient
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
export class OutboundRtmpClient {
	constructor({ name = 'remote', host = '127.0.0.1', port = 1935, app = '', streamName = '', streamKey = '' } = {}) {
		this.name = name;
		this.host = host;
		this.port = port;
		this.app = app;
		this.streamName = streamName;
		this.streamKey = streamKey;

		this.socket = null;
		this.rtmp = null;
		this.rtmpResult = null;
		this.connected = false;
		this.handshakeDone = false;
		this._recvBuffer = Buffer.alloc(0);

		this.reconnectDelay = 2000;
		this._reconnectTimer = null;

		this._transId = 1;
		this._streamId = 1; // optimistic default; should be replaced with server returned id
	}

	connect() {
		if (this.socket && !this.socket.destroyed) return;
		this.socket = new net.Socket();
		this.socket.setNoDelay(true);

		// route any RTMP-generated outbound bytes through socket
		this.socket.once('connect', () => {
			LOGGER.info(`[OutboundRtmpClient:${this.name}] TCP connected to ${this.host}:${this.port}`);
			this.connected = true;
			this._doHandshake();
		});

		this.socket.on('error', err => {
			LOGGER.error(`[OutboundRtmpClient:${this.name}] Socket error: ${err?.message || err}`);
		});

		this.socket.on('close', hadError => {
			LOGGER.warn(`[OutboundRtmpClient:${this.name}] Socket closed (error=${hadError})`);
			this.connected = false;
			this.handshakeDone = false;
			this._scheduleReconnect();
		});

		this.socket.on('data', d => {
			this.rtmpResult.parserData(d);
			this._onData(d);
		});

		this.rtmp = new Rtmp();
		this.rtmp.onConnectCallback = () => console.log('[Client > Server] RTMP Connected');
		this.rtmp.onPlayCallback = () => console.log('[Client > Server] RTMP Playing');
		this.rtmp.onPushCallback = () => console.log('[Client > Server] RTMP Pushing');
		this.rtmp.onPacketCallback = pkt => console.log('[Client > Server] RTMP Packet:', pkt);
		this.rtmp.onOutputCallback = buf => {
			console.log('[Client > Server] RTMP Result:', buf.length);
			this.write(buf);
		};

		this.rtmpResult = new Rtmp();
		this.rtmpResult.onConnectCallback = () => console.log('[Server > Client] RTMP Connected');
		this.rtmpResult.onPlayCallback = () => console.log('[Server > Client] RTMP Playing');
		this.rtmpResult.onPushCallback = () => console.log('[Server > Client] RTMP Pushing');
		this.rtmpResult.onPacketCallback = pkt => console.log('[Server > Client] RTMP Packet:', pkt);
		this.rtmpResult.onOutputCallback = buf => console.log('[Server > Client] RTMP Result:', buf.length);

		try {
			this.socket.connect(this.port, this.host);
		} catch (e) {
			LOGGER.error(`[OutboundRtmpClient:${this.name}] Connect failed: ${e}`);
			this._scheduleReconnect();
		}
	}

	_scheduleReconnect() {
		if (this._reconnectTimer) return;
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null;
			this.connect();
		}, this.reconnectDelay);
		// exponential backoff up to 1min
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
	}

	_doHandshake() {
		// Minimal RTMP handshake: send C0 + C1 (simple random)
		const c0 = Buffer.from([3]);
		const c1 = Buffer.alloc(1536);
		const now = Math.floor(Date.now() / 1000);
		c1.writeUInt32BE(now, 0);
		c1.writeUInt32BE(0, 4);
		// random rest
		for (let i = 8; i < 1536; i++) c1[i] = Math.floor(Math.random() * 256);
		try {
			this.socket.write(Buffer.concat([c0, c1]));
			// set state to expect S0+S1+S2
			this._handshakeExpected = 1 + 1536 + 1536;
			this._recvBuffer = Buffer.alloc(0);
		} catch (e) {
			LOGGER.error(`[OutboundRtmpClient:${this.name}] Handshake write failed: ${e}`);
		}
	}

	_onData(d) {
		// accumulate
		this._recvBuffer = Buffer.concat([this._recvBuffer, d]);

		if (!this.handshakeDone) {
			if (this._recvBuffer.length >= this._handshakeExpected) {
				// Extract S0,S1,S2
				const s0 = this._recvBuffer.slice(0, 1);
				const s1 = this._recvBuffer.slice(1, 1 + 1536);
				const s2 = this._recvBuffer.slice(1 + 1536, 1 + 1536 + 1536);
				// Send C2 as S1 (standard client response)
				try {
					this.socket.write(s1);
					this.handshakeDone = true;
					// leave any extra bytes in buffer for RTMP parser
					this._recvBuffer = this._recvBuffer.slice(1 + 1536 + 1536);
					LOGGER.info(`[OutboundRtmpClient:${this.name}] Handshake completed (simple mode)`);
					// send initial RTMP control messages via helper Rtmp instance
					this._afterHandshake();
				} catch (e) {
					LOGGER.error(`[OutboundRtmpClient:${this.name}] Failed to send C2: ${e}`);
				}
			}
			return;
		}

		// After handshake we don't parse server responses here. The local Rtmp instance
		// is used only as a generator for outbound control messages. Parsing server
		// responses would require a robust chunk parser and AMF handling; implement
		// that when we wire the client into the RTMP handling stack.
		// For now, keep the buffer trimmed so it doesn't grow unbounded.
		if (this._recvBuffer.length > 1024 * 1024) this._recvBuffer = this._recvBuffer.slice(-512 * 1024);
	}

	_afterHandshake() {
		// Use Rtmp helper to emit control messages to the socket
		try {
			// ask for large chunks
			this.rtmp.sendWindowACK(5000000);
			this.rtmp.setPeerBandwidth(5000000, 2);
			this.rtmp.setChunkSize(4096);

			// connect command
			const tcUrl = this.app ? `rtmp://${this.host}/${this.app}` : `rtmp://${this.host}/`;
			const connectOpt = {
				cmd: 'connect',
				transId: this._transId++,
				cmdObj: {
					app: this.app,
					flashVer: 'FMLE/3.0 (compatible; DelayRelay)',
					tcUrl: tcUrl,
					objectEncoding: 0
				}
			};
			this.rtmp.sendInvokeMessage(0, connectOpt);

			// createStream
			const createStreamOpt = { cmd: 'createStream', transId: this._transId++, cmdObj: null };
			this.rtmp.sendInvokeMessage(0, createStreamOpt);

			// publish (optimistic stream id)
			const publishName = this.streamKey ? `${this.streamName}?${this.streamKey}` : this.streamName;
			const publishOpt = { cmd: 'publish', transId: this._transId++, cmdObj: null, streamName: publishName, type: 'live' };
			this.rtmp.sendInvokeMessage(this._streamId, publishOpt);
		} catch (e) {
			LOGGER.error(`[OutboundRtmpClient:${this.name}] Error sending post-handshake messages: ${e}`);
		}
	}

	write(buffer) {
		if (!this.socket || this.socket.destroyed) {
			LOGGER.warn(`[OutboundRtmpClient:${this.name}] write called but socket not connected`);
			return false;
		}
		try {
			return this.socket.write(buffer);
		} catch (e) {
			LOGGER.error(`[OutboundRtmpClient:${this.name}] Failed to write buffer: ${e}`);
			return false;
		}
	}

	close() {
		try {
			if (this.socket) {
				this.socket.end();
				this.socket.destroy();
			}
		} catch (e) {
			/* ignore */
		}
		if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
		this._reconnectTimer = null;
	}
}

export default OutboundRtmpClient;
