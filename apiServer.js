// apiServer.js
// Encapsulates the HTTP API server logic for DelayRelay

const http = require('http');

function createApiServer({ port, getConfig, setConfig, logToApiFile, logToFile }) {
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

	const server = http.createServer((req, res) => {
		// /set-local-port?port=8888
		if (req.method === 'GET' && req.url.startsWith('/set-local-port')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const portVal = parseInt(url.searchParams.get('port'), 10);
			if (!isNaN(portVal) && portVal > 0 && portVal < 65536) {
				setConfig('LOCAL_PORT', portVal);
				logToApiFile('INFO', `Local port set to ${portVal}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Local port set to ${portVal}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid port parameter. Usage: "/set-local-port?port=1935"\n');
			}
			return;
		}
		// /set-delay?ms=15000
		if (req.method === 'GET' && req.url.startsWith('/set-delay')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const ms = parseInt(url.searchParams.get('ms'), 10);
			if (!isNaN(ms) && ms > 0) {
				setConfig('STREAM_DELAY_MS', ms);
				logToApiFile('INFO', `Stream delay set to ${ms} ms (${(ms / 1000).toFixed(2)}s)`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Stream delay set to ${ms} ms\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid ms parameter. Usage: "/set-delay?ms=15000" (for 15s)\n');
			}
			return;
		}
		// /activate-delay
		if (req.method === 'GET' && req.url.startsWith('/activate-delay')) {
			setConfig('STATE', 'BUFFERING');
			logToApiFile('INFO', `Delay activated`);
			logToFile('INFO', `Delay activated`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Delay activated\n`);
			return;
		}
		// /deactivate-delay
		if (req.method === 'GET' && req.url.startsWith('/deactivate-delay')) {
			setConfig('STATE', 'FORWARDING');
			logToApiFile('INFO', `Delay deactivated`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Delay deactivated\n`);
			return;
		}
		// /set-remote-url?url=live.twitch.tv
		if (req.method === 'GET' && req.url.startsWith('/set-remote-url')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const remoteUrl = url.searchParams.get('url');
			if (remoteUrl) {
				setConfig('REMOTE_RTMP_URL', remoteUrl);
				logToApiFile('INFO', `Remote RTMP URL set to ${remoteUrl}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Remote RTMP URL set to ${remoteUrl}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid url parameter. Usage: "/set-remote-url?url=live.twitch.tv"\n');
			}
			return;
		}
		// /set-rtmp-port?port=1935
		if (req.method === 'GET' && req.url.startsWith('/set-rtmp-port')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const portVal = parseInt(url.searchParams.get('port'), 10);
			if (!isNaN(portVal) && portVal > 0 && portVal < 65536) {
				setConfig('REMOTE_RTMP_PORT', portVal);
				logToApiFile('INFO', `Twitch RTMP port set to ${portVal}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Twitch RTMP port set to ${portVal}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid port parameter. Usage: "/set-rtmp-port?port=1935"\n');
			}
			return;
		}
		// /set-latency?ms=10
		if (req.method === 'GET' && req.url.startsWith('/set-latency')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const latency = parseInt(url.searchParams.get('ms'), 10);
			if (!isNaN(latency) && latency > 0) {
				setConfig('LATENCY_INTERVAL', latency);
				logToApiFile('INFO', `Latency interval set to ${latency} ms`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Latency interval set to ${latency} ms\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid ms parameter. Usage: "/set-latency?ms=10"\n');
			}
			return;
		}
		// /set-max-chunks?chunks=10000
		if (req.method === 'GET' && req.url.startsWith('/set-max-chunks')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const chunks = parseInt(url.searchParams.get('chunks'), 10);
			if (!isNaN(chunks) && chunks > 0) {
				setConfig('MAX_BUFFER_CHUNKS', chunks);
				logToApiFile('INFO', `Max buffer chunks set to ${chunks}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Max buffer chunks set to ${chunks}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid chunks parameter. Usage: "/set-max-chunks?chunks=10000"\n');
			}
			return;
		}
		// /set-max-bytes?bytes=52428800
		if (req.method === 'GET' && req.url.startsWith('/set-max-bytes')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const bytes = parseInt(url.searchParams.get('bytes'), 10);
			if (!isNaN(bytes) && bytes > 0) {
				setConfig('MAX_BUFFER_BYTES', bytes);
				logToApiFile('INFO', `Max buffer bytes set to ${bytes}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Max buffer bytes set to ${bytes}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid bytes parameter. Usage: "/set-max-bytes?bytes=52428800"\n');
			}
			return;
		}
		// /status
		if (req.method === 'GET' && req.url === '/status') {
			const config = getConfig();
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					localPort: config.LOCAL_PORT,
					streamDelay: config.STREAM_DELAY_MS,
					state: config.STATE,
					remoteUrl: config.REMOTE_RTMP_URL,
					remotePort: config.REMOTE_RTMP_PORT,
					latencyInterval: config.LATENCY_INTERVAL,
					maxBufferChunks: config.MAX_BUFFER_CHUNKS,
					maxBufferBytes: config.MAX_BUFFER_BYTES
				})
			);
			return;
		}
		// If no handlers responded, return a simple homepage
		simplePage(req, res);
	});

	server.listen(port, () => {
		if (logToApiFile) logToApiFile('INFO', `HTTP API listening on http://localhost:${port}`);
		if (logToFile) logToFile('INFO', `HTTP API listening on http://localhost:${port}`);
		console.log(`HTTP API listening on http://localhost:${port}`);
	});

	return server;
}

module.exports = createApiServer;
