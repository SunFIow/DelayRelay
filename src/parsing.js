/**
 * Modified from Node-Media-Server (rtmp.js) (https://github.com/illuspas/Node-Media-Server)
 * Original author: Chen Mingliang
 * Original license: Apache-2.0
 * Changes by: SunFIow — 2025-08-23 — removed dependency on full repo
 */

import { LOGGER } from './logger.js';

const PacketTypeSequenceStart = 0;
const PacketTypeCodedFrames = 1;
const PacketTypeCodedFramesX = 3;
const PacketTypeMetadata = 4;
const PacketTypeMPEG2TSSequenceStart = 5;
const FLV_AVC_SEQUENCE_HEADER = 0;
const FOURCC_AV1 = Buffer.from('av01');
const FOURCC_VP9 = Buffer.from('vp09');
const FOURCC_HEVC = Buffer.from('hvc1');
const FLV_CODECID_H264 = 7;
const FLV_FRAME_KEY = 1;
const FLV_CODECID_AAC = 10;

/** @enum {number} */
export const CodecType = {
	SET_PACKET_SIZE: 0x01, // 1 Set Packet Size Message.
	ABORT: 0x02, // 2 Abort.
	ACKNOWLEDGE: 0x03, // 3 Acknowledge.
	CONTROL: 0x04, // 4 Control Message.
	SERVER_BANDWIDTH: 0x05, // 5 Server Bandwidth
	CLIENT_BANDWIDTH: 0x06, // 6 Client Bandwidth.
	VIRTUAL_CONTROL: 0x07, // 7 Virtual Control.
	AUDIO: 0x08, // 8 Audio Packet.
	VIDEO: 0x09, // 9 Video Packet.
	DATA_EXTENDED: 0x0f, // 15 Data Extended.
	CONTAINER_EXTENDED: 0x10, // 16 Container Extended.
	COMMAND_EXTENDED: 0x11, // 17 Command Extended (An AMF3 type command).
	DATA: 0x12, // 18 Data (Invoke (onMetaData info is sent as such)).
	CONTAINER: 0x13, // 19 Container.
	COMMAND: 0x14, // 20 Command (An AMF0 type command).
	UDP: 0x15, // 21 UDP
	AGGREGATE: 0x16, // 22 Aggregate
	PRESENT: 0x17 // 23 Present
};

/** @enum {number} */
export const PacketFlags = {
	INVALID: -1, // Invalid Packet
	AUDIO_HEADER: 0, // 0 Audio Header - Set Audio Header (FLV_CODECID_AAC)
	AUDIO_FRAME: 1, // 1 Audio Frame - Add GOP
	VIDEO_HEADER: 2, // 2 Video Header - Set Video Header (PacketTypeSequenceStart)
	KEY_FRAME: 3, // 3 Key Frame - New GOP
	VIDEO_FRAME: 4, // 4 Video Frame - Add Video Frame
	METADATA: 5, // 5 Metadata - Set Metadata
	HDR_METADATA: 6, // 6 hdrMetadata - Should not happen
	MPEG2TS_METADATA: 7 // 7 mpeg2tsMetadata - Should not happen
};

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

const RTMP_HANDSHAKE_UNINIT = 0;
const RTMP_HANDSHAKE_0 = 1;
const RTMP_HANDSHAKE_1 = 2;
const RTMP_HANDSHAKE_2 = 3;
const RTMP_HANDSHAKE_SIZE = 1536; // Size of the RTMP handshake payload

const MAX_CHUNK_HEADER = 18;

// CHUNK READ
const RTMP_PARSE_INIT = 0;
const RTMP_PARSE_BASIC_HEADER = 1;
const RTMP_PARSE_MESSAGE_HEADER = 2;
const RTMP_PARSE_EXTENDED_TIMESTAMP = 3;
const RTMP_PARSE_PAYLOAD = 4;

