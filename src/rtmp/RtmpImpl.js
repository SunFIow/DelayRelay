import { createHmac, randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import * as AMF from '../../copyof-node-media-server/src/protocol/amf.js';
import Flv from '../../copyof-node-media-server/src/protocol/flv.js';
import Rtmp from '../../copyof-node-media-server/src/protocol/rtmp.js';
import { LOGGER } from '../logger.js';
import {
	CodecType,
	GenuineFMSConst,
	GenuineFMSConstCrud,
	GenuineFPConst,
	MAX_CHUNK_HEADER,
	MESSAGE_FORMAT_0,
	MESSAGE_FORMAT_1,
	RTMP_CHANNEL_COMMAND,
	RTMP_CHANNEL_DATA,
	RTMP_CHUNK_SIZE,
	RTMP_CHUNK_TYPE_0,
	RTMP_CHUNK_TYPE_1,
	RTMP_CHUNK_TYPE_2,
	RTMP_HANDSHAKE_BEGIN,
	RTMP_HANDSHAKE_COMP,
	RTMP_HANDSHAKE_CONT,
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

/**
 * RtmpImpl — protocol-only implementation for RTMP parsing and message creation.
 *
 * EventEmitter-based public API (preferred):
 *  - Events emitted:
 * 															CLIENT				|				SERVER
 *		- 'beginHandshake' (buffer)	: sent C0+C1 wait S0+S1+S2		|	wait C0+C1
 *		- 'continueHandshake'			: got S0+S1+S2 sent C2			|	got C0+C1 sent S0+S1+S2 wait C2
 *		- 'completedHandshake'			: sent C2 							|	got C2
 *		- 'packet' (object)				: 										|	parsed FLV/AV packet (audio/video/data)
 *		- 'response' (Buffer)			: 										|	raw RTMP chunks produced to be written to socket
 *		- 'control' (object)				: 										|	control/control-message details
 *		- 'command' (object)				: 										|	command messages (AMF decoded)
 *		- 'error' (Error|string)		: 										|	error conditions
 *
 *  - Public methods (existing):
 *    - feed(buffer)              : feed incoming bytes into the parser
 *    - sendACK/ sendWindowACK/ ...    : helpers that produce response buffers
 */
export class RtmpImpl extends EventEmitter {
	constructor({ name, role = 'server' } = {}) {
		super();
		this.role = role;
		this.name = name ?? 'RTMP';

		this.handshakePayload = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
		this.handshakeState = role === 'server' ? RTMP_HANDSHAKE_UNINIT : undefined;
		this.handshakeBytes = 0;

		this.parserBuffer = Buffer.alloc(MAX_CHUNK_HEADER);
		this.parserState = RTMP_PARSE_INIT;
		this.parserBytes = 0;
		this.parserBasicBytes = 0;
		this.parserPacket = new RtmpPacket();
		this.inPackets = new Map();

		this.inChunkSize = RTMP_CHUNK_SIZE;
		this.outChunkSize = 4096; // RTMP_MAX_CHUNK_SIZE;

		this.streams = 0;
		this.flv = new Flv();

		this.pktType = -1;
		this.pktFlags = -1;
	}

	feed(chunks) {
		let bytesRemaining = chunks.length;
		let position = 0;
		let bytesToProcess = 0;
		while (bytesRemaining > 0) {
			switch (this.handshakeState) {
				case RTMP_HANDSHAKE_UNINIT:
					LOGGER.trace(`[${this.name}] Got C0/S0 - starting Handshake`);
					this.handshakeState = RTMP_HANDSHAKE_BEGIN;
					this.handshakeBytes = 0;
					bytesRemaining -= 1;
					position += 1;
					break;
				case RTMP_HANDSHAKE_BEGIN:
					LOGGER.trace(`[${this.name}] waiting for C1/S1 Handshake`);
					bytesToProcess = RTMP_HANDSHAKE_SIZE - this.handshakeBytes;
					if (bytesToProcess > bytesRemaining) bytesToProcess = bytesRemaining;
					chunks.copy(this.handshakePayload, this.handshakeBytes, position, position + bytesToProcess);
					this.handshakeBytes += bytesToProcess;
					bytesRemaining -= bytesToProcess;
					position += bytesToProcess;
					if (this.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
						LOGGER.trace(`[${this.name}] Got C1/S1 - continue Handshake`);
						this.handshakeState = RTMP_HANDSHAKE_CONT;
						this.handshakeBytes = 0;
						if (this.role === 'server') {
							const s0s1s2 = generateS0S1S2(this.handshakePayload);
							this.emit('response', s0s1s2);
						}
						this.emit('continueHandshake');
					}
					break;
				case RTMP_HANDSHAKE_CONT:
					LOGGER.trace(`[${this.name}] waiting for C2/S2 Handshake`);
					bytesToProcess = RTMP_HANDSHAKE_SIZE - this.handshakeBytes;
					if (bytesToProcess > bytesRemaining) bytesToProcess = bytesRemaining;
					chunks.copy(this.handshakePayload, this.handshakeBytes, position, bytesToProcess);
					this.handshakeBytes += bytesToProcess;
					bytesRemaining -= bytesToProcess;
					position += bytesToProcess;
					if (this.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
						LOGGER.trace(`[${this.name}] Got C2/S2 - completed Handshake`);
						this.handshakeState = RTMP_HANDSHAKE_COMP;
						this.handshakeBytes = 0;
						if (this.role === 'client') {
							const c2 = generateC2(this.handshakePayload);
							this.emit('response', c2);
						}
						this.emit('completedHandshake');
					}
					break;
				case RTMP_HANDSHAKE_COMP:
					return this.chunkRead(chunks, position, bytesRemaining);
				default:
					LOGGER.warn(`[${this.name}] Unexpected handshake state:`, this.handshakeState);
					break;
			}
		}
		return null;
	}

	chunkRead(data, position, bytes) {
		let size = 0;
		let offset = 0;
		let extended_timestamp = 0;

		while (offset < bytes) {
			switch (this.parserState) {
				case RTMP_PARSE_INIT:
					// LOGGER.trace(`[${this.name}] Parsing initialized`);
					this.parserBytes = 1;
					this.parserBuffer[0] = data[position + offset++];
					if (0 === (this.parserBuffer[0] & 0x3f)) this.parserBasicBytes = 2;
					else if (1 === (this.parserBuffer[0] & 0x3f)) this.parserBasicBytes = 3;
					else this.parserBasicBytes = 1;
					this.parserState = RTMP_PARSE_BASIC_HEADER;
					break;
				case RTMP_PARSE_BASIC_HEADER:
					// LOGGER.trace(`[${this.name}] Parsing basic header`);
					while (this.parserBytes < this.parserBasicBytes && offset < bytes) {
						this.parserBuffer[this.parserBytes++] = data[position + offset++];
					}
					if (this.parserBytes >= this.parserBasicBytes) {
						this.parserState = RTMP_PARSE_MESSAGE_HEADER;
					}
					break;
				case RTMP_PARSE_MESSAGE_HEADER:
					// LOGGER.trace(`[${this.name}] Parsing message header`);
					size = rtmpHeaderSize[this.parserBuffer[0] >> 6] + this.parserBasicBytes;
					while (this.parserBytes < size && offset < bytes) {
						this.parserBuffer[this.parserBytes++] = data[position + offset++];
					}
					if (this.parserBytes >= size) {
						this.packetParse();
						this.parserState = RTMP_PARSE_EXTENDED_TIMESTAMP;
					}
					break;
				case RTMP_PARSE_EXTENDED_TIMESTAMP:
					// LOGGER.trace(`[${this.name}] Parsing extended timestamp`);
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
							this.packetAlloc();
						}
						this.parserState = RTMP_PARSE_PAYLOAD;
					}
					break;
				case RTMP_PARSE_PAYLOAD:
					// LOGGER.trace(`[${this.name}] Parsing payload`);
					size = Math.min(this.inChunkSize - (this.parserPacket.bytes % this.inChunkSize), this.parserPacket.header.length - this.parserPacket.bytes);
					size = Math.min(size, bytes - offset);
					if (size > 0) {
						data.copy(this.parserPacket.payload, this.parserPacket.bytes, position + offset, position + offset + size);
					}
					this.parserPacket.bytes += size;
					offset += size;

					// LOGGER.trace(`[${this.name}] Parsed ${size} bytes, total: ${this.parserPacket.bytes}/${this.parserPacket.header.length}`);
					if (this.parserPacket.bytes >= this.parserPacket.header.length) {
						this.parserState = RTMP_PARSE_INIT;
						this.parserPacket.bytes = 0;
						if (this.parserPacket.clock > 0xffffffff) {
							break;
						}
						this.packetHandler();
					} else if (0 === this.parserPacket.bytes % this.inChunkSize) {
						this.parserState = RTMP_PARSE_INIT;
					}
					break;
			}
		}
		return null;
	}

	packetAlloc() {
		if (this.parserPacket.capacity < this.parserPacket.header.length) {
			this.parserPacket.payload = Buffer.alloc(this.parserPacket.header.length + 1024);
			this.parserPacket.capacity = this.parserPacket.header.length + 1024;
		}
	}

	packetParse() {
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
		this.chunkMessageHeaderRead();
	}

	chunkMessageHeaderRead() {
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

	packetHandler() {
		const payload = this.parserPacket.payload;
		const type = this.parserPacket.header.type;
		const size = this.parserPacket.header.length;

		switch (type) {
			case CodecType.SET_PACKET_SIZE:
				this.inChunkSize = payload.readUInt32BE(0);
				LOGGER.info(`[${this.name}] Set chunk size: ${this.inChunkSize}`);
				this.emit('control', { type, name: 'setChunkSize', size: this.inChunkSize });
				this.emit('ctrl:setChunkSize', this.inChunkSize);
				break;
			case CodecType.ABORT:
				LOGGER.info(`[${this.name}] Abort`);
				this.emit('control', { type, name: 'abort' });
				this.emit('ctrl:abort');
				break;
			case CodecType.ACKNOWLEDGE:
				LOGGER.info(`[${this.name}] Acknowledge`);
				this.emit('control', { type, name: 'acknowledge' });
				this.emit('ctrl:acknowledge');
				break;
			case CodecType.SERVER_BANDWIDTH:
				this.ackSize = payload.readUInt32BE(0);
				LOGGER.info(`[${this.name}] Server bandwidth: ${this.ackSize}`);
				this.emit('control', { type, name: 'serverBandwidth', size: this.ackSize });
				this.emit('ctrl:serverBandwidth', this.ackSize);
				break;
			case CodecType.CLIENT_BANDWIDTH:
				this.cltSize = payload.readUInt32BE(0);
				LOGGER.info(`[${this.name}] Client bandwidth: ${this.cltSize}`);
				this.emit('control', { type, name: 'clientBandwidth', size: this.cltSize });
				this.emit('ctrl:clientBandwidth', this.cltSize);
				break;
			case CodecType.CONTROL:
				LOGGER.info(`[${this.name}] Control`);
				this.emit('control', { type, name: 'control' });
				this.emit('ctrl:control');
				break;
			case CodecType.COMMAND_EXTENDED:
			case CodecType.COMMAND:
				const offset = type === CodecType.COMMAND_EXTENDED ? 1 : 0; // COMMAND_EXTENDED uses 1-byte prefix
				const cmd_payload = payload.subarray(offset, size);
				const cmd_message = AMF.decodeAmf0Cmd(cmd_payload);
				const cmd = cmd_message.cmd;
				this.emit('command', cmd_message);
				this.emit(`cmd:${cmd}`, cmd_message);
				break;
			case CodecType.AUDIO:
			case CodecType.VIDEO:
			case CodecType.DATA_EXTENDED: // AMF3
			case CodecType.DATA: // AMF0
				return this.dataHandler();
		}
	}

	dataHandler() {
		const packet = Flv.parserTag(this.parserPacket.header.type, this.parserPacket.clock, this.parserPacket.header.length, this.parserPacket.payload);
		const buf = Rtmp.createMessage(packet, this.outChunkSize);
		LOGGER.trace(`[${this.name}] Data handler called (${this.outChunkSize}): ${buf.length}`);
		this.pktType = packet.codec_type;
		this.pktFlags = packet.flags;
		this.emit('packet', { type: this.pktType, flags: this.pktFlags, payload: buf });
	}

	sendACK(size) {
		const chunks = Buffer.from('02000000000004030000000000000000', 'hex');
		chunks.writeUInt32BE(size, 12);
		this.emit('response', chunks);
	}

	sendWindowACK(size) {
		const chunks = Buffer.from('02000000000004050000000000000000', 'hex');
		chunks.writeUInt32BE(size, 12);
		this.emit('response', chunks);
	}

	setPeerBandwidth(size, type) {
		const chunks = Buffer.from('0200000000000506000000000000000000', 'hex');
		chunks.writeUInt32BE(size, 12);
		chunks[16] = type;
		this.emit('response', chunks);
	}

	setChunkSize(size) {
		const chunks = Buffer.from('02000000000004010000000000000000', 'hex');
		chunks.writeUInt32BE(size, 12);
		this.emit('response', chunks);
	}

	sendCommandMessage(opt, sid) {
		const packet = new RtmpPacket();
		packet.header.fmt = RTMP_CHUNK_TYPE_0;
		packet.header.cid = RTMP_CHANNEL_COMMAND;
		packet.header.type = CodecType.COMMAND;
		packet.header.stream_id = sid;
		packet.payload = AMF.encodeAmf0Cmd(opt);
		packet.header.length = packet.payload.length;
		const chunks = Rtmp.chunksCreate(packet, this.outChunkSize);
		LOGGER.trace(`[${this.name}] Sending command message: ${opt.cmd} (${opt.transId})`, opt);
		this.emit('response', chunks);
	}

	sendDataMessage(opt, sid) {
		const packet = new RtmpPacket();
		packet.header.fmt = RTMP_CHUNK_TYPE_0;
		packet.header.cid = RTMP_CHANNEL_DATA;
		packet.header.type = CodecType.DATA;
		packet.payload = AMF.encodeAmf0Data(opt);
		packet.header.length = packet.payload.length;
		packet.header.stream_id = sid;
		const chunks = Rtmp.chunksCreate(packet, this.outChunkSize);
		this.emit('response', chunks);
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
		this.sendCommandMessage(opt, sid);
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

/** @returns {Buffer}  */
export function generateC0C1() {
	const c0 = Buffer.alloc(1, 3); // RTMP Protocol version 3
	const c1 = Buffer.alloc(8);
	// const now = Math.floor(Date.now() / 1000); // timestamp in seconds
	const now = Date.now() >>> 0; // timestamp in milliseconds
	c1.writeUInt32BE(now, 0);
	c1.writeUInt32BE(0, 4);
	const rndmBytes = randomBytes(RTMP_HANDSHAKE_SIZE - 8);
	return Buffer.concat([c0, c1, rndmBytes]);
}

/** @param {Buffer} serverSig @returns {Buffer}  */
function generateC2(serverSig) {
	// const serverType = Buffer.alloc(1, 3);
	// const messageFormat = detectServerMessageFormat(serverSig);
	let allBytes;
	// if (messageFormat === MESSAGE_FORMAT_0) {
	// 	// logger.debug('[rtmp handshake] using simple handshake.');
	allBytes = serverSig.subarray(0, RTMP_HANDSHAKE_SIZE);
	// } else {
	// 	//    logger.debug('[rtmp handshake] using complex handshake.');
	// 	let c2 = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
	// 	// TODO: generate C2
	// 	allBytes = c2;
	// }
	return allBytes;
}

/** @param {Buffer} clientsig @returns {Buffer}  */
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

/** @param {Buffer} clientsig @returns {number} */
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

/** @param {Buffer} buf @returns {number} */
function GetClientGenuineConstDigestOffset(buf) {
	let offset = buf[0] + buf[1] + buf[2] + buf[3];
	offset = (offset % 728) + 12;
	return offset;
}

/** @param {Buffer} buf @returns {number} */
function GetServerGenuineConstDigestOffset(buf) {
	let offset = buf[0] + buf[1] + buf[2] + buf[3];
	offset = (offset % 728) + 776;
	return offset;
}

/** @param {Buffer} data @param {Buffer | string} key @returns Buffer} */
function calcHmac(data, key) {
	const hmac = createHmac('sha256', key);
	hmac.update(data);
	return hmac.digest();
}

/** @param {number} messageFormat @returns {Buffer} */
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
 * @param {number} messageFormat @param {Buffer} clientsig @returns {Buffer} */
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
