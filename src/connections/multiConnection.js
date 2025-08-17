import config from '../config.js';
import { LOGGER } from '../logger.js';
import { CodecType } from '../rtmp/consts.js';
import RtmpClient from '../rtmp/RtmpClient.js';
import { RtmpServer } from '../rtmp/RtmpServer.js';
import { Connection } from './connection.js';

export class MultiConnection extends Connection {
	constructor(clientSocket) {
		super(clientSocket);

		this.rtmpServer = new RtmpServer();
		this.rtmpServer.onResponseCallback = chunks => {
			LOGGER.trace(`[RTMP] Response for OBS:`, chunks.length);
			this.clientSocket.write(chunks);
		};
	}

	/** @param {Buffer} chunks */
	onData(chunks) {
		LOGGER.debug(`[RTMP] OBS data: ${chunks.length} bytes`);
		const result = this.rtmpServer.parseData(chunks); // Parse Client RTMP data
		if (result.error) {
			LOGGER.fatal(`[RTMP] Error parsing client data: ${result.message}`);
			this.clientSocket.end();
			return;
		}

		// LOGGER.debug(`[RTMP] Codec Type: ${codec_type}`);
		// LOGGER.debug(`[RTMP] Flags/Me: ${flags}`);
		if (result.codecType != CodecType.AUDIO && result.codecType != CodecType.VIDEO) {
			LOGGER.debug(`[RTMP] OBS message received: Codec: ${result.codecType}, Flags: ${result.flags}`);
		} else this.buffer.pushToBuffer(chunks, result.codecType, result.flags);
		// this.remoteSocket.write(chunks);

		LOGGER.trace(`[RTMP] OBS data handled`);
	}

	run() {
		LOGGER.info(`[RTMP] OBS connected`);
		const rtmpClient = new RtmpClient({ name: 'Remote', host: config.REMOTE_RTMP_URL, port: config.REMOTE_RTMP_PORT });
		rtmpClient.connect();
		this.rtmpServer.addClient(rtmpClient);
		super.run();
	}

	close() {
		super.close();
		this.rtmpServer.close();
	}

	initializeRemote() {}

	sendChunk(chunk) {
		this.rtmpServer.sendChunk(chunk);
	}
}
