import net from 'net';
import { SimpleConnection } from './connections/simpleConnection.js';
import { RtmpConnection } from './connections/rtmpConnection.js';
import { config } from './config.js';
import { LOGGER } from './logger.js';

export class RelayServer {
	constructor() {
		this.server = net.createServer({ pauseOnConnect: false });
		/** @type {Set<net.Socket>} */
		this.clients = new Set();
		this.server.on('connection', this.handleClient.bind(this));

		config.server = this;
		config.serverRunning = false;
	}

	/** @param {net.Socket} clientSocket */
	handleClient(clientSocket) {
		this.clients.add(clientSocket);
		clientSocket.on('close', () => this.clients.delete(clientSocket));

		const client = new RtmpConnection(clientSocket);
		client.run();
	}

	run() {
		if (this.server.listening) {
			LOGGER.warn('Relay server is already running');
			return;
		}
		this.server.listen(config.LOCAL_PORT, () => {
			config.serverRunning = true;
			LOGGER.info(`DelayRelay proxy listening on port ${config.LOCAL_PORT}`);
			LOGGER.info(`Forwarding to Remote with ${config.STREAM_DELAY_MS / 1000}s delay.`);
		});
	}

	close(callback) {
		if (!this.server.listening) {
			LOGGER.warn('Relay server is not running');
			if (callback) callback();
			return;
		}
		this.server.close(() => {
			config.serverRunning = false;
			LOGGER.info('Relay server closed');
			if (callback) callback();
		});

		// Gracefully close all client sockets
		for (const clientSocket of this.clients) {
			clientSocket.end();
			// If the socket doesn't close gracefully in 5s, force destroy
			const destroyTimeout = setTimeout(() => {
				if (!clientSocket.destroyed) clientSocket.destroy();
			}, 5000);
			clientSocket.once('close', () => clearTimeout(destroyTimeout));
		}
	}
}
