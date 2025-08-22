import net from 'net';
import { dummyRemote, silentProxy } from '../config.js';
import { LOGGER } from '../logger.js';
import { RTMP_HANDSHAKE_UNINIT } from './consts.js';
import { DummyRemoteServer } from './DummyRemoteServer.js';
import { RtmpImpl, generateC0C1 } from './RtmpImpl.js';

const COMMANDS = {
	flow: ['handshake', 'connect', 'createStream', 'publish', 'stream'],
	connect: ['connect'],
	createStream: ['releaseStream', 'FCPublish', 'createStream'],
	publish: ['publish']
};
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
		this.streamId = 0; // optimistic default; should be replaced with server returned id

		this.ended = false;
		this.state = 'handshake';

		this.transId = 1;
		this.pendingTrans = new Map();

		this.pendingCommands = [];
		this.chunkQueue = [];

		this.connected = false;
		this.reconnectDelay = 2000;
		this.reconnectTimer = null;

		this.initRemote();
		this.initEvents();
	}

	initRemote() {
		this.remoteSocket = dummyRemote ? new DummyRemoteServer() : new net.Socket();
		this.remoteSocket.setNoDelay(true);

		// route any RTMP-generated outbound bytes through socket
		this.remoteSocket.on('connect', () => {
			LOGGER.info(`[RtmpClient:${this.name}] TCP connected to ${this.host}:${this.port}`);
			this.connected = true;
			this.reconnectDelay = 2000;
			LOGGER.info(`[RtmpClient:${this.name}] Begin Handshake (simple mode)`);
			try {
				this.handshakeState = RTMP_HANDSHAKE_UNINIT;
				const c0c1 = generateC0C1();
				if (!silentProxy) this.write(c0c1);
				// set state to expect S0+S1+S2
			} catch (e) {
				LOGGER.error(`[RtmpClient:${this.name}] Handshake write failed: ${e}`);
			}
			this.emit('connect');
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
			this.emit('data', data);
		});
	}

	initEvents() {
		this.on('response', chunks => {
			if (!silentProxy) this.write(chunks);
		});
		this.on('packet', packet => {
			LOGGER.trace(`[RtmpClient:${this.name}/${this.streamId}] Packet received ${packet.type}, ${packet.flags}, ${packet.payload.length}`);
		});

		this.on('command', command => LOGGER.trace(`[RtmpClient:${this.name}/${this.streamId}] Received command:`, command));
		this.on('cmd:_result', command => this.handlePendingCommand(command, true));
		this.on('cmd:_error', command => this.handlePendingCommand(command, false));
		this.on('cmd:onStatus', command => LOGGER.trace(`[RtmpClient:${this.name}] onStatus: ${JSON.stringify(command)}`));

		this.on('completedHandshake', () => {
			this.setChunkSize(this.outChunkSize);
			// this.sendWindowACK(2500000);
			// this.setPeerBandwidth(2500000, 2);
			// connect
			const readyCommands = this.pendingCommands.filter(c => COMMANDS.connect.includes(c.cmd));
			this.pendingCommands = this.pendingCommands.filter(c => !COMMANDS.connect.includes(c.cmd));
			for (const command of readyCommands) this.sendCommandMessage(command, this.streamId);
			this.state = 'connect';
		});

		this.on('ctrl:setPeerBandwidth', size => {
			LOGGER.info(`[RtmpClient:${this.name}] Set Peer Bandwidth: ${size}`);
			this.sendWindowACK(size);
		});

		this.on('cmd:_result:connect', response => {
			LOGGER.trace(`[RtmpClient:${this.name}] connect _result received`, response);

			this.remoteConnected = true;

			// releaseStream + FCPublish + createStream
			const readyCommands = this.pendingCommands.filter(c => COMMANDS.createStream.includes(c.cmd));
			this.pendingCommands = this.pendingCommands.filter(c => !COMMANDS.createStream.includes(c.cmd));
			for (const command of readyCommands) this.sendCommandMessage(command, this.streamId);
			this.state = 'createStream';
		});

		let createdStream = false;
		let waitOnStatus;
		this.on('cmd:_result:createStream', response => {
			LOGGER.info(`[RtmpClient:${this.name}] createStream _result received`, response);
			this.resultCreateStream(response);

			createdStream = true;
		});

		this.on('u:ctrl:streamBegin', () => {
			LOGGER.info(`[RtmpClient:${this.name}] Stream begin`, createdStream);
			if (!createdStream) return;

			// publish
			const readyCommands = this.pendingCommands.filter(c => COMMANDS.publish.includes(c.cmd));
			this.pendingCommands = this.pendingCommands.filter(c => !COMMANDS.publish.includes(c.cmd));
			for (const command of readyCommands) this.sendCommandMessage(command, this.streamId);

			this.state = 'publish';
		});

		this.on('cmd:onStatus', response => {
			if (waitOnStatus) {
				clearTimeout(waitOnStatus);
				waitOnStatus = null;
			}
			this.sessionId = response.info.sessionId;
			this.customerId = response.info.customerId;

			LOGGER.info(`[RtmpClient:${this.name}] Starting to send Audio/Video chunks ${this.chunkQueue.length}`);
			this.chunkQueue.forEach(chunk => this.write(chunk.data));
			this.chunkQueue = [];
		});
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
					this.handleCommandMessage(commandMessage);
					break;
			}
		} catch (error) {
			LOGGER.error(`[RtmpClient:${this.name}] Command handling error: ${error}`);
		}
	}

	sendChunk(chunk) {
		if (silentProxy) {
			this.write(chunk.data);
			return;
		}

		if (this.state != 'stream') {
			LOGGER.warn(`[RtmpClient:${this.name}] Received chunk[${chunk.id}](${chunk.codec}/${chunk.flags}) but not in stream state, queuing for later`);
			this.chunkQueue.push(chunk);
		} else {
			this.write(chunk.data);
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

	sendConnect() {
		// connect command (fire-and-forget)
		const tcUrl = `rtmp://${this.host}:${this.port}/${this.app}`;
		const connectOpt = {
			cmd: 'connect',
			transId: 0,
			cmdObj: {
				app: this.app,
				type: this.app_type ?? 'nonprivate',
				flashVer: this.flashVer ?? 'FMLE/3.0 (compatible; DelayRelay)',
				swfUrl: tcUrl,
				tcUrl: tcUrl
			}
		};
		if (this.objectEncoding) connectOpt.cmdObj.objectEncoding = this.objectEncoding;

		this.sendCommandMessageAsync(connectOpt);
	}

	sendCreateStream() {
		// createStream and await result so we can use the returned stream id
		const createStreamOpt = {
			cmd: 'createStream',
			transId: 0,
			cmdObj: null
		};
		this.sendCommandMessageAsync(createStreamOpt);
	}

	resultCreateStream(response) {
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
			transId: 0,
			cmdObj: null,
			streamName: publishName,
			type: this.type ?? 'live'
		};
		this.sendCommandMessageAsync(publishOpt);
		this.on('cmd:_result:publish', response => {
			LOGGER.trace(`[RtmpClient:${this.name}] publish _result received`, response);
		});
	}

	handleCommandMessage(opt, transId = this.transId++) {
		opt.transId = transId;

		let handled = false;
		let delay = false;
		for (const cState of COMMANDS.flow) {
			if (COMMANDS[cState]?.includes(opt.cmd)) {
				handled = true;
				if (delay) {
					LOGGER.warn(`[RtmpClient:${this.name}] Command ${opt.cmd} is out of order, queuing for later`, this.state);
					this.pendingCommands.push(opt);
				} else {
					LOGGER.trace(`[RtmpClient:${this.name}/${this.streamId}] Sending command`, opt);
					this.sendCommandMessage(opt, this.streamId);
				}
			}
			if (cState == this.state) delay = true;
		}
		if (!handled) {
			LOGGER.trace(`[RtmpClient:${this.name}/${this.streamId}] Command not handled, sending as is`, opt);
			this.sendCommandMessage(opt, this.streamId);
		}
	}

	/** Send an RTMP command and wait for the server response.
	 *
	 * Resolves when a matching response (e.g. `_result`) is received for the
	 * transaction id, or rejects on `_error` responses or when the timeout elapses.
	 */
	sendCommandMessageAsync(opt, timeoutMs = 5000) {
		const tid = this.transId++;
		const resolve = commandMessage => {
			clearTimeout(pending.timer);
			this.emit(`cmd:_result:${opt.cmd}`, commandMessage, opt);
		};
		const reject = commandMessage => {
			clearTimeout(pending.timer);
			this.emit(`cmd:_error:${opt.cmd}`, commandMessage, opt);
		};
		const pending = { cmd: opt.cmd, resolve, reject, timer: null };
		this.pendingTrans.set(tid, pending);
		this.handleCommandMessage(opt, tid);
		pending.timer = setTimeout(() => {
			if (this.pendingTrans.has(tid)) {
				this.pendingTrans.delete(tid);
				reject({ error: new Error(`Timeout waiting for ${opt.cmd}/${tid} response`) }, opt);
			}
		}, timeoutMs);
	}

	handlePendingCommand(commandMessage, isSuccess) {
		const tid = commandMessage.transId;
		const pending = this.pendingTrans.get(tid);
		if (pending) {
			LOGGER.info(`[RtmpClient:${this.name}] Response for pending command (${pending.cmd}) transId=${tid} - success=${isSuccess}`);
			this.pendingTrans.delete(tid);
			if (isSuccess) pending.resolve(commandMessage);
			else pending.reject(commandMessage);
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