const RTMP_CHUNK_TYPE_0 = 0; // Full header
const RTMP_CHUNK_TYPE_1 = 1; // Timestamp delta, message length,
const RTMP_CHUNK_TYPE_2 = 2; // Timestamp delta, message length, message type

const rtmpHeaderSize = [11, 7, 3, 0];

/* Protocol Control Messages */
const RTMP_TYPE_SET_CHUNK_SIZE = 1;

const RTMP_CHUNK_SIZE = 128; // Default RTMP chunk size

class RtmpPacket {
	constructor(fmt = 0, cid = 0) {
		this.header = {
			fmt: fmt,
			cid: cid,
			timestamp: 0,
			length: 0,
			type: 0,
			stream_id: 0
		};
		this.clock = 0;
		this.payload = Buffer.alloc(0);
		this.capacity = 0;
		this.bytes = 0;
	}
}

export const RTMP = {
	inChunks: 0,
	handshakePayload: Buffer.alloc(RTMP_HANDSHAKE_SIZE),
	handshakeState: RTMP_HANDSHAKE_UNINIT,
	handshakeBytes: 0,

	parserBuffer: Buffer.alloc(MAX_CHUNK_HEADER),
	parserState: RTMP_PARSE_INIT,
	parserBytes: 0,
	parserBasicBytes: 0,
	parserPacket: new RtmpPacket(),
	inPackets: new Map(),

	inChunkSize: RTMP_CHUNK_SIZE
	// outChunkSize: RTMP_MAX_CHUNK_SIZE,

	// streams: 0,
};

/**
 * @typedef {ParserDataSuccess|ParserDataError} ParserDataResult
 */

/**
 * @typedef {Object} ParserDataSuccess
 * @property {false} errorOccurred - Indicates if an error occurred during parsing.
 * @property {CodecType} messageType - The result of the parsing, either an error message or a CodecType.
 */

/**
 * @typedef {Object} ParserDataError
 * @property {true} errorOccurred - Indicates if an error occurred during parsing.
 * @property {string} error - The result of the parsing, either an error message or a CodecType.
 */

// Declare a return type for parserData with has a boolean for if an error occurred
// and then either a string which describes the error or a CodecType

/**
 * @param {Buffer} chunks The incoming RTMP chunks.
 * @returns {ParserDataResult} Either a error message or the RTMP packet type (e.g., 8 for audio, 9 for video, 18 for metadata)
 */
export function parserData(chunks) {
	RTMP.inChunks = chunks.length;
	let bytesRemaining = chunks.length; // 10_000
	let position = 0; // 0
	let bytesToProcess = 0; // 0
	while (bytesRemaining > 0) {
		switch (RTMP.handshakeState) {
			case RTMP_HANDSHAKE_UNINIT:
				// LOGGER.trace('[RTMP] Handshake uninitialized, starting handshake');
				RTMP.handshakeState = RTMP_HANDSHAKE_0;
				RTMP.handshakeBytes = 0;
				bytesRemaining -= 1;
				position += 1;
				break;
			case RTMP_HANDSHAKE_0:
				// LOGGER.trace('[RTMP] Handshake stage 0, waiting for more data');
				bytesToProcess = RTMP_HANDSHAKE_SIZE - RTMP.handshakeBytes;
				if (bytesToProcess > bytesRemaining) bytesToProcess = bytesRemaining;
				chunks.copy(RTMP.handshakePayload, RTMP.handshakeBytes, position, position + bytesToProcess);
				RTMP.handshakeBytes += bytesToProcess;
				bytesRemaining -= bytesToProcess;
				position += bytesToProcess;
				if (RTMP.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
					RTMP.handshakeState = RTMP_HANDSHAKE_1;
					RTMP.handshakeBytes = 0;
				}
				break;
			case RTMP_HANDSHAKE_1:
				// LOGGER.trace('[RTMP] Handshake stage 1, waiting for more data');
				bytesToProcess = RTMP_HANDSHAKE_SIZE - RTMP.handshakeBytes;
				if (bytesToProcess > bytesRemaining) bytesToProcess = bytesRemaining;
				chunks.copy(RTMP.handshakePayload, RTMP.handshakeBytes, position, bytesToProcess);
				RTMP.handshakeBytes += bytesToProcess;
				bytesRemaining -= bytesToProcess;
				position += bytesToProcess;
				if (RTMP.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
					RTMP.handshakeState = RTMP_HANDSHAKE_2;
					RTMP.handshakeBytes = 0;
				}
				break;
			case RTMP_HANDSHAKE_2:
			// LOGGER.trace('[RTMP] Handshake stage 2, waiting for more data');
			default:
				// LOGGER.trace('[RTMP] Handshake complete', RTMP.handshakeState);
				return chunkRead(chunks, position, bytesRemaining);
		}
	}
	return null;
}

