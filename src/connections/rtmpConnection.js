import Rtmp from 'node-media-server/src/protocol/rtmp.js';
import { Connection } from './connection.js';
import { LOGGER } from '../logger.js';
import Flv from 'node-media-server/src/protocol/flv.js';

export class RtmpConnection extends Connection {
	/** @param {Buffer} chunks */
	onData(chunks) {
		const err = this.incoming.parserData(chunks); // Parse Client RTMP data
		if (err != null) {
			LOGGER.fatal(`[RTMP] Error parsing client data: ${err}`);
			this.clientSocket.end();
			return;
		}
		LOGGER.debug(
			`[RTMP Packet] Type: ${this.incoming.parserPacket.header.type}, Size: ${this.incoming.parserPacket.header.length}, Bytes: ${this.incoming.parserPacket.payload.length}, ChunkSize: ${this.incoming.inChunkSize}/${this.incoming.outChunkSize}, Timestamp: ${this.incoming.parserPacket.clock}`
		);
		let packet = Flv.parserTag(this.incoming.parserPacket.header.type, this.incoming.parserPacket.clock, this.incoming.parserPacket.header.length, this.incoming.parserPacket.payload);
		/** Codec Types:
		 ** 8 (Audio) - (0 Audio Header) | (1 Audio Frame)
		 ** 9 (Video) - (2 Video Header) | (3 Key Frame) | (4 Video Frame) | (5 Metadata) | (6 hdrMetadata)
		 ** 18 (Control) - Metadata (6)
		 */
		const codec_type = packet.codec_type;
		/*** Flags:
		 ** 0 (Audio Header)	[Set Audio Header] FLV_CODECID_AAC
		 ** 1 (Audio Frame)	[Add GOP]
		 ** 2 (Video Header)	[Set Video Header] PacketTypeSequenceStart
		 ** 3 (Key Frame)		[New GOP]
		 ** 4 (Video Frame)	[Add Video Frame]
		 ** 5 (Metadata)		[Set Metadata]
		 ** 6 (hdrMetadata)	[Should not happen] hdrMetadata
		 */
		const flags = packet.flags;
		LOGGER.debug(`[AVPacket] Type: ${codec_type}, Flags: ${flags}, Size: ${packet.size}`);

		this.buffer.pushToBuffer(chunks);
		this.buffer.handleMemoryManagement(this.clientSocket);
	}

	initializeClient() {
		super.initializeClient();

		this.incoming = new Rtmp();
		this.incoming.onConnectCallback = req => {
			LOGGER.info(`[RTMP] Client connected: [App/${req.app}] [Name/${req.name}] [Host/${req.host}] [Query/${JSON.stringify(req.query)}]`);
		};
		this.incoming.onPlayCallback = () => {
			LOGGER.info(`[RTMP] Client started playing stream`);
		};
		this.incoming.onPushCallback = () => {
			LOGGER.info(`[RTMP] Client started pushing stream`);
		};

		this.incoming.onPacketCallback = packet => {
			// Codec Types: 8 (Audio), 9 (Video), 18 (Script Data)
			// LOGGER.debug(`[RTMP] Client Packet received: Type: ${packet.codec_type}, Size: ${packet.size}, Flags: ${packet.flags}`);
			// this.buffer.pushToBuffer(chunks);
			// this.buffer.handleMemoryManagement(this.clientSocket);
		};
	}
}
