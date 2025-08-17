import RtmpClient from '../src/rtmp/RtmpClient.js';

const client = new RtmpClient({
	name: 'test-client',
	host: 'localhost',
	port: 9999,
	app: 'live',
	streamName: 'test-stream',
	streamKey: 'test-key'
});
client.connect();
