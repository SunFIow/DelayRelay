import config, { silentProxy } from '../config.js';
import { LOGGER } from '../logger.js';
import { CodecType } from '../rtmp/consts.js';
import RtmpClient from '../rtmp/RtmpClient.js';
import { RtmpServer } from '../rtmp/RtmpServer.js';
import { Connection } from './connection.js';

const relayTypes = [CodecType.AUDIO, CodecType.VIDEO, CodecType.DATA, CodecType.DATA_EXTENDED];
let id = 0;
export class MultiConnection extends Connection {
	constructor(clientSocket) {
		super(clientSocket);

		this.rtmpServer = new RtmpServer();
		this.rtmpServer.on('response', chunks => {
			LOGGER.trace(`[RTMP] Response for OBS:`, chunks.length);
			if (!silentProxy) this.clientSocket.write(chunks);
		});
		this.rtmpServer.on('packet', packet => {
			LOGGER.trace(`[RTMP] Packet from OBS: ${packet.type}, ${packet.flags}, ${packet.payload.length}`);
			// if (!silentProxy) this.buffer.pushToBuffer(packet.payload, packet.type, packet.flags);
			// if (!silentProxy) this.rtmpServer.sendChunk({ id: id++, codec: packet.type, flags: packet.flags, data: packet.payload });
		});
	}

	/** @param {Buffer} chunks */
	onData(chunks) {
		LOGGER.trace(`[RTMP] OBS data: ${chunks.length} bytes`);
		const error = this.rtmpServer.feed(Buffer.from(chunks)); // Parse Client RTMP data
		if (error) {
			LOGGER.fatal(`[RTMP] Error parsing client data: ${error}`);
			this.close();
			return;
		}

		if (!silentProxy) {
			// LOGGER.trace(`[RTMP] Parsed Chunks: ${this.rtmpServer.pktType}, ${this.rtmpServer.pktFlags}, ${chunks.length}`);
			// if (relayTypes.includes(this.rtmpServer.pktType)) {
			// 	this.buffer.pushToBuffer(chunks, this.rtmpServer.pktType, this.rtmpServer.pktFlags);
			// } else {
			// 	LOGGER.debug(`[RTMP] OBS message received: Codec: ${this.rtmpServer.pktType}, Flags: ${this.rtmpServer.pktFlags}`);
			// }
			this.rtmpServer.sendChunk({ id: id++, codec: this.rtmpServer.pktType, flags: this.rtmpServer.pktFlags, data: chunks });
		} else {
			this.buffer.pushToBuffer(chunks, this.rtmpServer.pktType, this.rtmpServer.pktFlags);
		}
		LOGGER.trace(`[RTMP] OBS data handled`);
	}

	run() {
		LOGGER.info(`[RTMP] OBS connected`);
		const rtmpClient = new RtmpClient({ name: 'Remote', host: config.REMOTE_RTMP_URL, port: config.REMOTE_RTMP_PORT });
		this.rtmpServer.addClient(rtmpClient);

		rtmpClient.once('completedHandshake', () => {
			LOGGER.info(`[RtmpClient:${rtmpClient.name}] completed Handshake`);
			if (!silentProxy) super.run();
		});

		rtmpClient.on('connect', () => {
			LOGGER.info(`[RtmpClient:${rtmpClient.name}] Connected to remote`);
			if (silentProxy) super.run();
		});

		rtmpClient.on('data', data => {
			LOGGER.info(`[Data] Received Remote data: ${data.length} bytes`);
			if (silentProxy) this.clientSocket.write(data);
		});

		rtmpClient.connect();
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
