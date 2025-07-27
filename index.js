const net = require('net');
const http = require('http');
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

const handleLocalPort = (req, res) => {
	if (req.method === 'GET' && req.url.startsWith('/set-local-port')) {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const port = parseInt(url.searchParams.get('port'), 10);
		if (!isNaN(port) && port > 0 && port < 65536) {
			LOCAL_PORT = port;
			logToApiFile('INFO', `Local port set to ${LOCAL_PORT}`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Local port set to ${LOCAL_PORT}\n`);
		} else {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Invalid port parameter. Usage: "/set-local-port?port=1935"\n');
		}
		return true;
	}
};

const handleStreamDelay = (req, res) => {
	if (req.method === 'GET' && req.url.startsWith('/set-delay')) {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const ms = parseInt(url.searchParams.get('ms'), 10);
		if (!isNaN(ms) && ms > 0) {
			STREAM_DELAY_MS = ms;
			logToApiFile('INFO', `Stream delay set to ${STREAM_DELAY_MS} ms (${(STREAM_DELAY_MS / 1000).toFixed(2)}s)`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Stream delay set to ${STREAM_DELAY_MS} ms\n`);
		} else {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Invalid ms parameter. Usage: "/set-delay?ms=15000" (for 15s)\n');
		}
		return true;
	}
	return false;
};

const handleActivateDelay = (req, res) => {
	if (req.method === 'GET' && req.url.startsWith('/activate-delay')) {
		STATE = 'BUFFERING'; // Start buffering to build up delay
		logToApiFile('INFO', `Delay activated`);
		logToFile('INFO', `Delay activated`);
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end(`Delay activated\n`);
		return true;
	}
	return false;
};

const handleDeactivateDelay = (req, res) => {
	if (req.method === 'GET' && req.url.startsWith('/deactivate-delay')) {
		STATE = 'FORWARDING'; // Stop buffering and forward immediately
		logToApiFile('INFO', `Delay deactivated`);
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end(`Delay deactivated\n`);
		return true;
	}
	return false;
};

const handleRemoteUrl = (req, res) => {
	if (req.method === 'GET' && req.url.startsWith('/set-remote-url')) {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const remoteUrl = url.searchParams.get('url');
		if (remoteUrl) {
			REMOTE_RTMP_URL = remoteUrl;
			logToApiFile('INFO', `Remote RTMP URL set to ${REMOTE_RTMP_URL}`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Remote RTMP URL set to ${REMOTE_RTMP_URL}\n`);
		} else {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Invalid url parameter. Usage: "/set-remote-url?url=live.twitch.tv"\n');
		}
		return true;
	}
	return false;
};

const handleRemoteRTMPPort = (req, res) => {
	if (req.method === 'GET' && req.url.startsWith('/set-rtmp-port')) {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const port = parseInt(url.searchParams.get('port'), 10);
		if (!isNaN(port) && port > 0 && port < 65536) {
			REMOTE_RTMP_PORT = port;
			logToApiFile('INFO', `Twitch RTMP port set to ${REMOTE_RTMP_PORT}`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Twitch RTMP port set to ${REMOTE_RTMP_PORT}\n`);
		} else {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Invalid port parameter. Usage: "/set-rtmp-port?port=1935"\n');
		}
		return true;
	}
	return false;
};

const handleLatency = (req, res) => {
	if (req.method === 'GET' && req.url.startsWith('/set-latency')) {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const latency = parseInt(url.searchParams.get('ms'), 10);
		if (!isNaN(latency) && latency > 0) {
			LATENCY_INTERVAL = latency;
			logToApiFile('INFO', `Latency interval set to ${LATENCY_INTERVAL} ms`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Latency interval set to ${LATENCY_INTERVAL} ms\n`);
		} else {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Invalid ms parameter. Usage: "/set-latency?ms=10"\n');
		}
		return true;
	}
	return false;
};

const handleMaxBufferChunks = (req, res) => {
	if (req.method === 'GET' && req.url.startsWith('/set-max-chunks')) {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const chunks = parseInt(url.searchParams.get('chunks'), 10);
		if (!isNaN(chunks) && chunks > 0) {
			MAX_BUFFER_CHUNKS = chunks;
			logToApiFile('INFO', `Max buffer chunks set to ${MAX_BUFFER_CHUNKS}`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Max buffer chunks set to ${MAX_BUFFER_CHUNKS}\n`);
		} else {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Invalid chunks parameter. Usage: "/set-max-chunks?chunks=10000"\n');
		}
		return true;
	}
	return false;
};