function chunkRead(data, position, bytes) {
	let size = 0;
	let offset = 0;
	let extended_timestamp = 0;

	while (offset < bytes) {
		switch (RTMP.parserState) {
			case RTMP_PARSE_INIT:
				// LOGGER.trace('[RTMP] Parsing initialized');
				RTMP.parserBytes = 1;
				RTMP.parserBuffer[0] = data[position + offset++];
				if (0 === (RTMP.parserBuffer[0] & 0x3f)) RTMP.parserBasicBytes = 2;
				else if (1 === (RTMP.parserBuffer[0] & 0x3f)) RTMP.parserBasicBytes = 3;
				else RTMP.parserBasicBytes = 1;
				RTMP.parserState = RTMP_PARSE_BASIC_HEADER;
				break;
			case RTMP_PARSE_BASIC_HEADER:
				// LOGGER.trace('[RTMP] Parsing basic header');
				while (RTMP.parserBytes < RTMP.parserBasicBytes && offset < bytes) {
					RTMP.parserBuffer[RTMP.parserBytes++] = data[position + offset++];
				}
				if (RTMP.parserBytes >= RTMP.parserBasicBytes) {
					RTMP.parserState = RTMP_PARSE_MESSAGE_HEADER;
				}
				break;
			case RTMP_PARSE_MESSAGE_HEADER:
				// LOGGER.trace('[RTMP] Parsing message header');
				size = rtmpHeaderSize[RTMP.parserBuffer[0] >> 6] + RTMP.parserBasicBytes;
				while (RTMP.parserBytes < size && offset < bytes) {
					RTMP.parserBuffer[RTMP.parserBytes++] = data[position + offset++];
				}
				if (RTMP.parserBytes >= size) {
					packetParse();
					RTMP.parserState = RTMP_PARSE_EXTENDED_TIMESTAMP;
				}
				break;
			case RTMP_PARSE_EXTENDED_TIMESTAMP:
				// LOGGER.trace('[RTMP] Parsing extended timestamp');
				size = rtmpHeaderSize[RTMP.parserPacket.header.fmt] + RTMP.parserBasicBytes;
				if (RTMP.parserPacket.header.timestamp === 0xffffff) {
					size += 4;
				}
				while (RTMP.parserBytes < size && offset < bytes) {
					RTMP.parserBuffer[RTMP.parserBytes++] = data[position + offset++];
				}
				if (RTMP.parserBytes >= size) {
					if (RTMP.parserPacket.header.timestamp === 0xffffff) {
						extended_timestamp = RTMP.parserBuffer.readUInt32BE(rtmpHeaderSize[RTMP.parserPacket.header.fmt] + RTMP.parserBasicBytes);
					} else {
						extended_timestamp = RTMP.parserPacket.header.timestamp;
					}

					if (RTMP.parserPacket.bytes === 0) {
						if (RTMP_CHUNK_TYPE_0 === RTMP.parserPacket.header.fmt) {
							RTMP.parserPacket.clock = extended_timestamp;
						} else {
							RTMP.parserPacket.clock += extended_timestamp;
						}
						packetAlloc();
					}
					RTMP.parserState = RTMP_PARSE_PAYLOAD;
				}
				break;
			case RTMP_PARSE_PAYLOAD:
				// LOGGER.trace('[RTMP] Parsing payload');
				size = Math.min(RTMP.inChunkSize - (RTMP.parserPacket.bytes % RTMP.inChunkSize), RTMP.parserPacket.header.length - RTMP.parserPacket.bytes);
				size = Math.min(size, bytes - offset);
				if (size > 0) {
					data.copy(RTMP.parserPacket.payload, RTMP.parserPacket.bytes, position + offset, position + offset + size);
				}
				RTMP.parserPacket.bytes += size;
				offset += size;

				// LOGGER.trace(`[RTMP] Parsed ${size} bytes, total: ${RTMP.parserPacket.bytes}/${RTMP.parserPacket.header.length}`);
				if (RTMP.parserPacket.bytes >= RTMP.parserPacket.header.length) {
					RTMP.parserState = RTMP_PARSE_INIT;
					RTMP.parserPacket.bytes = 0;
					if (RTMP.parserPacket.clock > 0xffffffff) {
						break;
					}
					packetHandler();
				} else if (0 === RTMP.parserPacket.bytes % RTMP.inChunkSize) {
					RTMP.parserState = RTMP_PARSE_INIT;
				}
				break;
		}
	}
	return null;
}

