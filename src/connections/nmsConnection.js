import Flv from '../../copyof-node-media-server/src/protocol/flv.js';
import Rtmp from '../../copyof-node-media-server/src/protocol/rtmp.js';
import { LOGGER } from '../logger.js';
import { CodecType, parsePacketFlag } from '../parsing.js';
import { Connection } from './connection.js';

export class NMSConnection extends Connection {
	/** @param {Buffer} chunks */
	onData(chunks) {
		LOGGER.debug(`[RTMP] Received data: ${chunks.length} bytes`);
		const err = this.incoming.parserData(chunks); // Parse Client RTMP data
		if (err != null) {
			LOGGER.fatal(`[RTMP] Error parsing client data: ${err}`);
			this.clientSocket.end();
			return;
		}

		/** @type {CodecType} */
		const codec_type = this.incoming.parserPacket.header.type;
		const clock = this.incoming.parserPacket.header.clock;
		const length = this.incoming.parserPacket.payload.length;
		const payload = this.incoming.parserPacket.payload;
		LOGGER.debug(`[RTMP] Codec Type: ${codec_type}`);
		const avPacket = Flv.parserTag(codec_type, clock, length, payload);
		const flags = avPacket.flags;
		// const flags = parsePacketFlag(codec_type, payload);
		LOGGER.debug(`[RTMP] Flags/Me: ${flags}`);
		if (codec_type != CodecType.AUDIO && codec_type != CodecType.VIDEO) {
			LOGGER.debug(`[RTMP] Client Packet received: Codec: ${codec_type}, Flags: ${flags}`);
		}
		this.buffer.pushToBuffer(chunks, codec_type, flags);
		// this.remoteSocket.write(chunks);
	}

	initializeClient() {
		super.initializeClient();

		this.incoming = new Rtmp();
		this.incoming.onConnectCallback = () => {
			LOGGER.info(`[RTMP] Client connected`);
		};
		this.incoming.onPushCallback = () => {
			LOGGER.info(`[RTMP] Client pushing stream`);
		};
		this.incoming.onPlayCallback = () => {
			LOGGER.info(`[RTMP] Client playing stream`);
		};
	}
}
