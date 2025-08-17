import { createHmac, randomBytes } from 'crypto';
import AVPacket from '../../copyof-node-media-server/src/core/avpacket.js';
import * as AMF from '../../copyof-node-media-server/src/protocol/amf.js';
import Flv from '../../copyof-node-media-server/src/protocol/flv.js';
import Rtmp from '../../copyof-node-media-server/src/protocol/rtmp.js';
import { LOGGER } from '../logger.js';
import { RTMP_TYPE_DATA, RTMP_TYPE_INVOKE } from '../parsing.js';
import {
	CodecType,
	GenuineFMSConst,
	GenuineFMSConstCrud,
	GenuineFPConst,
	MAX_CHUNK_HEADER,
	MESSAGE_FORMAT_0,
	MESSAGE_FORMAT_1,
	RTMP_CHANNEL_DATA,
	RTMP_CHANNEL_INVOKE,
	RTMP_CHUNK_SIZE,
	RTMP_CHUNK_TYPE_0,
	RTMP_CHUNK_TYPE_1,
	RTMP_CHUNK_TYPE_2,
	RTMP_HANDSHAKE_0,
	RTMP_HANDSHAKE_1,
	RTMP_HANDSHAKE_2,
	RTMP_HANDSHAKE_SIZE,
	RTMP_HANDSHAKE_UNINIT,
	RTMP_MAX_CHUNK_SIZE,
	RTMP_PARSE_BASIC_HEADER,
	RTMP_PARSE_EXTENDED_TIMESTAMP,
	RTMP_PARSE_INIT,
	RTMP_PARSE_MESSAGE_HEADER,
	RTMP_PARSE_PAYLOAD,
	rtmpHeaderSize,
	SHA256DL
} from './consts.js';
import { RtmpPacket } from './RtmpPacket.js';

export class RtmpImpl {
	constructor() {
		this.inChunks = 0;
		this.handshakePayload = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
		this.handshakeState = RTMP_HANDSHAKE_UNINIT;
		this.handshakeBytes = 0;

		this.parserBuffer = Buffer.alloc(MAX_CHUNK_HEADER);
		this.parserState = RTMP_PARSE_INIT;
		this.parserBytes = 0;
		this.parserBasicBytes = 0;
		this.parserPacket = new RtmpPacket();
		this.inPackets = new Map();

		this.inChunkSize = RTMP_CHUNK_SIZE;
		this.outChunkSize = RTMP_MAX_CHUNK_SIZE;

		this.streams = 0;
		this.flv = new Flv();
	}

	/** @param {AVPacket} packet */
	onPacketCallback(packet) {
		// Handle the parsed FLV packet
		LOGGER.trace(`[RTMP] Packet callback called for type ${packet.codec_type}, flags: ${packet.flags}`);
	}

	/** @param {Buffer} chunks */
	onResponseCallback(chunks) {
		// Handle the output callback
		LOGGER.trace(`[RTMP] Output callback called with ${chunks?.length} bytes`);
	}

	/**
	 * @param {Buffer} chunks The incoming RTMP chunks.
	 * @returns {string | undefined} Returns an error message if parsing failed
	 */
	parseData(chunks) {
		const error = this._parserData(chunks); // Parse RTMP data
		return error;
	}

