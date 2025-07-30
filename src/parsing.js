const RTMP_CHUNK_SIZE = 128; // Default RTMP chunk size
const RTMP_MAX_CHUNK_SIZE = 0xffff;

// PARSER DATA
const RTMP_HANDSHAKE_UNINIT = 0;
const RTMP_HANDSHAKE_0 = 1;
const RTMP_HANDSHAKE_1 = 2;
const RTMP_HANDSHAKE_2 = 3;
const RTMP_HANDSHAKE_SIZE = 1536; // Size of the RTMP handshake payload

// CHUNK READ
const RTMP_PARSE_INIT = 0;
const RTMP_PARSE_BASIC_HEADER = 1;
const RTMP_PARSE_MESSAGE_HEADER = 2;
const RTMP_PARSE_EXTENDED_TIMESTAMP = 3;
const RTMP_PARSE_PAYLOAD = 4;

const RTMP_CHUNK_TYPE_0 = 0; // Full header
const RTMP_CHUNK_TYPE_1 = 1; // Timestamp delta, message length,
const RTMP_CHUNK_TYPE_2 = 2; // Timestamp delta, message length, message type

// PARSER TAG
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

/**
 * @enum {number}
 */
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

/**
 * @enum {number}
 */
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

let inChunkSize = RTMP_CHUNK_SIZE;

/** Parses the RTMP packet type from the incoming chunks.
 * @param {Buffer} chunks - The incoming RTMP chunks.
 * @returns {CodecType} - The RTMP packet type (e.g., 8 for audio, 9 for video, 18 for metadata)
 */
export function parsePacketType(chunks) {}

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

/**
 * @param {Buffer} chunks - The incoming RTMP chunks.
 * @returns {CodecType} - The RTMP packet type (e.g., 8 for audio, 9 for video, 18 for metadata)
 */
export function parserData(chunks) {
	let bytes = chunks.length;
	let p = 0;
	let n = 0;
	while (bytes > 0) {
		switch (this.handshakeState) {
			case RTMP_HANDSHAKE_UNINIT:
				// logger.log('RTMP_HANDSHAKE_UNINIT');
				this.handshakeState = RTMP_HANDSHAKE_0;
				this.handshakeBytes = 0;
				bytes -= 1;
				p += 1;
				break;
			case RTMP_HANDSHAKE_0:
				// logger.log('RTMP_HANDSHAKE_0');
				n = RTMP_HANDSHAKE_SIZE - this.handshakeBytes;
				n = n <= bytes ? n : bytes;
				chunks.copy(this.handshakePayload, this.handshakeBytes, p, p + n);
				this.handshakeBytes += n;
				bytes -= n;
				p += n;
				if (this.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
					this.handshakeState = RTMP_HANDSHAKE_1;
					this.handshakeBytes = 0;
					let s0s1s2 = generateS0S1S2(this.handshakePayload);
					this.onOutputCallback(s0s1s2);
				}
				break;
			case RTMP_HANDSHAKE_1:
				// logger.log('RTMP_HANDSHAKE_1');
				n = RTMP_HANDSHAKE_SIZE - this.handshakeBytes;
				n = n <= bytes ? n : bytes;
				chunks.copy(this.handshakePayload, this.handshakeBytes, p, n);
				this.handshakeBytes += n;
				bytes -= n;
				p += n;
				if (this.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
					this.handshakeState = RTMP_HANDSHAKE_2;
					this.handshakeBytes = 0;
				}
				break;
			case RTMP_HANDSHAKE_2:
			default:
				return this.chunkRead(chunks, p, bytes);
		}
	}
	return null;
}

