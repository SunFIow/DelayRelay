import OutboundRtmpClient from '../src/connections/outboundRtmpClient.js';
import NodeMediaServer from 'node-media-server';
import logger from 'node-media-server/src/core/logger.js';

/** @type {import("node-media-server").Config} */
const config = {
	rtmp: {
		port: 9999,
		chunk_size: 4096,
		gop_cache: true,
		ping: 30,
		ping_timeout: 60
	},
	http: {
		port: 8081,
		allow_origin: '*'
	}
};
// const nms = new NodeMediaServer(config);
const nms = new NodeMediaServer({ ...config });
logger.level = 'trace';
nms.run();
const client = new OutboundRtmpClient({
	name: 'test-client',
	host: '127.0.0.1',
	port: 9999,
	app: 'live',
	streamName: 'test-stream',
	streamKey: 'test-key'
});
client.connect();
