import {
	CodecType,
	FLV_AVC_SEQUENCE_HEADER,
	FLV_CODECID_AAC,
	FLV_CODECID_H264,
	FLV_FRAME_KEY,
	FOURCC_AV1,
	FOURCC_HEVC,
	FOURCC_VP9,
	MESSAGE_FORMAT_0,
	PacketFlags,
	RTMP_CHANNEL_AUDIO,
	RTMP_CHANNEL_COMMAND,
	RTMP_CHANNEL_DATA,
	RTMP_CHANNEL_VIDEO,
	RTMP_CHUNK_TYPE_0,
	RTMP_CHUNK_TYPE_1,
	RTMP_CHUNK_TYPE_2,
	RTMP_CHUNK_TYPE_3,
	RTMP_MAX_CHUNK_SIZE,
	rtmpHeaderSize
} from './consts.js';
import { RtmpPacket } from './RtmpPacket.js';

/** @param {RtmpPacket} packet */
export function createMessage(packet, chunkSize = RTMP_MAX_CHUNK_SIZE) {
	const pktType = packet.header.type;
	const pktFlags = parsePacketFlag(packet.header.type, packet.payload);
	const pktPayload = createChunks(packet, chunkSize);
	return { type: pktType, flags: pktFlags, payload: pktPayload };
}

/**
 * @param {RtmpPacket} packet
 * @returns {Buffer}
 */
export function createChunks(packet, chunkSize = RTMP_MAX_CHUNK_SIZE) {
	const fmt = MESSAGE_FORMAT_0;
	const timestamp = packet.clock;
	const type = packet.header.type;
	const cid =
		type === CodecType.AUDIO
			? RTMP_CHANNEL_AUDIO
			: type === CodecType.VIDEO
			? RTMP_CHANNEL_VIDEO
			: type === CodecType.DATA || type === CodecType.DATA_EXTENDED
			? RTMP_CHANNEL_DATA
			: type === CodecType.COMMAND || type === CodecType.COMMAND_EXTENDED
			? RTMP_CHANNEL_COMMAND
			: 0;

	const header = packet.header;
	const payload = packet.payload;
	let payloadSize = header.length;
	let chunksOffset = 0;
	let payloadOffset = 0;
	const chunkBasicHeader = chunkBasicHeaderCreate(fmt, cid);
	const chunkBasicHeader3 = chunkBasicHeaderCreate(RTMP_CHUNK_TYPE_3, cid);
	const chunkMessageHeader = chunkMessageHeaderCreate(header, fmt, timestamp);
	const useExtendedTimestamp = timestamp >= 0xffffff;
	const headerSize = chunkBasicHeader.length + chunkMessageHeader.length + (useExtendedTimestamp ? 4 : 0);
	let n = headerSize + payloadSize + Math.floor(payloadSize / chunkSize);

	if (useExtendedTimestamp) {
		n += Math.floor(payloadSize / chunkSize) * 4;
	}
	if (!(payloadSize % chunkSize)) {
		n -= 1;
		if (useExtendedTimestamp) {
			//TODO CHECK
			n -= 4;
		}
	}

	const chunks = Buffer.alloc(n);
	chunkBasicHeader.copy(chunks, chunksOffset);
	chunksOffset += chunkBasicHeader.length;
	chunkMessageHeader.copy(chunks, chunksOffset);
	chunksOffset += chunkMessageHeader.length;
	if (useExtendedTimestamp) {
		chunks.writeUInt32BE(timestamp, chunksOffset);
		chunksOffset += 4;
	}
	while (payloadSize > 0) {
		if (payloadSize > chunkSize) {
			payload.copy(chunks, chunksOffset, payloadOffset, payloadOffset + chunkSize);
			payloadSize -= chunkSize;
			chunksOffset += chunkSize;
			payloadOffset += chunkSize;
			chunkBasicHeader3.copy(chunks, chunksOffset);
			chunksOffset += chunkBasicHeader3.length;
			if (useExtendedTimestamp) {
				chunks.writeUInt32BE(timestamp, chunksOffset);
				chunksOffset += 4;
			}
		} else {
			payload.copy(chunks, chunksOffset, payloadOffset, payloadOffset + payloadSize);
			payloadSize -= payloadSize;
			chunksOffset += payloadSize;
			payloadOffset += payloadSize;
		}
	}
	return chunks;
}