	_parserData(chunks) {
		this.inChunks = chunks.length;
		let bytesRemaining = chunks.length;
		let position = 0;
		let bytesToProcess = 0;
		while (bytesRemaining > 0) {
			switch (this.handshakeState) {
				case RTMP_HANDSHAKE_UNINIT:
					LOGGER.trace('[RTMP] starting Handshake');
					this.handshakeState = RTMP_HANDSHAKE_0;
					this.handshakeBytes = 0;
					bytesRemaining -= 1;
					position += 1;
					break;
				case RTMP_HANDSHAKE_0:
					LOGGER.trace('[RTMP] Handshake waiting for C0 + C1');
					bytesToProcess = RTMP_HANDSHAKE_SIZE - this.handshakeBytes;
					if (bytesToProcess > bytesRemaining) bytesToProcess = bytesRemaining;
					chunks.copy(this.handshakePayload, this.handshakeBytes, position, position + bytesToProcess);
					this.handshakeBytes += bytesToProcess;
					bytesRemaining -= bytesToProcess;
					position += bytesToProcess;
					if (this.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
						this.handshakeState = RTMP_HANDSHAKE_1;
						this.handshakeBytes = 0;
						const s0s1s2 = generateS0S1S2(this.handshakePayload);
						// Send S0, S1, S2
						this.onResponseCallback(s0s1s2);
					}
					break;
				case RTMP_HANDSHAKE_1:
					LOGGER.trace('[RTMP] Handshake waiting for C2');
					bytesToProcess = RTMP_HANDSHAKE_SIZE - this.handshakeBytes;
					if (bytesToProcess > bytesRemaining) bytesToProcess = bytesRemaining;
					chunks.copy(this.handshakePayload, this.handshakeBytes, position, bytesToProcess);
					this.handshakeBytes += bytesToProcess;
					bytesRemaining -= bytesToProcess;
					position += bytesToProcess;
					if (this.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
						// TODO: validate C2 is our sent S1
						// LOGGER.trace('[RTMP] Handshake completed');
						this.handshakeState = RTMP_HANDSHAKE_2;
						this.handshakeBytes = 0;
					}
					break;
				case RTMP_HANDSHAKE_2:
					return this._chunkRead(chunks, position, bytesRemaining);
				default:
					LOGGER.warn('[RTMP] Unexpected handshake state:', this.handshakeState);
					break;
			}
		}
		return null;
	}

	_chunkRead(data, position, bytes) {
		let size = 0;
		let offset = 0;
		let extended_timestamp = 0;

		while (offset < bytes) {
			switch (this.parserState) {
				case RTMP_PARSE_INIT:
					// LOGGER.trace('[RTMP] Parsing initialized');
					this.parserBytes = 1;
					this.parserBuffer[0] = data[position + offset++];
					if (0 === (this.parserBuffer[0] & 0x3f)) this.parserBasicBytes = 2;
					else if (1 === (this.parserBuffer[0] & 0x3f)) this.parserBasicBytes = 3;
					else this.parserBasicBytes = 1;
					this.parserState = RTMP_PARSE_BASIC_HEADER;
					break;
				case RTMP_PARSE_BASIC_HEADER:
					// LOGGER.trace('[RTMP] Parsing basic header');
					while (this.parserBytes < this.parserBasicBytes && offset < bytes) {
						this.parserBuffer[this.parserBytes++] = data[position + offset++];
					}
					if (this.parserBytes >= this.parserBasicBytes) {
						this.parserState = RTMP_PARSE_MESSAGE_HEADER;
					}
					break;
				case RTMP_PARSE_MESSAGE_HEADER:
					// LOGGER.trace('[RTMP] Parsing message header');
					size = rtmpHeaderSize[this.parserBuffer[0] >> 6] + this.parserBasicBytes;
					while (this.parserBytes < size && offset < bytes) {
						this.parserBuffer[this.parserBytes++] = data[position + offset++];
					}
					if (this.parserBytes >= size) {
						this._packetParse();
						this.parserState = RTMP_PARSE_EXTENDED_TIMESTAMP;
					}
					break;
				case RTMP_PARSE_EXTENDED_TIMESTAMP:
					// LOGGER.trace('[RTMP] Parsing extended timestamp');
					size = rtmpHeaderSize[this.parserPacket.header.fmt] + this.parserBasicBytes;
					if (this.parserPacket.header.timestamp === 0xffffff) {
						size += 4;
					}
					while (this.parserBytes < size && offset < bytes) {
						this.parserBuffer[this.parserBytes++] = data[position + offset++];
					}
					if (this.parserBytes >= size) {
						if (this.parserPacket.header.timestamp === 0xffffff) {
							extended_timestamp = this.parserBuffer.readUInt32BE(rtmpHeaderSize[this.parserPacket.header.fmt] + this.parserBasicBytes);
						} else {
							extended_timestamp = this.parserPacket.header.timestamp;
						}

						if (this.parserPacket.bytes === 0) {
							if (RTMP_CHUNK_TYPE_0 === this.parserPacket.header.fmt) {
								this.parserPacket.clock = extended_timestamp;
							} else {
								this.parserPacket.clock += extended_timestamp;
							}
							this._packetAlloc();
						}
						this.parserState = RTMP_PARSE_PAYLOAD;
					}
					break;
				case RTMP_PARSE_PAYLOAD:
					// LOGGER.trace('[RTMP] Parsing payload');
					size = Math.min(this.inChunkSize - (this.parserPacket.bytes % this.inChunkSize), this.parserPacket.header.length - this.parserPacket.bytes);
					size = Math.min(size, bytes - offset);
					if (size > 0) {
						data.copy(this.parserPacket.payload, this.parserPacket.bytes, position + offset, position + offset + size);
					}
					this.parserPacket.bytes += size;
					offset += size;

					// LOGGER.trace(`[RTMP] Parsed ${size} bytes, total: ${this.parserPacket.bytes}/${this.parserPacket.header.length}`);
					if (this.parserPacket.bytes >= this.parserPacket.header.length) {
						this.parserState = RTMP_PARSE_INIT;
						this.parserPacket.bytes = 0;
						if (this.parserPacket.clock > 0xffffffff) {
							break;
						}
						this._packetHandler();
					} else if (0 === this.parserPacket.bytes % this.inChunkSize) {
						this.parserState = RTMP_PARSE_INIT;
					}
					break;
			}
		}
		return null;
	}

