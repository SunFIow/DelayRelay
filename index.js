const net = require('net');
const http = require('http');

// Configuration
let LOCAL_PORT = 1935; // RTMP default port
let STREAM_DELAY_MS = 10_000; // 10 seconds delay
let delayActive = false; // Whether to apply the delay

let REMOTE_RTMP_URL = 'live.twitch.tv'; // Twitch RTMP URL
let REMOTE_RTMP_PORT = 1935; // Twitch RTMP port
// let REMOTE_RTMP_URL = 'localhost'; // Dummy RTMP server for testing
// let REMOTE_RTMP_PORT = 9999; // Dummy RTMP port for testing

let LATENCY_INTERVAL = 10; // Check every 10ms for low latency
let MAX_BUFFER_CHUNKS = 10_000; // Max number of chunks in buffer
let MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50 MB max buffer size

// Simple HTTP API for dynamic delay adjustment
const HTTP_API_PORT = 8080; // Port for the HTTP API

const handleLocalPort = (req, res) => {
	if (req.method === 'GET' && req.url.startsWith('/set-local-port')) {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const port = parseInt(url.searchParams.get('port'), 10);
		if (!isNaN(port) && port > 0 && port < 65536) {
			LOCAL_PORT = port;
			console.log(`[API] Local port set to ${LOCAL_PORT}`);
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
			console.log(`[API] Stream delay set to ${STREAM_DELAY_MS} ms (${(STREAM_DELAY_MS / 1000).toFixed(2)}s)`);
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
		delayActive = true;
		console.log(`[API] Delay activated`);
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end(`Delay activated\n`);
		return true;
	}
	return false;
};

const handleDeactivateDelay = (req, res) => {
	if (req.method === 'GET' && req.url.startsWith('/deactivate-delay')) {
		delayActive = false;
		console.log(`[API] Delay deactivated`);
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
			console.log(`[API] Remote RTMP URL set to ${REMOTE_RTMP_URL}`);
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
			console.log(`[API] Twitch RTMP port set to ${REMOTE_RTMP_PORT}`);
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
			console.log(`[API] Latency interval set to ${LATENCY_INTERVAL} ms`);
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
			console.log(`[API] Max buffer chunks set to ${MAX_BUFFER_CHUNKS}`);
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
			console.log(`[API] Max buffer bytes set to ${MAX_BUFFER_BYTES}`);
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
			delayActive: delayActive,
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
	res.writeHead(200, { 'Content-Type': 'text/html' });
	res.end(`
		<!DOCTYPE html>
		<html>
		<head>
			<title>RTMP Delay Relay</title>
		</head>
		<body>
			<h1>Welcome to the RTMP Delay Relay</h1>
			<p>Use the following API endpoints:</p>
			<ul>
				<li>Set local port: <code>GET /set-local-port?port=1935</code></li>
				<li>Set delay: <code>GET /set-delay?ms=15000</code></li>
				<li>Activate delay: <code>GET /activate-delay</code></li>
				<li>Deactivate delay: <code>GET /deactivate-delay</code></li
				<li>Set RTMP URL: <code>GET /set-remote-url?url=live.twitch.tv</code></li>
				<li>Set RTMP port: <code>GET /set-rtmp-port?port=1935</code></li>
				<li>Set latency: <code>GET /set-latency?ms=10</code></li>
				<li>Set max buffer chunks: <code>GET /set-max-chunks?chunks=10000</code></li>
				<li>Set max buffer bytes: <code>GET /set-max-bytes?bytes=52428800</code></li>
				<li>Get status: <code>GET /status</code></li>
			</ul>
		</body>
		</html>
	`);
});
apiServer.listen(HTTP_API_PORT, () => {
	console.log(`[API] HTTP API listening on http://localhost:${HTTP_API_PORT}`);
});

// RTMP proxy with true continuous streaming delay
const server = net.createServer(clientSocket => {
	clientSocket.setNoDelay(true); // Disable Nagle's algorithm for low latency

	/** @type {net.Socket|null} */ let twitchSocket = null;
	let ended = false;

	// Timed buffer for continuous delay
	const timedBuffer = [];
	let totalLength = 0;

	// Helper: push chunk with timestamp, with memory management
	let chunkAddCount = 0;
	let paused = false;
	function pushToBuffer(chunk) {
		const now = Date.now();
		timedBuffer.push({ chunk, time: now });
		totalLength += chunk.length;
		chunkAddCount++;
		if (chunkAddCount % 100 === 0) {
			console.log(`[Buffer] Added ${chunkAddCount} chunks so far. Current buffer: ${timedBuffer.length} chunks, ${totalLength} bytes`);
		}
		// Memory management: pause or drop
		if (timedBuffer.length > MAX_BUFFER_CHUNKS || totalLength > MAX_BUFFER_BYTES) {
			if (typeof clientSocket.pause === 'function' && !paused) {
				clientSocket.pause();
				paused = true;
				console.warn(`[Memory] Buffer limit reached. Pausing OBS input. Buffer: ${timedBuffer.length} chunks, ${totalLength} bytes`);
			} else {
				// Drop oldest chunk
				const dropped = timedBuffer.shift();
				if (dropped) totalLength -= dropped.chunk.length;
				console.warn(`[Memory] Buffer overflow! Dropped oldest chunk. Buffer: ${timedBuffer.length} chunks, ${totalLength} bytes`);
			}
		} else if (paused && timedBuffer.length < MAX_BUFFER_CHUNKS * 0.8 && totalLength < MAX_BUFFER_BYTES * 0.8) {
			// Resume if buffer is below 80% of limit
			if (typeof clientSocket.resume === 'function') {
				clientSocket.resume();
				paused = false;
				console.log(`[Memory] Buffer below threshold. Resumed OBS input.`);
			}
		}
	}

	// Helper: pop and return all chunks older than delay
	function popDelayedChunks() {
		const STREAM_DELAY_MS = delayActive ? STREAM_DELAY_MS : 0; // Use configured delay if active
		const now = Date.now();
		const ready = [];
		while (timedBuffer.length && now - timedBuffer[0].time >= STREAM_DELAY_MS) {
			const { chunk } = timedBuffer.shift();
			ready.push(chunk);
			totalLength -= chunk.length;
		}
		if (ready.length > 0) {
			console.log(`[Relay] Relaying ${ready.length} chunk(s) to Twitch (${totalLength} bytes left in buffer)`);
		}
		return ready;
	}

	// Connect to Twitch immediately
	twitchSocket = net.connect(REMOTE_RTMP_PORT, REMOTE_RTMP_URL, () => {
		console.log(`[Connect] Connected to Twitch for OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		// Pipe Twitch responses back to OBS (optional)
		twitchSocket.pipe(clientSocket);
	});
	twitchSocket.setNoDelay(true); // Disable Nagle's algorithm for low latency

	// Buffer incoming data from OBS
	clientSocket.on('data', chunk => {
		if (ended) return;
		pushToBuffer(chunk);
	});

	// Periodically flush delayed data to Twitch
	const interval = setInterval(() => {
		if (ended) return;
		const readyChunks = popDelayedChunks();
		for (const chunk of readyChunks) {
			if (twitchSocket?.writable) {
				twitchSocket.write(chunk);
			}
		}
	}, LATENCY_INTERVAL); // Check every 10ms for low latency

	clientSocket.on('close', () => {
		ended = true;
		clearInterval(interval);
		if (twitchSocket) twitchSocket.end();
		console.log(`[Disconnect] OBS client disconnected: ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
	});
	clientSocket.on('error', err => {
		ended = true;
		clearInterval(interval);
		if (twitchSocket) twitchSocket.destroy();
		console.error(`[Error] OBS client error: ${err.message}`);
	});
	if (twitchSocket) {
		twitchSocket.on('error', err => {
			console.error(`[Error] Twitch socket error: ${err.message}`);
		});
		twitchSocket.on('close', () => {
			console.log(`[Disconnect] Twitch socket closed for OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		});
	}
});

server.listen(LOCAL_PORT, () => {
	console.log(`DelayRelay proxy listening on port ${LOCAL_PORT}`);
	console.log(`Forwarding to Twitch with ${STREAM_DELAY_MS / 1000}s delay.`);
});
