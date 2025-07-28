import net from 'net';
import Rtmp from 'node-media-server/src/protocol/rtmp.js';
import { config } from './config.js';
import { LOGGER } from './logger.js';
import { StreamBuffer } from './streamBuffer.js';

/**
 * @class
 * @property {net.Socket} clientSocket
 * @property {net.Socket} remoteSocket
 * @property {StreamBuffer} buffer
 * @property {boolean} ended
 * @property {Rtmp} rtmp
 */
class ClientConnection {
	/** @param {net.Socket} clientSocket */
	constructor(clientSocket) {
		this.clientSocket = clientSocket;
		this.buffer = new StreamBuffer();
		this.handleRtmp();
		this.handleClientSocket();
		this.handleRemoteSocket();
	}

	run() {
		this.remoteSocket.connect(config.REMOTE_RTMP_PORT, config.REMOTE_RTMP_URL);
		this.interval = setInterval(this.flush.bind(this), config.LATENCY_INTERVAL);
		this.clientSocket.resume();
	}

	handleRtmp() {
		this.rtmp = new Rtmp();
		this.rtmp.onConnectCallback = req => {
			LOGGER.info(`[RTMP] Client connected: [App/${req.app}] [Name/${req.name}] [Host/${req.host}] [Query/${JSON.stringify(req.query)}]`);
		};
		this.rtmp.onPlayCallback = () => {
			LOGGER.info(`[RTMP] Client started playing stream`);
		};
		this.rtmp.onPushCallback = () => {
			LOGGER.info(`[RTMP] Client started pushing stream`);
		};
	}

	handleClientSocket() {
		this.clientSocket.setNoDelay(true);

		this.clientSocket.on('data', data => {
			if (this.ended) return;
			LOGGER.debug(`[RTMP] Received Client data: ${data.length} bytes`);
			let err = this.rtmp.parserData(data);
			LOGGER.debug(`[RTMP] Chunk Size: ${this.rtmp.inChunkSize}/${this.rtmp.outChunkSize}`);
			this.handleData(data, this.rtmp.inChunkSize);
			if (err != null) {
				LOGGER.fatal(`[RTMP] Error parsing data: ${err}`);
				this.clientSocket.end();
			}
		});

		this.clientSocket.on('close', () => {
			this.ended = true;
			clearInterval(this.interval);
			if (this.remoteSocket) this.remoteSocket.end();
			LOGGER.info(`[Disconnect] Client disconnected`);
		});

		this.clientSocket.on('error', err => {
			this.ended = true;
			clearInterval(this.interval);
			if (this.remoteSocket) this.remoteSocket.destroy();
			LOGGER.fatal(`Client Error: ${err.message}`);
		});
	}

	handleRemoteSocket() {
		this.remoteSocket = net.connect(config.REMOTE_RTMP_PORT, config.REMOTE_RTMP_URL);
		this.remoteSocket = new net.Socket(); // Not connected yet
		this.remoteSocket.on('connect', () => {
			LOGGER.info(`[Connect] Connected to Remote`);
			this.remoteSocket.pipe(this.clientSocket);
		});
		this.remoteSocket.setNoDelay(true);

		this.remoteSocket.on('error', err => {
			LOGGER.fatal(`Remote socket error(${err}): \nName: ${err.name}\nMessage: ${err.message}\nStack: ${err.stack}\nCause: ${err.cause}`);
			this.clientSocket.end();
		});

		this.remoteSocket.on('close', err => {
			if (err) LOGGER.error(`[Disconnect] Remote connection closed with error: ${err}`);
			else LOGGER.info(`[Disconnect] Remote connection closed`);
			this.clientSocket.end();
		});
		this.ended = false;
	}

	/**
	 * Handles incoming data from the client socket.
	 * @param {Buffer} chunks - The data received from the client socket.
	 * @param {number} inChunkSize - The size of each chunk to process.
	 */
	handleData(chunks, inChunkSize) {
		// while (chunks.length >= inChunkSize) {
		// 	const completeChunk = chunks.slice(0, inChunkSize);
		// 	chunks = chunks.slice(inChunkSize);
		// 	this.buffer.pushToBuffer(completeChunk, this.clientSocket);
		// }
		// if (chunks.length > 0)
		this.buffer.pushToBuffer(chunks, this.clientSocket);
	}

	flush() {
		if (this.ended) return;
		const readyChunks = this.buffer.popReadyChunks();
		for (const { chunk, id } of readyChunks) {
			if (this.remoteSocket?.writable) {
				LOGGER.debug(`[Flush] Sending [${id}] ${chunk.length} bytes to Remote`);
				this.remoteSocket.write(chunk);
			}
		}
	}
}

export class RelayServer {
	constructor() {
		this.server = net.createServer({ pauseOnConnect: true });
		this.server.on('connection', this.handleClient);
	}

	handleClient(clientSocket) {
		const client = new ClientConnection(clientSocket);
		client.run();
	}

	run() {
		this.server.listen(config.LOCAL_PORT, () => {
			LOGGER.info(`DelayRelay proxy listening on port ${config.LOCAL_PORT}`);
			LOGGER.info(`Forwarding to Remote with ${config.STREAM_DELAY_MS / 1000}s delay.`);
		});
	}
}
