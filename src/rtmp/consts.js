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
	DATA: 0x12, // 18 Data (Command (onMetaData info is sent as such)).
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

export const PacketTypeSequenceStart = 0;
export const PacketTypeCodedFrames = 1;
export const PacketTypeCodedFramesX = 3;
export const PacketTypeMetadata = 4;
export const PacketTypeMPEG2TSSequenceStart = 5;
export const FLV_AVC_SEQUENCE_HEADER = 0;
export const FOURCC_AV1 = Buffer.from('av01');
export const FOURCC_VP9 = Buffer.from('vp09');
export const FOURCC_HEVC = Buffer.from('hvc1');
export const FLV_CODECID_H264 = 7;
export const FLV_FRAME_KEY = 1;
export const FLV_CODECID_AAC = 10; /** @enum {number} */

export const RTMP_HANDSHAKE_UNINIT = 0;
export const RTMP_HANDSHAKE_BEGIN = 1;
export const RTMP_HANDSHAKE_CONT = 2;
export const RTMP_HANDSHAKE_COMP = 3;
export const RTMP_HANDSHAKE_SIZE = 1536; // Size of the RTMP handshake payload
export const SHA256DL = 32;

export const MAX_CHUNK_HEADER = 18;

export const RTMP_PARSE_INIT = 0;
export const RTMP_PARSE_BASIC_HEADER = 1;
export const RTMP_PARSE_MESSAGE_HEADER = 2;
export const RTMP_PARSE_EXTENDED_TIMESTAMP = 3;
export const RTMP_PARSE_PAYLOAD = 4;

export const RTMP_CHUNK_TYPE_0 = 0; // 11-bytes: timestamp(3) + length(3) + stream type(1) + stream id(4)
export const RTMP_CHUNK_TYPE_1 = 1; // 7-bytes: delta(3) + length(3) + stream type(1)
export const RTMP_CHUNK_TYPE_2 = 2; // 3-bytes: delta(3)

export const RTMP_CHANNEL_PROTOCOL = 2;
export const RTMP_CHANNEL_COMMAND = 3;
export const RTMP_CHANNEL_AUDIO = 4;
export const RTMP_CHANNEL_VIDEO = 5;
export const RTMP_CHANNEL_DATA = 6;

export const rtmpHeaderSize = [11, 7, 3, 0];

export const RTMP_CHUNK_SIZE = 128; // Default RTMP chunk size
export const RTMP_MAX_CHUNK_SIZE = 0xffff;
// export const RTMP_PING_TIME = 60000;
// export const RTMP_PING_TIMEOUT = 30000;

export const STREAM_BEGIN = 0x00;
// export const STREAM_EOF = 0x01;
// export const STREAM_DRY = 0x02;
// export const STREAM_EMPTY = 0x1f;
// export const STREAM_READY = 0x20;

export const MESSAGE_FORMAT_0 = 0;
export const MESSAGE_FORMAT_1 = 1;
export const MESSAGE_FORMAT_2 = 2;

export const RandomCrud = Buffer.from([
	0xf0, 0xee, 0xc2, 0x4a, 0x80, 0x68, 0xbe, 0xe8, 0x2e, 0x00, 0xd0, 0xd1, 0x02, 0x9e, 0x7e, 0x57, 0x6e, 0xec, 0x5d, 0x2d, 0x29, 0x80, 0x6f, 0xab, 0x93, 0xb8, 0xe6, 0x36, 0xcf, 0xeb, 0x31, 0xae
]);

export const GenuineFMSConst = 'Genuine Adobe Flash Media Server 001';
export const GenuineFMSConstCrud = Buffer.concat([Buffer.from(GenuineFMSConst, 'utf8'), RandomCrud]);

export const GenuineFPConst = 'Genuine Adobe Flash Player 001';
export const GenuineFPConstCrud = Buffer.concat([Buffer.from(GenuineFPConst, 'utf8'), RandomCrud]);
