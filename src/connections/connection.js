import net from 'net';
import config from '../config.js';
import { LOGGER } from '../logger.js';
import { StreamBuffer } from '../streamBuffer.js';

/**
 * @class
 * @property {net.Socket} clientSocket
 * @property {net.Socket} remoteSocket
 * @property {StreamBuffer} buffer
 * @property {boolean} ended
 */
export class Connection {
	/** @param {net.Socket} clientSocket */
	constructor(clientSocket) {
		this.clientSocket = clientSocket;
		this.buffer = new StreamBuffer();
		this.ended = false;
		this.initializeClient();
		this.initializeRemote();
	}

	run() {
		this.remoteSocket?.connect(config.REMOTE_RTMP_PORT, config.REMOTE_RTMP_URL);
		this.clientSocket.resume();
		this.interval = setInterval(this.checkChunks.bind(this), config.LATENCY_INTERVAL);
	}

	close() {
		this.ended = true;
		clearInterval(this.interval);
		this.remoteSocket?.end();
		this.clientSocket?.end();
		config.clientConnected = false;
	}

	initializeClient() {
		this.clientSocket.setNoDelay(true);

		this.clientSocket.on('data', data => {
			if (this.ended) return;
			LOGGER.debug(`[Data] Received Client data: ${data.length} bytes`);
			this.onData(data);
		});

		this.clientSocket.on('error', err => {
			LOGGER.error(`Client socket error(${err}): \nName: ${err.name}\nMessage: ${err.message}\nStack: ${err.stack}\nCause: ${err.cause}`);
		});

		this.clientSocket.on('close', hadError => {
			if (hadError) LOGGER.error(`[Disconnect] Client connection closed with error: ${hadError}`);
			else LOGGER.info(`[Disconnect] Client connection closed`);
			this.close();
		});
	}

	initializeRemote() {
		this.remoteSocket = new net.Socket();
		this.remoteSocket.setNoDelay(true);

		this.remoteSocket.on('connect', () => {
			LOGGER.info(`[Connect] Connected to Remote`);
			config.clientConnected = true;
			// this.remoteSocket.pipe(this.clientSocket);
		});

		this.remoteSocket.on('data', data => {
			if (this.ended) return;
			LOGGER.debug(`[Data] Received Remote data: ${data.length} bytes`);
			this.clientSocket.write(data);
		});

		this.remoteSocket.on('error', err => {
			LOGGER.error(`Remote socket error(${err}): \nName: ${err.name}\nMessage: ${err.message}\nStack: ${err.stack}\nCause: ${err.cause}`);
		});

		this.remoteSocket.on('close', hadError => {
			if (hadError) LOGGER.error(`[Disconnect] Remote connection closed with error: ${hadError}`);
			else LOGGER.info(`[Disconnect] Remote connection closed`);
			this.close();
		});
	}

	checkChunks() {
		if (this.ended) return;
		const readyChunks = this.buffer.popReadyChunks();
		for (const chunk of readyChunks) {
			this.sendChunk(chunk);
		}
	}

	sendChunk({ chunk, id }) {
		if (this.remoteSocket?.writable) {
			LOGGER.debug(`[Flush] Sending [${id}] ${chunk.length} bytes to Remote`);
			this.remoteSocket.write(chunk);
		} else {
			LOGGER.warn(`[Flush] Remote socket not writable, skipping chunk [${id}]`);
		}
	}

	/**
	 *  @abstract This method should be implemented in subclasses to handle incoming data.
	 * @param {Buffer} chunks
	 */
	onData(chunks) {}
}