	_packetAlloc() {
		if (this.parserPacket.capacity < this.parserPacket.header.length) {
			this.parserPacket.payload = Buffer.alloc(this.parserPacket.header.length + 1024);
			this.parserPacket.capacity = this.parserPacket.header.length + 1024;
		}
	}

	_packetParse() {
		const fmt = this.parserBuffer[0] >> 6;
		let cid = 0;
		if (this.parserBasicBytes === 2) {
			cid = 64 + this.parserBuffer[1];
		} else if (this.parserBasicBytes === 3) {
			cid = (64 + this.parserBuffer[1] + this.parserBuffer[2]) << 8;
		} else {
			cid = this.parserBuffer[0] & 0x3f;
		}
		this.parserPacket = this.inPackets.get(cid) ?? new RtmpPacket(fmt, cid);
		this.inPackets.set(cid, this.parserPacket);
		this.parserPacket.header.fmt = fmt;
		this.parserPacket.header.cid = cid;
		this._chunkMessageHeaderRead();
	}

	_chunkMessageHeaderRead() {
		let offset = this.parserBasicBytes;

		// timestamp / delta
		if (this.parserPacket.header.fmt <= RTMP_CHUNK_TYPE_2) {
			this.parserPacket.header.timestamp = this.parserBuffer.readUIntBE(offset, 3);
			offset += 3;
		}

		// message length + type
		if (this.parserPacket.header.fmt <= RTMP_CHUNK_TYPE_1) {
			this.parserPacket.header.length = this.parserBuffer.readUIntBE(offset, 3);
			this.parserPacket.header.type = this.parserBuffer[offset + 3];
			// LOGGER_API.debug(`[CODEC]: ${this.parserPacket.header.type}`);
			offset += 4;
		}

		if (this.parserPacket.header.fmt === RTMP_CHUNK_TYPE_0) {
			this.parserPacket.header.stream_id = this.parserBuffer.readUInt32LE(offset);
			offset += 4;
		}
		return offset;
	}

	_packetHandler() {
		switch (this.parserPacket.header.type) {
			case CodecType.SET_PACKET_SIZE:
			case CodecType.ABORT:
			case CodecType.ACKNOWLEDGE:
			case CodecType.SERVER_BANDWIDTH:
			case CodecType.CLIENT_BANDWIDTH:
				return this._controlHandler();
			case CodecType.CONTROL:
				return this._eventHandler();
			case CodecType.COMMAND_EXTENDED:
			case CodecType.COMMAND:
				return this._invokeHandler();
			case CodecType.AUDIO:
			case CodecType.VIDEO:
			case CodecType.DATA_EXTENDED: // AMF3
			case CodecType.DATA: // AMF0
				return this._dataHandler();
		}
	}

	_controlHandler() {
		LOGGER.trace(`[RTMP] Control handler called for type ${this.parserPacket.header.type}`);
		const payload = this.parserPacket.payload;
		switch (this.parserPacket.header.type) {
			case CodecType.SET_PACKET_SIZE:
				this.inChunkSize = payload.readUInt32BE();
				// LOGGER.debug('set inChunkSize', this.inChunkSize);
				break;
			case CodecType.ABORT:
				break;
			case CodecType.ACKNOWLEDGE:
				break;
			case CodecType.SERVER_BANDWIDTH:
				this.ackSize = payload.readUInt32BE();
				// LOGGER.debug('set ack Size', this.ackSize);
				break;
			case CodecType.CLIENT_BANDWIDTH:
				break;
		}
	}

