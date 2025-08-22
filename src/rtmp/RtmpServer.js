import querystring from 'querystring';
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

export class RtmpServer extends RtmpImpl {
	constructor(name = 'Server') {
		super({ name, role: 'server' });
		/** @type {RtmpClient[]} */
		this.clients = [];
		this.initEvents();
	}

	initEvents() {
		this.on('cmd:connect', command => {
			LOGGER.info(`[RtmpServer:${this.name}/${this.streamId}] connect`, command);
			this.onConnect(command);
		});
		this.on('cmd:createStream', command => {
			LOGGER.info(`[RtmpServer:${this.name}/${this.streamId}] createStream`, command);
			this.onCreateStream(command);
		});
		this.on('cmd:publish', command => {
			LOGGER.info(`[RtmpServer:${this.name}/${this.streamId}] publish`, command);
			this.onPublish(command);
		});
		this.on('cmd:play', command => {
			LOGGER.info(`[RtmpServer:${this.name}/${this.streamId}] play`, command);
			this.onPlay(command);
		});
		this.on('cmd:deleteStream', command => {
			LOGGER.info(`[RtmpServer:${this.name}/${this.streamId}] deleteStream`, command);
			this.onDeleteStream(command);
		});

		this.on('ctrl:setChunkSize', size => {
			LOGGER.info(`[RtmpServer:${this.name}/${this.streamId}] setChunkSize`, size);
			// this.outChunkSize = size;
			// this.setChunkSize(size);
			// this.clients.forEach(client => {
			// 	client.outChunkSize = size;
			// 	client.setChunkSize(size);
			// });
		});

		this.on('command', command => {
			LOGGER.trace(`[RtmpServer:${this.name}/${this.streamId}] Received command: ${command.cmd} transId=${command.transId}`, command);
			this.clients.forEach(client => client.relayCommand(command));
		});
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
		if (!this.clients.length) {
			LOGGER.warn(`[RTMP] No clients connected to send chunk`);
			return;
		}
		LOGGER.trace(`[RTMP] Sending chunk[${chunk.id}](${chunk.codec}/${chunk.flags}) to ${this.clients.length} clients: ${chunk.data.length} bytes`);
		this.clients.forEach(client => client.sendChunk(chunk));
	}

	close() {
		this.clients.forEach(client => client.close());
	}

	/** @abstract */
	onConnectCallback = req => {};

	/** @abstract */
	onPlayCallback = () => {};

	/** @abstract */
	onPushCallback = () => {};

	/** Parses FLV payload to extract only the relevant packet flag.
	 * @param {number} type - RTMP packet type (e.g., 8 for audio, 9 for video, 18 for metadata)
	 * @param {Buffer} payload - The RTMP packet payload (FLV tag data)
	 * @returns {PacketFlags} -1 if not a valid packet type, otherwise returns the packet flag
	 */
	parsePacketFlag() {
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

	onConnect(commandMessage) {
		const url = new URL(commandMessage.cmdObj.tcUrl);
		this.connectCmdObj = commandMessage.cmdObj;
		this.streamApp = commandMessage.cmdObj.app;
		this.streamHost = url.hostname;
		this.objectEncoding = commandMessage.cmdObj.objectEncoding != null ? commandMessage.cmdObj.objectEncoding : 0;
		this.connectTime = new Date();
		this.startTimestamp = Date.now();
		this.sendWindowACK(2500000);
		this.setPeerBandwidth(2500000, 2);
		this.sendStreamStatus(STREAM_BEGIN, this.streamId);
		this.setChunkSize(this.outChunkSize);
		this.respondConnect(commandMessage.transId);
	}

	respondConnect(tid) {
		const opt = {
			cmd: '_result',
			transId: tid,
			cmdObj: {
				fmsVer: 'FMS/3,5,7,7009',
				capabilities: 31,
				mode: 1
			},
			info: {
				level: 'status',
				code: 'NetConnection.Connect.Success',
				description: 'Connection accepted.',
				data: {
					string: '3,5,7,7009'
				},
				objectEncoding: this.objectEncoding
			}
		};
		this.sendCommandMessage(opt, 0);
	}

	onCreateStream(commandMessage) {
		this.respondCreateStream(commandMessage.transId);
		this.sendStreamStatus(STREAM_BEGIN, this.streamId);
	}

	respondCreateStream(tid) {
		this.streams++;
		const opt = {
			cmd: '_result',
			transId: tid,
			cmdObj: null,
			info: this.streams
		};
		this.sendCommandMessage(opt, 0);
	}

	onPublish(commandMessage) {
		this.streamName = commandMessage.streamName.split('?')[0];
		this.streamQuery = querystring.parse(commandMessage.streamName.split('?')[1]);
		this.streamId = this.parserPacket.header.stream_id;
		this.respondPublish();
		this.onConnectCallback({
			app: this.streamApp,
			name: this.streamName,
			host: this.streamHost,
			query: this.streamQuery
		});
		this.onPushCallback();
	}

	respondPublish() {
		this.sendStatusMessage(this.streamId, 'status', 'NetStream.Publish.Start', `/${this.streamApp}/${this.streamName} is now published.`);
	}

	onPlay(commandMessage) {
		this.streamName = commandMessage.streamName.split('?')[0];
		this.streamQuery = querystring.parse(commandMessage.streamName.split('?')[1]);
		this.streamId = this.parserPacket.header.stream_id;
		this.respondPlay();
		this.onConnectCallback({
			app: this.streamApp,
			name: this.streamName,
			host: this.streamHost,
			query: this.streamQuery
		});
		this.onPlayCallback();
	}

	respondPlay() {
		this.sendStreamStatus(STREAM_BEGIN, this.streamId);
		this.sendStatusMessage(this.streamId, 'status', 'NetStream.Play.Reset', 'Playing and resetting stream.');
		this.sendStatusMessage(this.streamId, 'status', 'NetStream.Play.Start', 'Started playing stream.');
		this.sendRtmpSampleAccess();
	}

	onDeleteStream(commandMessage) {}
}
