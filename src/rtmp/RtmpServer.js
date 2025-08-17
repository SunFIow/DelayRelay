import querystring from 'querystring';
import * as AMF from '../../copyof-node-media-server/src/protocol/amf.js';
import { LOGGER } from '../logger.js';
import {
	CodecType,
	FLV_AVC_SEQUENCE_HEADER,
	FLV_CODECID_AAC,
	FLV_CODECID_H264,
	FLV_FRAME_KEY,
	FOURCC_AV1,
	FOURCC_HEVC,
	FOURCC_VP9,
	PacketFlags,
	PacketTypeCodedFrames,
	PacketTypeCodedFramesX,
	PacketTypeMetadata,
	PacketTypeMPEG2TSSequenceStart,
	PacketTypeSequenceStart,
	STREAM_BEGIN
} from './consts.js';
import RtmpClient from './RtmpClient.js';
import { RtmpImpl } from './RtmpImpl.js';

/** Declare a return type for parseData
 * which has a boolean for if an error occurred
 * and then either a string which describes the error or a CodecType
 * @typedef {ParserDataSuccess|ParserDataError} ParserDataResult
 */

/**
 * @typedef {Object} ParserDataSuccess
 * @property {false} error - Indicates if an error occurred during parsing.
 * @property {CodecType} codecType - The codec type of the parsed RTMP packet.
 * @property {PacketFlags} flags - The flags associated with the parsed RTMP packet.
 */

/**
 * @typedef {Object} ParserDataError
 * @property {true} error - Indicates if an error occurred during parsing.
 * @property {string} message - The error message.
 */

export class RtmpServer extends RtmpImpl {
	constructor() {
		super();
		/** @type {RtmpClient[]} */
		this.clients = [];
	}

	/** @param {RtmpClient} client  */
	addClient(client) {
		if (this.clients.find(c => c.name === client.name)) {
			LOGGER.warn(`[RTMP] Client already connected: ${client.name}`);
			return;
		}
		this.clients.push(client);
	}

	sendChunk(chunk) {
		this.clients.forEach(client => client.sendChunk(chunk));
	}

	close() {
		this.clients.forEach(client => client.close());
	}

	/** @abstract @param {object} req */
	onConnectCallback = req => {};

	/** @abstract */
	onPlayCallback = () => {};

	/** @abstract */
	onPushCallback = () => {};

	/**
	 * @param {Buffer} chunks The incoming RTMP chunks.
	 * @returns {ParserDataResult} Either a error message or the RTMP packet type (e.g., 8 for audio, 9 for video, 18 for metadata)
	 */
	parseData(chunks) {
		const error = this._parserData(chunks); // Parse Client RTMP data
		if (error) return { error };
		/** @type {CodecType} */
		const codecType = this.parserPacket.header.type;
		const flags = this._parsePacketFlag();
		return { codecType, flags };
	}

