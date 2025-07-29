import net from 'net';
import { SimpleConnection } from './connections/simpleConnection.js';
import { RtmpConnection } from './connections/rtmpConnection.js';
import { config } from './config.js';
import { LOGGER } from './logger.js';

export class RelayServer {
	constructor() {
		this.server = net.createServer({ pauseOnConnect: false });
		this.server.on('connection', this.handleClient);
	}

	handleClient(clientSocket) {
		// const client = new ClientConnection(clientSocket);
		const client = new RtmpConnection(clientSocket);
		client.run();
	}

	run() {
		this.server.listen(config.LOCAL_PORT, () => {
			LOGGER.info(`DelayRelay proxy listening on port ${config.LOCAL_PORT}`);
			LOGGER.info(`Forwarding to Remote with ${config.STREAM_DELAY_MS / 1000}s delay.`);
		});
	}
}
