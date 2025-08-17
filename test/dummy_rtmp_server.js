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
logger.level = 'trace';
const nms = new NodeMediaServer(config);
nms.run();
logger.level = 'trace';