function chunkBasicHeaderCreate(fmt, cid) {
	let out;
	if (cid >= 64 + 255) {
		out = Buffer.alloc(3);
		out[0] = (fmt << 6) | 1;
		out[1] = (cid - 64) & 0xff;
		out[2] = ((cid - 64) >> 8) & 0xff;
	} else if (cid >= 64) {
		out = Buffer.alloc(2);
		out[0] = (fmt << 6) | 0;
		out[1] = (cid - 64) & 0xff;
	} else {
		out = Buffer.alloc(1);
		out[0] = (fmt << 6) | cid;
	}
	return out;
}

function chunkMessageHeaderCreate(header, fmt, timestamp) {
	let out = Buffer.alloc(rtmpHeaderSize[fmt % 4]);
	if (fmt <= RTMP_CHUNK_TYPE_2) {
		out.writeUIntBE(timestamp >= 0xffffff ? 0xffffff : timestamp, 0, 3);
	}

	if (fmt <= RTMP_CHUNK_TYPE_1) {
		out.writeUIntBE(header.length, 3, 3);
		out.writeUInt8(header.type, 6);
	}

	if (fmt === RTMP_CHUNK_TYPE_0) {
		out.writeUInt32LE(header.stream_id, 7);
	}
	return out;
}

/** Parses FLV payload to extract only the relevant packet flag.
 * @param {number} type - RTMP packet type (e.g., 8 for audio, 9 for video, 18 for metadata)
 * @param {Buffer} payload - The RTMP packet payload (FLV tag data)
 * @returns {PacketFlags} -1 if not a valid packet type, otherwise returns the packet flag
 */
export function parsePacketFlag(type, payload) {
	// Audio packet
	if (type === CodecType.AUDIO) {
		const soundFormat = payload[0] >> 4;
		if (soundFormat === FLV_CODECID_AAC) {
			const aacPacketType = payload[1];
			if (aacPacketType === 0) return PacketFlags.AUDIO_HEADER;
		}
		return PacketFlags.AUDIO_FRAME;
	}

	// Video packet
	else if (type === CodecType.VIDEO) {
		const frameType = (payload[0] >> 4) & 0b0111;
		const codecID = payload[0] & 0x0f;
		const isExHeader = frameType !== 0;

		if (isExHeader) {
			const packetType = payload[0] & 0x0f;
			const fourCC = payload.subarray(1, 5);
			if (fourCC.compare(FOURCC_AV1) === 0 || fourCC.compare(FOURCC_VP9) === 0 || fourCC.compare(FOURCC_HEVC) === 0) {
				if (packetType === PacketTypeSequenceStart) return PacketFlags.VIDEO_HEADER;
				else if (packetType === PacketTypeCodedFrames || packetType === PacketTypeCodedFramesX) {
					// 1
					if (frameType === FLV_FRAME_KEY) return PacketFlags.KEY_FRAME;
					else return PacketFlags.VIDEO_FRAME;
				} else if (packetType === PacketTypeMetadata) return PacketFlags.HDR_METADATA;
				else if (packetType === PacketTypeMPEG2TSSequenceStart) return PacketFlags.MPEG2TS_METADATA;
			} else {
				const packetType = payload[1];
				if (codecID === FLV_CODECID_H264) {
					if (packetType === FLV_AVC_SEQUENCE_HEADER) return PacketFlags.VIDEO_HEADER;
					else if (frameType === FLV_FRAME_KEY) return PacketFlags.KEY_FRAME;
				}
				return PacketFlags.VIDEO_FRAME;
			}
		}
	}

	// Metadata
	else if (type === CodecType.DATA) return PacketFlags.METADATA;

	return -1;
}
