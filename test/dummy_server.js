// Dummy RTMP/TCP server for testing DelayRelay proxy
const net = require('net');
const fs = require('fs');

const LOG_FILE = 'dummy_rtmp_server.log';
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function log(msg) {
	const line = `[${new Date().toISOString()}] ${msg}`;
	console.log(line);
	logStream.write(line + '\n');
}

const DUMMY_PORT = 9999; // Use this as your REMOTE_RTMP_PORT and REMOTE_RTMP_URL = 'localhost'

const server = net.createServer(socket => {
	log(`[Dummy] New connection from ${socket.remoteAddress}:${socket.remotePort}`);
	let totalBytes = 0;
	socket.on('data', chunk => {
		totalBytes += chunk.length;
		log(`[Dummy] Received ${chunk.length} bytes (total: ${totalBytes})`);
		// Optionally, print chunk as hex or buffer
		// log(chunk.toString('hex'));
	});
	socket.on('end', () => {
		log(`[Dummy] Connection ended. Total bytes received: ${totalBytes}`);
	});
	socket.on('error', err => {
		log(`[Dummy] Socket error: ${err.message}`);
	});
});

server.listen(DUMMY_PORT, () => {
	log(`[Dummy] Dummy RTMP/TCP server listening on port ${DUMMY_PORT}`);
	log(`[Dummy] Set REMOTE_RTMP_URL = 'localhost' and REMOTE_RTMP_PORT = ${DUMMY_PORT} in your proxy.`);
});