function packetAlloc() {
	if (RTMP.parserPacket.capacity < RTMP.parserPacket.header.length) {
		RTMP.parserPacket.payload = Buffer.alloc(RTMP.parserPacket.header.length + 1024);
		RTMP.parserPacket.capacity = RTMP.parserPacket.header.length + 1024;
	}
}

function packetParse() {
	let fmt = RTMP.parserBuffer[0] >> 6;
	let cid = 0;
	if (RTMP.parserBasicBytes === 2) {
		cid = 64 + RTMP.parserBuffer[1];
	} else if (RTMP.parserBasicBytes === 3) {
		cid = (64 + RTMP.parserBuffer[1] + RTMP.parserBuffer[2]) << 8;
	} else {
		cid = RTMP.parserBuffer[0] & 0x3f;
	}
	RTMP.parserPacket = RTMP.inPackets.get(cid) ?? new RtmpPacket(fmt, cid);
	RTMP.inPackets.set(cid, RTMP.parserPacket);
	RTMP.parserPacket.header.fmt = fmt;
	RTMP.parserPacket.header.cid = cid;
	chunkMessageHeaderRead();
}

function chunkMessageHeaderRead() {
	let offset = RTMP.parserBasicBytes;

	// timestamp / delta
	if (RTMP.parserPacket.header.fmt <= RTMP_CHUNK_TYPE_2) {
		RTMP.parserPacket.header.timestamp = RTMP.parserBuffer.readUIntBE(offset, 3);
		offset += 3;
	}

	// message length + type
	if (RTMP.parserPacket.header.fmt <= RTMP_CHUNK_TYPE_1) {
		RTMP.parserPacket.header.length = RTMP.parserBuffer.readUIntBE(offset, 3);
		RTMP.parserPacket.header.type = RTMP.parserBuffer[offset + 3];
		// LOGGER_API.debug(`[CODEC]: ${RTMP.parserPacket.header.type}`);
		offset += 4;
	}

	if (RTMP.parserPacket.header.fmt === RTMP_CHUNK_TYPE_0) {
		RTMP.parserPacket.header.stream_id = RTMP.parserBuffer.readUInt32LE(offset);
		offset += 4;
	}
	return offset;
}

function packetHandler() {
	// LOGGER.trace(`[RTMP] Packet handler called for type ${RTMP.parserPacket.header.type}`);
	switch (RTMP.parserPacket.header.type) {
		case RTMP_TYPE_SET_CHUNK_SIZE:
			RTMP.inChunkSize = payload.readUInt32BE();
			// LOGGER.debug('set inChunkSize', RTMP.inChunkSize);
			break;
	}
}