	_eventHandler() {
		LOGGER.trace(`[RTMP] Event handler called for type ${this.parserPacket.header.type}`);
	}

	_invokeHandler() {}

	_dataHandler() {
		const packet = Flv.parserTag(this.parserPacket.header.type, this.parserPacket.clock, this.parserPacket.header.length, this.parserPacket.payload);
		const buf = Rtmp.createMessage(packet, this.inChunkSize);
		LOGGER.trace(`[RTMP] Data handler called: ${this.inChunks}, ${this.parserPacket.header.length}, ${packet.size}, ${buf.length}`);
		this.onPacketCallback(packet);
	}

	sendACK(size) {
		const rtmpBuffer = Buffer.from('02000000000004030000000000000000', 'hex');
		rtmpBuffer.writeUInt32BE(size, 12);
		this.onResponseCallback(rtmpBuffer);
	}

	sendWindowACK(size) {
		const rtmpBuffer = Buffer.from('02000000000004050000000000000000', 'hex');
		rtmpBuffer.writeUInt32BE(size, 12);
		this.onResponseCallback(rtmpBuffer);
	}

	setPeerBandwidth(size, type) {
		const rtmpBuffer = Buffer.from('0200000000000506000000000000000000', 'hex');
		rtmpBuffer.writeUInt32BE(size, 12);
		rtmpBuffer[16] = type;
		this.onResponseCallback(rtmpBuffer);
	}

	setChunkSize(size) {
		const rtmpBuffer = Buffer.from('02000000000004010000000000000000', 'hex');
		rtmpBuffer.writeUInt32BE(size, 12);
		this.onResponseCallback(rtmpBuffer);
	}

	sendStreamStatus(st, id) {
		const rtmpBuffer = Buffer.from('020000000000060400000000000000000000', 'hex');
		rtmpBuffer.writeUInt16BE(st, 12);
		rtmpBuffer.writeUInt32BE(id, 14);
		this.onResponseCallback(rtmpBuffer);
	}

	sendInvokeMessage(sid, opt) {
		const packet = new RtmpPacket();
		packet.header.fmt = RTMP_CHUNK_TYPE_0;
		packet.header.cid = RTMP_CHANNEL_INVOKE;
		packet.header.type = RTMP_TYPE_INVOKE; // CodecType.COMMAND
		packet.header.stream_id = sid;
		packet.payload = AMF.encodeAmf0Cmd(opt);
		packet.header.length = packet.payload.length;
		const chunks = Rtmp.chunksCreate(packet);
		LOGGER.trace(`[RTMP] Sending invoke message: ${opt.cmd} (${opt.transId})`, opt);
		this.onResponseCallback(chunks);
	}

	sendDataMessage(opt, sid) {
		const packet = new RtmpPacket();
		packet.header.fmt = RTMP_CHUNK_TYPE_0;
		packet.header.cid = RTMP_CHANNEL_DATA;
		packet.header.type = RTMP_TYPE_DATA; // CodecType.DATA
		packet.payload = AMF.encodeAmf0Data(opt);
		packet.header.length = packet.payload.length;
		packet.header.stream_id = sid;
		const chunks = Rtmp.chunksCreate(packet);
		this.onResponseCallback(chunks);
	}

	sendStatusMessage(sid, level, code, description) {
		const opt = {
			cmd: 'onStatus',
			transId: 0,
			cmdObj: null,
			info: {
				level: level,
				code: code,
				description: description
			}
		};
		this.sendInvokeMessage(sid, opt);
	}

	sendRtmpSampleAccess(sid) {
		const opt = {
			cmd: '|RtmpSampleAccess',
			bool1: false,
			bool2: false
		};
		this.sendDataMessage(opt, sid);
	}
}

/**
 * @param {Buffer} clientsig
 * @returns {Buffer}
 */