const handleMaxBufferBytes = (req, res) => {
	if (req.method === 'GET' && req.url.startsWith('/set-max-bytes')) {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const bytes = parseInt(url.searchParams.get('bytes'), 10);
		if (!isNaN(bytes) && bytes > 0) {
			MAX_BUFFER_BYTES = bytes;
			logToApiFile('INFO', `Max buffer bytes set to ${MAX_BUFFER_BYTES}`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Max buffer bytes set to ${MAX_BUFFER_BYTES}\n`);
		} else {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Invalid bytes parameter. Usage: "/set-max-bytes?bytes=52428800"\n');
		}
		return true;
	}
	return false;
};

const handleStatus = (req, res) => {
	if (req.method === 'GET' && req.url === '/status') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		const status = {
			localPort: LOCAL_PORT,
			streamDelay: STREAM_DELAY_MS,
			state: STATE,
			remoteUrl: REMOTE_RTMP_URL,
			remotePort: REMOTE_RTMP_PORT,
			latencyInterval: LATENCY_INTERVAL,
			maxBufferChunks: MAX_BUFFER_CHUNKS,
			maxBufferBytes: MAX_BUFFER_BYTES
		};
		res.end(JSON.stringify(status));
		return true;
	}

	return false;
};

const apiServer = http.createServer((req, res) => {
	// res.setHeader('Access-Control-Allow-Origin', '*'); // Allow CORS for API
	// res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

	if (handleLocalPort(req, res)) return;
	if (handleStreamDelay(req, res)) return;
	if (handleActivateDelay(req, res)) return;
	if (handleDeactivateDelay(req, res)) return;
	if (handleRemoteUrl(req, res)) return;
	if (handleRemoteRTMPPort(req, res)) return;
	if (handleLatency(req, res)) return;
	if (handleMaxBufferChunks(req, res)) return;
	if (handleMaxBufferBytes(req, res)) return;
	if (handleStatus(req, res)) return;

	// If no handlers responded, return a simple homepage
	simplePage(req, res);
});
apiServer.listen(HTTP_API_PORT, () => {
	console.log(`HTTP API listening on http://localhost:${HTTP_API_PORT}`);
	logToApiFile('INFO', `HTTP API listening on http://localhost:${HTTP_API_PORT}`);
});

function simplePage(req, res) {
	res.writeHead(200, { 'Content-Type': 'text/html' });
	res.end(`
		<!DOCTYPE html>
		<html>
		<head>
			<title>RTMP Delay Relay</title>
		</head>
		<body>
			<h1>RTMP Delay Relay</h1>
			<p>API is running. Use the endpoints to control the proxy.</p>
			<ul>
				<li><a href="/status">Status</a></li>
				<li><a href="/set-local-port?port=8888">Set Local Port</a></li>
				<li><a href="/set-delay?ms=10000">Set Stream Delay</a></li>
				<li><a href="/activate-delay">Activate Delay</a></li>
				<li><a href="/deactivate-delay">Deactivate Delay</a></li>
				<li><a href="/set-remote-url?url=live.twitch.tv">Set Remote RTMP URL</a></li>
				<li><a href="/set-rtmp-port?port=1935">Set Remote RTMP Port</a></li>
				<li><a href="/set-latency?ms=10">Set Latency Interval</a></li>
				<li><a href="/set-max-chunks?chunks=10000">Set Max Buffer Chunks</a></li>
				<li><a href="/set-max-bytes?bytes=52428800">Set Max Buffer Bytes</a></li>
			</ul>
		</body>
		</html>
	`);
}

// RTMP proxy with true continuous streaming delay
const server = net.createServer(clientSocket => {
	clientSocket.setNoDelay(true); // Disable Nagle's algorithm for low latency

	// Connect to Twitch immediately
	const twitchSocket = net.connect(REMOTE_RTMP_PORT, REMOTE_RTMP_URL, () => {
		logToFile('INFO', `[Connect] Connected to Twitch for OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		// Pipe Twitch responses back to OBS (optional)
		twitchSocket.pipe(clientSocket);
	});
	twitchSocket.setNoDelay(true); // Disable Nagle's algorithm for low latency

	twitchSocket.on('error', err => {
		logToFile('ERROR', `Twitch socket error(${err}): \nName: ${err.name}\nMessage: ${err.message}\nStack: ${err.stack}\nCause: ${err.cause}`);
		logToFile('ERROR', `Current state: ${STATE}`);
		logToFile('ERROR', `Relay count: ${relayCount}, Chunk add count: ${chunkAddCount}`);
		logToFile('ERROR', `Total buffer size: ${formatBytes(totalLength)}, Chunks in buffer: ${timedBuffer.length}`);
		logToFile('ERROR', `Delayed chunks: ${delayBuffer.length}`);
		// check timedBuffer / delayedBuffer etc
		clientSocket.end(); // Close OBS client socket on error
	});
	twitchSocket.on('close', err => {
		if (err) logToFile('ERROR', `[Disconnect] Twitch socket closed with error: ${err}`);
		else logToFile('INFO', `[Disconnect] Twitch socket closed for OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		clientSocket.end(); // Close OBS client socket if Twitch disconnects
	});

	let ended = false;

	// Timed buffer for continuous delay
	const delayBuffer = [];
	const timedBuffer = [];
	let totalLength = 0;

	// Helper: push chunk with timestamp, with memory management
	let chunkAddCount = 0;
	let paused = false;
	/**
	 * Push a chunk to the buffer with its timestamp and size.
	 * @param {Buffer} buffer
	 * @param {number} inChunkSize
	 */
	function handleData(buffer, inChunkSize) {
		while (buffer.length >= inChunkSize) {
			const completeChunk = buffer.slice(0, inChunkSize); // Get complete chunk
			buffer = buffer.slice(inChunkSize); // Remove complete chunk from buffer
			pushToBuffer(completeChunk);
		}
		// If there's still data left, push it as a partial chunk
		if (buffer.length > 0) pushToBuffer(buffer);
	}

	let ID = 0; // Unique ID for each chunk
	function pushToBuffer(chunk) {
		// TODO: Use inChunkSize to manage buffer size
		const now = Date.now();
		timedBuffer.push({ chunk, time: now, id: ID++ });
		totalLength += chunk.length;
		chunkAddCount++;
		if (chunkAddCount % LOG_EVERY === 0) {
			logToFile('INFO', `[Buffer] Added ${chunkAddCount} chunks so far`);
			logToFile('INFO', `[Buffer] timedBuffer: ${timedBuffer.length} chunks, ${formatBytes(totalLength)} | delayBuffer: ${delayBuffer.length} chunks`);
		}
		// Memory management: pause or drop
		if (timedBuffer.length > MAX_BUFFER_CHUNKS || totalLength > MAX_BUFFER_BYTES) {
			if (typeof clientSocket.pause === 'function' && !paused) {
				clientSocket.pause();
				paused = true;
				if (STATE !== 'BUFFERING') {
					logToFile('WARN', `[Memory] Buffer limit reached. Pausing OBS input. Buffer: ${timedBuffer.length} chunks, ${totalLength} bytes`);
				} else {
					logToFile('WARN', `[Memory] Buffer limit reached while buffering. Pausing OBS input. And  Buffer: ${timedBuffer.length} chunks, ${totalLength} bytes`);
				}
			} else {
				// Drop oldest chunk
				const dropped = timedBuffer.shift();
				if (dropped) totalLength -= dropped.chunk.length;
				logToFile('WARN', `[Memory] Buffer overflow! Dropped oldest chunk. Buffer: ${timedBuffer.length} chunks, ${totalLength} bytes`);
			}
		} else if (paused && timedBuffer.length < MAX_BUFFER_CHUNKS * 0.8 && totalLength < MAX_BUFFER_BYTES * 0.8) {
			// Resume if buffer is below 80% of limit
			if (typeof clientSocket.resume === 'function') {
				clientSocket.resume();
				paused = false;
				logToFile('INFO', `[Memory] Buffer below threshold. Resumed OBS input.`);
			}
		}
	}

	// Helper: pop and return all chunks older than delay
	let relayCount = 0;
	function popReadyChunks(ready = []) {
		const now = Date.now();

		if (STATE === 'FORWARDING') {
			// If in FORWARDING state drop all delayed chunks
			while (timedBuffer.length > 0) {
				const buf = timedBuffer.shift();
				totalLength -= buf.chunk.length;
			}
			STATE = 'REALTIME'; // Reset state to REALTIME after forwarding
		} else if (STATE === 'REALTIME') {
			while (timedBuffer.length > 0) {
				const buf = timedBuffer.shift();
				ready.push(buf);
				delayBuffer.push(buf);
				totalLength -= buf.chunk.length;
			}
			while (delayBuffer.length > 0 && now - delayBuffer[0].time > STREAM_DELAY_MS) {
				delayBuffer.shift();
			}
		} else if (STATE === 'DELAY') {
			while (timedBuffer.length > 0 && now - timedBuffer[0].time > STREAM_DELAY_MS) {
				const buf = timedBuffer.shift();
				ready.push(buf);
				totalLength -= buf.chunk.length;
			}
		} else if (STATE === 'BUFFERING') {
			while (delayBuffer.length > 0 && now - delayBuffer[0].time > STREAM_DELAY_MS) {
				const buf = delayBuffer.shift();
				ready.push(buf);
			}
			if (delayBuffer.length === 0) STATE = 'DELAY'; // Switch to DELAY state after buffering
		}

		relayCount += ready.length;
		if (relayCount % LOG_EVERY === 0) {
			logToFile('INFO', `[Relay] Relayed ${ready.length}/${relayCount} chunk(s) to Twitch (${formatBytes(totalLength)} left in buffer)`);
			logToFile('INFO', `[Buffer] timedBuffer: ${timedBuffer.length} chunks, ${formatBytes(totalLength)} | delayBuffer: ${delayBuffer.length} chunks`);
		}
		// Warn if we send more than 25 chunks at once
		if (ready.length > 25) {
			logToFile('WARN', `[Relay] [WARNING] Sending ${ready.length} chunks to Twitch at once!`);
		}

		return ready;
	}

	// Buffer incoming data from OBS
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
		const readyChunks = popReadyChunks();
		for (const { chunk, id } of readyChunks) {
			if (twitchSocket?.writable) {
				logToFile('INFO', `[Flush] Sending [${id}] ${chunk.length} bytes to Twitch`);
				twitchSocket.write(chunk);
			}
		}
	}, LATENCY_INTERVAL); // Check every 10ms for low latency

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
		sentPackage = false; // Reset sentPackage flag for each new data chunk
		let err = rtmp.parserData(data);
		logToFile('INFO', `[RTMP] Chunk Size: ${rtmp.inChunkSize}/${rtmp.outChunkSize}`);
		handleData(data, rtmp.inChunkSize); // Buffer the incoming data with the current output chunk size
		sentPackage = true; // Assume we sent a package unless an error occurs
		if (!sentPackage) {
			// If no package was sent, send the data to Twitch
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
			this.clientSocket.end();
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
