import { LOGGER } from '../logger.js';
import { CodecType, parsePacketFlag, parserData, RTMP } from '../parsing.js';
import { Connection } from './connection.js';

export class RtmpConnection extends Connection {
	/** @param {Buffer} chunks */
	onData(chunks) {
		const error = parserData(chunks); // Parse Client RTMP data
		if (error) {
			LOGGER.fatal(`[RTMP] Error parsing client data: ${error}`);
			this.clientSocket.end();
			return;
		}

		/** @type {CodecType} */
		const codec_type = RTMP.parserPacket.header.type;
		const payload = RTMP.parserPacket.payload;
		// LOGGER.debug(`[RTMP] Codec Type: ${codec_type}`);
		const flags = parsePacketFlag(codec_type, payload);
		// LOGGER.debug(`[RTMP] Flags/Me: ${flags}`);
		if (codec_type != CodecType.AUDIO && codec_type != CodecType.VIDEO) {
			LOGGER.debug(`[RTMP] Client Packet received: Codec: ${codec_type}, Flags: ${flags}`);
		}
		this.buffer.pushToBuffer(chunks, codec_type, flags);

		// this.remoteSocket.write(chunks);
	}
}
