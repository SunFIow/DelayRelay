import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { LOGGER, LOGGER_API } from '../logger.js';

import { config } from '../config.js';

export class ApiServer {
	constructor() {
		this.port = config.API_PORT;
		this.server = http.createServer((req, res) => this.requestHandler(req, res));
	}

	run() {
		this.server.listen(this.port, () => {
			LOGGER_API.info(`HTTP API listening on http://localhost:${this.port}`);
			LOGGER.info(`HTTP API listening on http://localhost:${this.port}`);
			console.log(`HTTP API listening on http://localhost:${this.port}`);
		});
	}

	requestHandler(req, res) {
		const request_done = this.endpoints(req, res);
		if (request_done) return;

		// UI page
		if (req.method === 'GET' && req.url === '/ui') {
			return this.sendPage(res, 'relay-ui.html');
		}

		// Controls page
		this.sendPage(res, 'relay-controls.html');
	}

	endpoints(req, res) {
		// /set-local-port?port=8888
		if (req.method === 'GET' && req.url.startsWith('/set-local-port')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const portVal = parseInt(url.searchParams.get('port'), 10);
			if (!isNaN(portVal) && portVal > 0 && portVal < 65536) {
				config.LOCAL_PORT = portVal;
				LOGGER_API.info(`Local port set to ${portVal}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Local port set to ${portVal}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid port parameter. Usage: "/set-local-port?port=1935"\n');
			}
			return true;
		}
		// /set-delay?ms=15000
		if (req.method === 'GET' && req.url.startsWith('/set-delay')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const ms = parseInt(url.searchParams.get('ms'), 10);
			if (!isNaN(ms) && ms > 0) {
				config.STREAM_DELAY_MS = ms;
				LOGGER_API.info(`Stream delay set to ${ms} ms (${(ms / 1000).toFixed(2)}s)`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Stream delay set to ${ms} ms\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid ms parameter. Usage: "/set-delay?ms=15000" (for 15s)\n');
			}
			return true;
		}
		// /activate-delay
		if (req.method === 'GET' && req.url.startsWith('/activate-delay')) {
			config.STATE = 'REWIND';
			LOGGER_API.info(`Delay activated`);
			LOGGER.info(`Delay activated`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Delay activated\n`);
			return true;
		}
		// /deactivate-delay
		if (req.method === 'GET' && req.url.startsWith('/deactivate-delay')) {
			config.STATE = 'FORWARD';
			LOGGER_API.info(`Delay deactivated`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Delay deactivated\n`);
			return true;
		}
		// /set-remote-url?url=live.twitch.tv
		if (req.method === 'GET' && req.url.startsWith('/set-remote-url')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const remoteUrl = url.searchParams.get('url');
			if (remoteUrl) {
				config.REMOTE_RTMP_URL = remoteUrl;
				LOGGER_API.info(`Remote RTMP URL set to ${remoteUrl}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Remote RTMP URL set to ${remoteUrl}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid url parameter. Usage: "/set-remote-url?url=live.twitch.tv"\n');
			}
			return true;
		}
		// /set-rtmp-port?port=1935
		if (req.method === 'GET' && req.url.startsWith('/set-rtmp-port')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const portVal = parseInt(url.searchParams.get('port'), 10);
			if (!isNaN(portVal) && portVal > 0 && portVal < 65536) {
				config.REMOTE_RTMP_PORT = portVal;
				LOGGER_API.info(`Remote RTMP port set to ${portVal}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Remote RTMP port set to ${portVal}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid port parameter. Usage: "/set-rtmp-port?port=1935"\n');
			}
			return true;
		}
		// /set-latency?ms=10
		if (req.method === 'GET' && req.url.startsWith('/set-latency')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const latency = parseInt(url.searchParams.get('ms'), 10);
			if (!isNaN(latency) && latency > 0) {
				config.LATENCY_INTERVAL = latency;
				LOGGER_API.info(`Latency interval set to ${latency} ms`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Latency interval set to ${latency} ms\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid ms parameter. Usage: "/set-latency?ms=10"\n');
			}
			return true;
		}
		// /set-max-chunks?chunks=10000
		if (req.method === 'GET' && req.url.startsWith('/set-max-chunks')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const chunks = parseInt(url.searchParams.get('chunks'), 10);
			if (!isNaN(chunks) && chunks > 0) {
				config.MAX_BUFFER_CHUNKS = chunks;
				LOGGER_API.info(`Max buffer chunks set to ${chunks}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Max buffer chunks set to ${chunks}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid chunks parameter. Usage: "/set-max-chunks?chunks=10000"\n');
			}
			return true;
		}
		// /set-max-bytes?bytes=52428800
		if (req.method === 'GET' && req.url.startsWith('/set-max-bytes')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const bytes = parseInt(url.searchParams.get('bytes'), 10);
			if (!isNaN(bytes) && bytes > 0) {
				config.MAX_BUFFER_BYTES = bytes;
				LOGGER_API.info(`Max buffer bytes set to ${bytes}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Max buffer bytes set to ${bytes}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid bytes parameter. Usage: "/set-max-bytes?bytes=52428800"\n');
			}
			return true;
		}

		// /start-server
		if (req.method === 'GET' && req.url === '/start-server') {
			if (config.server) {
				if (config.serverRunning) {
					res.writeHead(200, { 'Content-Type': 'text/plain' });
					res.end('Relay server is already running.\n');
				} else {
					config.server.run();
					LOGGER_API.info('Relay server started via API');
					res.writeHead(200, { 'Content-Type': 'text/plain' });
					res.end('Relay server started.\n');
				}
			} else {
				res.writeHead(500, { 'Content-Type': 'text/plain' });
				res.end('Relay server instance not available.\n');
			}
			return true;
		}

		// /stop-server
		if (req.method === 'GET' && req.url === '/stop-server') {
			if (config.server) {
				if (!config.serverRunning) {
					res.writeHead(200, { 'Content-Type': 'text/plain' });
					res.end("Relay server isn't running.\n");
				} else {
					config.server.close(() => {
						LOGGER_API.info('Relay server stopped via API');
						res.writeHead(200, { 'Content-Type': 'text/plain' });
						res.end('Relay server stopped.\n');
					});
				}
			} else {
				res.writeHead(500, { 'Content-Type': 'text/plain' });
				res.end('Relay server instance not available.\n');
			}
			return true;
		}

		// /status
		if (req.method === 'GET' && req.url === '/status') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(config.toString());
			return true;
		}

		return false; // No matching endpoint found
	}

	sendPage(res, fileName) {
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = path.dirname(__filename);
		const filePath = path.join(__dirname, fileName);
		fs.readFile(filePath, 'utf8', (err, data) => {
			if (err) {
				LOGGER_API.error(`Failed to read file ${filePath}: ${err.message}`);
				res.writeHead(500, { 'Content-Type': 'text/plain' });
				res.end('Internal Server Error');
				return;
			}
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end(data);
		});
	}
}