function generateS0S1S2(clientsig) {
	const clientType = Buffer.alloc(1, 3);
	const messageFormat = detectClientMessageFormat(clientsig);
	let allBytes;
	if (messageFormat === MESSAGE_FORMAT_0) {
		//    logger.debug('[rtmp handshake] using simple handshake.');
		allBytes = Buffer.concat([clientType, clientsig, clientsig]);
	} else {
		//    logger.debug('[rtmp handshake] using complex handshake.');
		allBytes = Buffer.concat([clientType, generateS1(messageFormat), generateS2(messageFormat, clientsig)]);
	}
	return allBytes;
}

/**
 *
 * @param {Buffer} clientsig
 * @returns {number}
 */
function detectClientMessageFormat(clientsig) {
	let computedSignature, msg, providedSignature, sdl;
	sdl = GetServerGenuineConstDigestOffset(clientsig.subarray(772, 776));
	msg = Buffer.concat([clientsig.subarray(0, sdl), clientsig.subarray(sdl + SHA256DL)], 1504);
	computedSignature = calcHmac(msg, GenuineFPConst);
	providedSignature = clientsig.subarray(sdl, sdl + SHA256DL);
	if (computedSignature.equals(providedSignature)) {
		return MESSAGE_FORMAT_2;
	}
	sdl = GetClientGenuineConstDigestOffset(clientsig.subarray(8, 12));
	msg = Buffer.concat([clientsig.subarray(0, sdl), clientsig.subarray(sdl + SHA256DL)], 1504);
	computedSignature = calcHmac(msg, GenuineFPConst);
	providedSignature = clientsig.subarray(sdl, sdl + SHA256DL);
	if (computedSignature.equals(providedSignature)) {
		return MESSAGE_FORMAT_1;
	}
	return MESSAGE_FORMAT_0;
}

/**
 *
 * @param {Buffer} buf
 * @returns {number}
 */
function GetClientGenuineConstDigestOffset(buf) {
	let offset = buf[0] + buf[1] + buf[2] + buf[3];
	offset = (offset % 728) + 12;
	return offset;
}

/**
 *
 * @param {Buffer} buf
 * @returns {number}
 */
function GetServerGenuineConstDigestOffset(buf) {
	let offset = buf[0] + buf[1] + buf[2] + buf[3];
	offset = (offset % 728) + 776;
	return offset;
}
/**
 *
 * @param {Buffer} data
 * @param {Buffer | string} key
 * @returns {Buffer}
 */
function calcHmac(data, key) {
	const hmac = createHmac('sha256', key);
	hmac.update(data);
	return hmac.digest();
}

/**
 *
 * @param {number} messageFormat
 * @returns {Buffer}
 */
function generateS1(messageFormat) {
	const rndmBytes = randomBytes(RTMP_HANDSHAKE_SIZE - 8);
	const s1Bytes = Buffer.concat([Buffer.from([0, 0, 0, 0, 1, 2, 3, 4]), rndmBytes], RTMP_HANDSHAKE_SIZE);

	const digestStart = messageFormat === MESSAGE_FORMAT_1 ? 8 : 772;
	const serverDigestOffset = GetClientGenuineConstDigestOffset(s1Bytes.subarray(digestStart, digestStart + 4));

	const msg = Buffer.concat([s1Bytes.subarray(0, serverDigestOffset), s1Bytes.subarray(serverDigestOffset + SHA256DL)], RTMP_HANDSHAKE_SIZE - SHA256DL);
	const hash = calcHmac(msg, GenuineFMSConst);
	hash.copy(s1Bytes, serverDigestOffset, 0, 32);
	return s1Bytes;
}

/**
 *
 * @param {number} messageFormat
 * @param {Buffer} clientsig
 * @returns {Buffer}
 */
function generateS2(messageFormat, clientsig) {
	const rndmBytes = randomBytes(RTMP_HANDSHAKE_SIZE - 32);

	const keyStart = messageFormat === MESSAGE_FORMAT_1 ? 8 : 772;
	const challengeKeyOffset = GetClientGenuineConstDigestOffset(clientsig.subarray(keyStart, keyStart + 4));

	const challengeKey = clientsig.subarray(challengeKeyOffset, challengeKeyOffset + 32);
	const hash = calcHmac(challengeKey, GenuineFMSConstCrud);
	const signature = calcHmac(rndmBytes, hash);
	const s2Bytes = Buffer.concat([rndmBytes, signature], RTMP_HANDSHAKE_SIZE);
	return s2Bytes;
}
