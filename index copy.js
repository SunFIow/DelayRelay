const http = require('http');
const net = require('net');
const { PassThrough } = require('stream');

// Configuration
const LOCAL_PORT = 1935; // RTMP default port
const TWITCH_RTMP_URL = 'live.twitch.tv';
const TWITCH_RTMP_PORT = 1935;
const STREAM_DELAY_MS = 10_000; // 10 seconds delay

// Simple RTMP proxy with delay (proof of concept)
const server = net.createServer(clientSocket => {
	/** @type {Buffer[]} */ const buffer = [];
	/** @type {net.Socket|null} */ let twitchSocket = null;
	let isConnected = false;

	// Connect to Twitch when first data arrives
	clientSocket.once('data', chunk => {
		twitchSocket = net.connect(TWITCH_RTMP_PORT, TWITCH_RTMP_URL, () => {
			isConnected = true;
			// Start relaying buffered data with delay
			setTimeout(() => {
				for (const buf of buffer) twitchSocket.write(buf);
				clientSocket.pipe(twitchSocket);
				twitchSocket.pipe(clientSocket);
			}, STREAM_DELAY_MS);
		});
		buffer.push(chunk);
	});

	clientSocket.on('data', chunk => {
		if (!isConnected) buffer.push(chunk);
	});

	clientSocket.on('close', () => {
		if (twitchSocket) twitchSocket.end();
	});
	clientSocket.on('error', () => {
		if (twitchSocket) twitchSocket.destroy();
	});
});

server.listen(LOCAL_PORT, () => {
	console.log(`DelayRelay proxy listening on port ${LOCAL_PORT}`);
	console.log(`Forwarding to Twitch with ${STREAM_DELAY_MS / 1000}s delay.`);
});