export function chunkRead(data, position, bytes) {
	let size = 0;
	let offset = 0;
	let extended_timestamp = 0;

	const rtmpHeaderSize = [11, 7, 3, 0];
	let parserState = RTMP_PARSE_INIT;
	let parserBuffer = Buffer.alloc(18); // Max size of RTMP header
	let parserBytes;
	let parserBasicBytes;

	const parserPacket = {
		header: {
			fmt: 0,
			timestamp: 0,
			length: 0,
			type: 0
		},
		clock: 0,
		payload: Buffer.alloc(0), // Will be allocated later
		capacity: 0,
		bytes: 0
	};

	while (offset < bytes) {
		switch (parserState) {
			case RTMP_PARSE_INIT:
				parserBytes = 1;
				parserBuffer[0] = data[position + offset++];
				if (0 === (parserBuffer[0] & 0x3f)) parserBasicBytes = 2;
				else if (1 === (parserBuffer[0] & 0x3f)) parserBasicBytes = 3;
				else parserBasicBytes = 1;
				parserState = RTMP_PARSE_BASIC_HEADER;
				break;
			case RTMP_PARSE_BASIC_HEADER:
				while (parserBytes < parserBasicBytes && offset < bytes) {
					parserBuffer[parserBytes++] = data[position + offset++];
				}
				if (parserBytes >= parserBasicBytes) {
					parserState = RTMP_PARSE_MESSAGE_HEADER;
				}
				break;
			case RTMP_PARSE_MESSAGE_HEADER:
				size = rtmpHeaderSize[parserBuffer[0] >> 6] + parserBasicBytes;
				while (parserBytes < size && offset < bytes) {
					parserBuffer[parserBytes++] = data[position + offset++];
				}
				if (parserBytes >= size) {
					const { fmt, codec_type } = this.packetParse(parserBasicBytes, parserBuffer);
					parserPacket.header.fmt = fmt;
					parserPacket.header.type = codec_type;
					parserState = RTMP_PARSE_EXTENDED_TIMESTAMP;
				}
				break;
			case RTMP_PARSE_EXTENDED_TIMESTAMP:
				size = rtmpHeaderSize[parserPacket.header.fmt] + parserBasicBytes;
				if (parserPacket.header.timestamp === 0xffffff) {
					size += 4;
				}
				while (parserBytes < size && offset < bytes) {
					parserBuffer[parserBytes++] = data[position + offset++];
				}
				if (parserBytes >= size) {
					if (parserPacket.header.timestamp === 0xffffff) {
						extended_timestamp = parserBuffer.readUInt32BE(rtmpHeaderSize[parserPacket.header.fmt] + parserBasicBytes);
					} else {
						extended_timestamp = parserPacket.header.timestamp;
					}

					if (parserPacket.bytes === 0) {
						if (RTMP_CHUNK_TYPE_0 === parserPacket.header.fmt) {
							parserPacket.clock = extended_timestamp;
						} else {
							parserPacket.clock += extended_timestamp;
						}
						if (parserPacket.capacity < parserPacket.header.length) {
							parserPacket.payload = Buffer.alloc(parserPacket.header.length + 1024);
							parserPacket.capacity = parserPacket.header.length + 1024;
						}
					}
					parserState = RTMP_PARSE_PAYLOAD;
				}
				break;
			case RTMP_PARSE_PAYLOAD:
				size = Math.min(this.inChunkSize - (parserPacket.bytes % this.inChunkSize), parserPacket.header.length - parserPacket.bytes);
				size = Math.min(size, bytes - offset);
				if (size > 0) {
					data.copy(parserPacket.payload, parserPacket.bytes, position + offset, position + offset + size);
				}
				parserPacket.bytes += size;
				offset += size;

				if (parserPacket.bytes >= parserPacket.header.length) {
					parserState = RTMP_PARSE_INIT;
					parserPacket.bytes = 0;
					if (parserPacket.clock > 0xffffffff) {
						break;
					}
					this.packetHandler();
				} else if (0 === parserPacket.bytes % this.inChunkSize) {
					parserState = RTMP_PARSE_INIT;
				}
				break;
		}
	}
	return null;
}

export function packetParse(parserBasicBytes, parserBuffer) {
	let codec_type;
	let fmt = parserBuffer[0] >> 6;
	let offset = parserBasicBytes;
	// timestamp / delta
	if (fmt <= RTMP_CHUNK_TYPE_2) offset += 3;
	// message length + type
	if (fmt <= RTMP_CHUNK_TYPE_1) codec_type = parserBuffer[offset + 3];
	return { fmt, codec_type };
}
