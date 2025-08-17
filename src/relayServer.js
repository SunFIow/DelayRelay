import net from 'net';
import config from './config.js';
import { Connection } from './connections/connection.js';
import { LOGGER } from './logger.js';

/**
 * @typedef {(clientSocket: net.Socket) => Connection} connectionHandler
 */
export class RelayServer {
	/** @param {connectionHandler} connectionHandler */
	constructor(connectionHandler) {
		this.server = net.createServer({ pauseOnConnect: true });
		/** @type {Set<net.Socket>} */
		this.clients = new Set();
		this.server.on('connection', this.handleClient.bind(this));
		this.connectionHandler = connectionHandler;
	}

	/** @param {net.Socket} clientSocket */
	handleClient(clientSocket) {
		this.clients.add(clientSocket);
		clientSocket.on('close', () => this.clients.delete(clientSocket));

		const client = this.connectionHandler(clientSocket);
		client.run();
	}

	run() {
		if (this.server.listening) {
			LOGGER.warn('Relay server is already running');
			return;
		}
		config.serverStatus = 'pending';
		this.server.listen(config.LOCAL_PORT, () => {
			config.serverStatus = 'running';
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
		config.serverStatus = 'pending';
		this.server.close(() => {
			config.serverStatus = 'stopped';
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