	/** Parses FLV payload to extract only the relevant packet flag.
	 * @param {number} type - RTMP packet type (e.g., 8 for audio, 9 for video, 18 for metadata)
	 * @param {Buffer} payload - The RTMP packet payload (FLV tag data)
	 * @returns {PacketFlags} -1 if not a valid packet type, otherwise returns the packet flag
	 */
	_parsePacketFlag() {
		const codecType = this.parserPacket.header.type;
		const payload = this.parserPacket.payload;

		// Audio packet
		if (codecType === CodecType.AUDIO) {
			const soundFormat = payload[0] >> 4;
			if (soundFormat === FLV_CODECID_AAC) {
				const aacPacketType = payload[1];
				if (aacPacketType === 0) return PacketFlags.AUDIO_HEADER;
			}
			return PacketFlags.AUDIO_FRAME;
		}

		// Video packet
		else if (codecType === CodecType.VIDEO) {
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
		else if (codecType === CodecType.DATA) return PacketFlags.METADATA;

		return -1;
	}

	/**  Handles RTMP invoke messages. */
	_invokeHandler() {
		const offset = this.parserPacket.header.type === CodecType.COMMAND_EXTENDED ? 1 : 0;
		const payload = this.parserPacket.payload.subarray(offset, this.parserPacket.header.length);

		const invokeMessage = AMF.decodeAmf0Cmd(payload);
		switch (invokeMessage.cmd) {
			case 'connect':
				LOGGER.info(`[INVOKE] connect ${invokeMessage.cmd}`, invokeMessage);
				this._onConnect(invokeMessage);
				break;
			case 'createStream':
				LOGGER.info(`[INVOKE] create stream ${invokeMessage.cmd}`, invokeMessage);
				this._onCreateStream(invokeMessage);
				break;
			case 'publish':
				this._onPublish(invokeMessage);
				LOGGER.info(`[INVOKE] publish stream ${invokeMessage.cmd}`, invokeMessage);
				break;
			case 'play':
				LOGGER.info(`[INVOKE] play stream ${invokeMessage.cmd}`, invokeMessage);
				this._onPlay(invokeMessage);
				break;
			case 'deleteStream':
				LOGGER.info(`[INVOKE] delete stream ${invokeMessage.cmd}`, invokeMessage);
				this._onDeleteStream(invokeMessage);
				break;
			default:
				LOGGER.info(`[INVOKE] unhandled command ${invokeMessage.cmd}`, invokeMessage);
				break;
		}

		this.clients.forEach(client => client.onCommand(invokeMessage));
	}

	_onConnect(invokeMessage) {
		const url = new URL(invokeMessage.cmdObj.tcUrl);
		this.connectCmdObj = invokeMessage.cmdObj;
		this.streamApp = invokeMessage.cmdObj.app;
		this.streamHost = url.hostname;
		this.objectEncoding = invokeMessage.cmdObj.objectEncoding != null ? invokeMessage.cmdObj.objectEncoding : 0;
		this.connectTime = new Date();
		this.startTimestamp = Date.now();
		this.sendWindowACK(5000000);
		this.setPeerBandwidth(5000000, 2);
		this.setChunkSize(this.outChunkSize);
		this._respondConnect(invokeMessage.transId);
	}

	_onCreateStream(invokeMessage) {
		this._respondCreateStream(invokeMessage.transId);
	}

	_onPublish(invokeMessage) {
		this.streamName = invokeMessage.streamName.split('?')[0];
		this.streamQuery = querystring.parse(invokeMessage.streamName.split('?')[1]);
		this.streamId = this.parserPacket.header.stream_id;
		this._respondPublish();
		this.onConnectCallback({
			app: this.streamApp,
			name: this.streamName,
			host: this.streamHost,
			query: this.streamQuery
		});
		this.onPushCallback();
	}

	_onPlay(invokeMessage) {
		this.streamName = invokeMessage.streamName.split('?')[0];
		this.streamQuery = querystring.parse(invokeMessage.streamName.split('?')[1]);
		this.streamId = this.parserPacket.header.stream_id;
		this._respondPlay();
		this.onConnectCallback({
			app: this.streamApp,
			name: this.streamName,
			host: this.streamHost,
			query: this.streamQuery
		});
		this.onPlayCallback();
	}

	_onDeleteStream(invokeMessage) {}

	_respondConnect(tid) {
		const opt = {
			cmd: '_result',
			transId: tid,
			cmdObj: {
				fmsVer: 'FMS/3,0,1,123',
				capabilities: 31
			},
			info: {
				level: 'status',
				code: 'NetConnection.Connect.Success',
				description: 'Connection succeeded.',
				objectEncoding: this.objectEncoding
			}
		};
		this.sendInvokeMessage(0, opt);
	}

	_respondCreateStream(tid) {
		this.streams++;
		const opt = {
			cmd: '_result',
			transId: tid,
			cmdObj: null,
			info: this.streams
		};
		this.sendInvokeMessage(0, opt);
	}

	_respondPublish() {
		this.sendStatusMessage(this.streamId, 'status', 'NetStream.Publish.Start', `/${this.streamApp}/${this.streamName} is now published.`);
	}

	_respondPlay() {
		this.sendStreamStatus(STREAM_BEGIN, this.streamId);
		this.sendStatusMessage(this.streamId, 'status', 'NetStream.Play.Reset', 'Playing and resetting stream.');
		this.sendStatusMessage(this.streamId, 'status', 'NetStream.Play.Start', 'Started playing stream.');
		this.sendRtmpSampleAccess();
	}
}
