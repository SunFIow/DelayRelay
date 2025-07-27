const net = require('net');
const fs = require('fs');
const AVPacket = require('node-media-server/src/core/avpacket');

// Simple file loggers
const LOG_DIR = 'logs';
const d = new Date();
function getLogFilename(prefix) {
	const pad = n => n.toString().padStart(2, '0');
	// Format: YYYYMMDD_HHMMSS
	const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}__${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
	return `${LOG_DIR}/${prefix}_${ts}.log`;
}
const LOG_FILE = getLogFilename('relay');
const API_LOG_FILE = getLogFilename('api');
const LOG_LATEST = `${LOG_DIR}/relay_latest.log`;
const API_LOG_LATEST = `${LOG_DIR}/api_latest.log`;
// Truncate latest log files at startup
fs.writeFileSync(LOG_LATEST, '');
fs.writeFileSync(API_LOG_LATEST, '');

const LOG_STREAM = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const API_LOG_STREAM = fs.createWriteStream(API_LOG_FILE, { flags: 'a' });
const LOG_LATEST_STREAM = fs.createWriteStream(LOG_LATEST, { flags: 'a' });
const API_LOG_LATEST_STREAM = fs.createWriteStream(API_LOG_LATEST, { flags: 'a' });
function getTimeString() {
	const d = new Date();
	const pad = n => n.toString().padStart(2, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function logToFile(level, message) {
	const timestamp = getTimeString();
	const line = `[${timestamp}] [${level}] ${message}\n`;
	LOG_STREAM.write(line);
	LOG_LATEST_STREAM.write(line);
}
function logToApiFile(level, message) {
	const timestamp = getTimeString();
	const line = `[${timestamp}] [${level}] ${message}\n`;
	API_LOG_STREAM.write(line);
	API_LOG_LATEST_STREAM.write(line);
}

// Configuration
let LOCAL_PORT = 8888; // RTMP default port
let STREAM_DELAY_MS = 30_000; // 30 seconds delay
/**@type {"REALTIME" | "BUFFERING" | "DELAY" | "FORWARDING"} */
let STATE = 'REALTIME'; // Whether to apply the delay

// let REMOTE_RTMP_URL = 'live.twitch.tv'; // Twitch RTMP URL
// let REMOTE_RTMP_PORT = 1935; // Twitch RTMP port
let REMOTE_RTMP_URL = 'localhost'; // Dummy RTMP server for testing
let REMOTE_RTMP_PORT = 9999; // Dummy RTMP port for testing
// http://localhost:8081/app/live_157072648_HXdnAA0L7kzXUcsU8OOlIOB9rsQxqE.flv
let LATENCY_INTERVAL = 10; // Check every 10ms for low latency
let MAX_BUFFER_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB max buffer size
let MAX_BUFFER_CHUNKS = MAX_BUFFER_BYTES / 6000; // Max number of chunks in buffer

// Simple HTTP API for dynamic delay adjustment
const HTTP_API_PORT = 8080; // Port for the HTTP API

const LOG_EVERY = 100; // Log every 100 chunks for performance

// Extracted HTTP API server (handlers are now in apiServer.js)
const { ApiServer } = require('./apiServer');

new ApiServer({
	port: HTTP_API_PORT,
	getConfig: () => ({
		LOCAL_PORT,
		STREAM_DELAY_MS,
		STATE,
		REMOTE_RTMP_URL,
		REMOTE_RTMP_PORT,
		LATENCY_INTERVAL,
		MAX_BUFFER_CHUNKS,
		MAX_BUFFER_BYTES
	}),
	setConfig: (key, value) => {
		if (key === 'LOCAL_PORT') LOCAL_PORT = value;
		if (key === 'STREAM_DELAY_MS') STREAM_DELAY_MS = value;
		if (key === 'STATE') STATE = value;
		if (key === 'REMOTE_RTMP_URL') REMOTE_RTMP_URL = value;
		if (key === 'REMOTE_RTMP_PORT') REMOTE_RTMP_PORT = value;
		if (key === 'LATENCY_INTERVAL') LATENCY_INTERVAL = value;
		if (key === 'MAX_BUFFER_CHUNKS') MAX_BUFFER_CHUNKS = value;
		if (key === 'MAX_BUFFER_BYTES') MAX_BUFFER_BYTES = value;
	},
	logToApiFile,
	logToFile
});

// Modular buffer logic using StreamBuffer
const StreamBuffer = require('./streamBuffer').default;
const { ApiServer } = require('./apiServer');

const server = net.createServer(clientSocket => {
	clientSocket.setNoDelay(true);

	// Connect to Twitch immediately
	const twitchSocket = net.connect(REMOTE_RTMP_PORT, REMOTE_RTMP_URL, () => {
		logToFile('INFO', `[Connect] Connected to Twitch for OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		twitchSocket.pipe(clientSocket);
	});
	twitchSocket.setNoDelay(true);

	twitchSocket.on('error', err => {
		logToFile('ERROR', `Twitch socket error(${err}): \nName: ${err.name}\nMessage: ${err.message}\nStack: ${err.stack}\nCause: ${err.cause}`);
		logToFile('ERROR', `Current state: ${buffer.STATE}`);
		clientSocket.end();
	});
	twitchSocket.on('close', err => {
		if (err) logToFile('ERROR', `[Disconnect] Twitch socket closed with error: ${err}`);
		else logToFile('INFO', `[Disconnect] Twitch socket closed for OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		clientSocket.end();
	});

	let ended = false;

	// Create a buffer instance for this connection
	const buffer = new StreamBuffer({
		streamDelayMs: STREAM_DELAY_MS,
		maxBufferChunks: MAX_BUFFER_CHUNKS,
		maxBufferBytes: MAX_BUFFER_BYTES,
		logToFile,
		formatBytes,
		initialState: STATE,
		logEvery: LOG_EVERY
	});

	// Helper: push chunk with timestamp, with memory management
	/**
	 * Push a chunk to the buffer with its timestamp and size.
	 * @param {Buffer} buffer
	 * @param {number} inChunkSize
	 */
	function handleData(bufferData, inChunkSize) {
		while (bufferData.length >= inChunkSize) {
			const completeChunk = bufferData.slice(0, inChunkSize);
			bufferData = bufferData.slice(inChunkSize);
			buffer.pushToBuffer(completeChunk, clientSocket);
		}
		if (bufferData.length > 0) buffer.pushToBuffer(bufferData, clientSocket);
	}

	clientSocket.on('data', chunk => {
		if (ended) return;
		logToFile('INFO', `[Data] Received ${chunk.length} bytes from OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		// pushToBuffer(chunk);
	});

	clientSocket.on('close', () => {
		ended = true;
		clearInterval(interval);
		if (twitchSocket) twitchSocket.end();
		logToFile('INFO', `[Disconnect] OBS client disconnected: ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
	});

	clientSocket.on('error', err => {
		ended = true;
		clearInterval(interval);
		if (twitchSocket) twitchSocket.destroy();
		logToFile('Error', `OBS client error: ${err.message}`);
	});

	// Periodically flush delayed data to Twitch
	const interval = setInterval(() => {
		if (ended) return;
		const readyChunks = buffer.popReadyChunks();
		for (const { chunk, id } of readyChunks) {
			if (twitchSocket?.writable) {
				logToFile('INFO', `[Flush] Sending [${id}] ${chunk.length} bytes to Twitch`);
				twitchSocket.write(chunk);
			}
		}
	}, LATENCY_INTERVAL);

	// RTMP parser (dummy implementation, replace with actual RTMP parsing logic)
	const Rtmp = require('node-media-server/src/protocol/rtmp.js');
	logToFile('INFO', `[RTMP] Initializing RTMP server for OBS client`);
	/** @type {Rtmp} */
	const rtmp = new Rtmp();
	// console.log(`[RTMP] RTMP server initialized for OBS client`);

	/**
	 * @param {object} req
	 * @param {string} req.app
	 * @param {string} req.name
	 * @param {string} req.host
	 * @param {object} req.query
	 */
	rtmp.onConnectCallback = req => {
		logToFile('INFO', `[RTMP] Client connected: [App/${req.app}] [Name/${req.name}] [Host/${req.host}] [StreamPath/${req.app}/${req.name}] [Query/${JSON.stringify(req.query)}]`);
	};
	rtmp.onPlayCallback = () => {
		logToFile('INFO', `[RTMP] Client started playing stream`);
	};
	rtmp.onPushCallback = () => {
		logToFile('INFO', `[RTMP] Client started pushing stream`);
	};
	/** @param {Buffer} buffer */
	rtmp.onOutputCallback = buffer => {
		return; // Disable output callback for now
		if (twitchSocket?.writable) {
			// console.log(`[RTMP] Sending output to Twitch: ${buffer.length} bytes`);
			// twitchSocket.write(buffer);
		} else console.warn(`[RTMP] Cannot send output to Twitch, socket not writable`);
	};
	/** @param {AVPacket} packet */
	rtmp.onPacketCallback = packet => {
		logToFile('INFO', `[RTMP] Received packet: Codec ID ${packet.codec_id}, Type ${packet.codec_type}, Size ${packet.size}`);
		return; // Disable packet callback for now
		if (twitchSocket?.writable) {
			const rtmpMessage = Rtmp.createMessage(packet);
			// console.log(`[RTMP] Broadcast packet to Twitch: ${rtmpMessage.length} bytes`);
			// twitchSocket.write(rtmpMessage);
		} else console.warn(`[RTMP] Cannot broadcast packet to Twitch, socket not writable`);
		sentPackage = true; // Indicate that a package was sent
	};

	let sentPackage;

	/** @param {Buffer} data */
	clientSocket.on('data', data => {
		if (ended) return;
		logToFile('INFO', `[RTMP] Received Client data: ${data.length} bytes`);
		sentPackage = false;
		let err = rtmp.parserData(data);
		logToFile('INFO', `[RTMP] Chunk Size: ${rtmp.inChunkSize}/${rtmp.outChunkSize}`);
		handleData(data, rtmp.inChunkSize);
		sentPackage = true;
		if (!sentPackage) {
			if (!twitchSocket?.writable) {
				logToFile('WARN', `[RTMP] Twitch socket not writable, cannot send data`);
				err = new Error('Twitch socket not writable');
			} else {
				sentPackage = true;
				logToFile('INFO', `[RTMP] Sending data to Twitch: ${data.length} bytes`);
				twitchSocket.write(data);
			}
		}
		if (err != null) {
			logToFile('ERROR', `[RTMP] Error parsing data: ${err}`);
			clientSocket.end();
		}
	});
});

server.listen(LOCAL_PORT, () => {
	logToFile('INFO', `DelayRelay proxy listening on port ${LOCAL_PORT}`);
	logToFile('INFO', `Forwarding to Twitch with ${STREAM_DELAY_MS / 1000}s delay.`);
});

function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
