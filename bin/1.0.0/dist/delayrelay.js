'use strict';

var fs = require('fs');
var http = require('http');
var path = require('path');
var url = require('url');
var net = require('net');
var node_crypto = require('node:crypto');
var node_querystring = require('node:querystring');

var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
const FILENAME = url.fileURLToPath((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('delayrelay.js', document.baseURI).href)));
const DIRNAME = path.dirname(FILENAME);
const workingDirectory = process.cwd();

function getFilePath(filename, vm = false) {
	if (vm) {
		return path.join(DIRNAME, filename);
	}
	return path.join(workingDirectory, filename);
}

let Logger$1 = class Logger {
	constructor(prefix) {
		const d = new Date();
		const pad = n => n.toString().padStart(2, '0');
		const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}__${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
		this.logFile = getFilePath(`logs/${prefix}_${ts}.log`);
		this.logLatest = getFilePath(`${prefix}_latest.log`);
		// Crate logs directory if it doesn't exist
		const logDir = getFilePath('logs');
		if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
		// Truncate latest log files at startup
		fs.writeFileSync(this.logLatest, '');
		this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
		this.logLatestStream = fs.createWriteStream(this.logLatest, { flags: 'a' });
	}

	debug(...message) {
		this.log('DEBUG', ...message);
	}

	info(...message) {
		this.log('INFO', ...message);
	}

	warn(...message) {
		this.log('WARN', ...message);
	}

	error(...message) {
		this.log('ERROR', ...message);
	}

	fatal(...message) {
		this.log('FATAL', ...message);
	}

	log(level, ...message) {
		const timestamp = this.getTimeString();
		const line = `[${timestamp}] [${level}] ${message.join(' ')}`;
		this.logStream.write(line + '\n');
		if (level !== 'DEBUG') {
			this.logLatestStream.write(line + '\n');
			console.log(line);
		}
	}

	getTimeString() {
		const d = new Date();
		const pad = n => n.toString().padStart(2, '0');
		return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	}
};

const LOGGER = new Logger$1('relay');
const LOGGER_API = new Logger$1('api');

const TESTING = false; // Set to true for local testing

const CONFIG_PATH = getFilePath('config.json');
getFilePath('config.test.json');

class Config {
	constructor() {
		this.server = null; // Will hold the server instance
		this.serverRunning = false; // Track if the relay server is running
		this.clientConnected = false; // Track If the client is connected to the remote server
		this.state = 'REALTIME'; // Initial state
		this.configPath = CONFIG_PATH;

		this.loadFromDisk();

		this._API_PORT ??= 8080; // Local port for the API server
		this._LOCAL_PORT ??= 8888; // Local port for the proxy server
		this._STREAM_DELAY_MS ??= 30_000; // 30 seconds delay
		/**@type {"REALTIME" | "REWIND" | "DELAY" | "FORWARD"} */
		this._REMOTE_RTMP_URL ??= 'live.twitch.tv';
		this._REMOTE_RTMP_PORT ??= 1935;
		this._LATENCY_INTERVAL ??= 5; // Check every 10ms for low latency
		this._MAX_BUFFER_BYTES ??= 1 * 1024 * 1024 * 1024; // 1 GB max buffer size
		this._MAX_BUFFER_CHUNKS ??= this._MAX_BUFFER_BYTES / 6000; // Max number of chunks in buffer

		this.saveToDisk();
	}

	loadFromDisk() {
		try {
			if (fs.existsSync(this.configPath)) {
				const raw = fs.readFileSync(this.configPath, 'utf8');
				const data = JSON.parse(raw);
				const prop = Object.getPrototypeOf(this);
				for (const k in data) {
					const desc = Object.getOwnPropertyDescriptor(prop, k);
					if (desc) this[`_${k}`] = data[k];
				}
			} else {
				LOGGER.warn(`Config file ${this.configPath} does not exist, using default values.`);
			}
		} catch (e) {
			LOGGER.error('Failed to load config from disk:', e);
		}
	}

	saveToDisk() {
		try {
			const data = {
				API_PORT: this.API_PORT,
				LOCAL_PORT: this.LOCAL_PORT,
				STREAM_DELAY_MS: this.STREAM_DELAY_MS,
				REMOTE_RTMP_URL: this.REMOTE_RTMP_URL,
				REMOTE_RTMP_PORT: this.REMOTE_RTMP_PORT,
				LATENCY_INTERVAL: this.LATENCY_INTERVAL,
				MAX_BUFFER_BYTES: this.MAX_BUFFER_BYTES,
				MAX_BUFFER_CHUNKS: this.MAX_BUFFER_CHUNKS
			};

			fs.writeFileSync(this.configPath, JSON.stringify(data, null, 3), 'utf8');
		} catch (e) {
			LOGGER.error('Failed to save config to disk:', e);
		}
	}

	toString() {
		return JSON.stringify({
			TESTING: TESTING,
			API_PORT: this.API_PORT,
			LOCAL_PORT: this.LOCAL_PORT,
			serverRunning: this.serverRunning,
			clientConnected: this.clientConnected,
			state: this.state,
			STREAM_DELAY_MS: this.STREAM_DELAY_MS,
			REMOTE_RTMP_URL: this.REMOTE_RTMP_URL,
			REMOTE_RTMP_PORT: this.REMOTE_RTMP_PORT,
			LATENCY_INTERVAL: this.LATENCY_INTERVAL,
			MAX_BUFFER_BYTES: this.MAX_BUFFER_BYTES,
			MAX_BUFFER_CHUNKS: this.MAX_BUFFER_CHUNKS
		});
	}

	get API_PORT() {
		return this._API_PORT;
	}
	set API_PORT(v) {
		this._API_PORT = v;
		this.saveToDisk();
	}

	get LOCAL_PORT() {
		return this._LOCAL_PORT;
	}
	set LOCAL_PORT(v) {
		this._LOCAL_PORT = v;
		this.saveToDisk();
	}

	get STREAM_DELAY_MS() {
		return this._STREAM_DELAY_MS;
	}
	set STREAM_DELAY_MS(v) {
		this._STREAM_DELAY_MS = v;
		this.saveToDisk();
	}

	get REMOTE_RTMP_URL() {
		return this._REMOTE_RTMP_URL;
	}
	set REMOTE_RTMP_URL(v) {
		this._REMOTE_RTMP_URL = v;
		this.saveToDisk();
	}

	get REMOTE_RTMP_PORT() {
		return this._REMOTE_RTMP_PORT;
	}
	set REMOTE_RTMP_PORT(v) {
		this._REMOTE_RTMP_PORT = v;
		this.saveToDisk();
	}

	get LATENCY_INTERVAL() {
		return this._LATENCY_INTERVAL;
	}
	set LATENCY_INTERVAL(v) {
		this._LATENCY_INTERVAL = v;
		this.saveToDisk();
	}

	get MAX_BUFFER_BYTES() {
		return this._MAX_BUFFER_BYTES;
	}
	set MAX_BUFFER_BYTES(v) {
		this._MAX_BUFFER_BYTES = v;
		this.saveToDisk();
	}

	get MAX_BUFFER_CHUNKS() {
		return this._MAX_BUFFER_CHUNKS;
	}
	set MAX_BUFFER_CHUNKS(v) {
		this._MAX_BUFFER_CHUNKS = v;
		this.saveToDisk();
	}
}

const config = new Config();

class ApiServer {
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
		if (req.method !== 'GET') return false; // Only handle GET requests

		// /set-api-port?port=8080
		if (req.url.startsWith('/set-api-port')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const portVal = parseInt(url.searchParams.get('port'), 10);
			if (!isNaN(portVal) && portVal > 0 && portVal < 65536) {
				config.API_PORT = portVal;
				LOGGER_API.info(`API port set to ${portVal}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`API port set to ${portVal}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid port parameter. Usage: "/set-api-port?port=8080"\n');
			}
			return true;
		}
		// /set-local-port?port=8888
		else if (req.url.startsWith('/set-local-port')) {
			const url = new URL(req.url, `http://${req.headers.host}`);
			const portVal = parseInt(url.searchParams.get('port'), 10);
			if (!isNaN(portVal) && portVal > 0 && portVal < 65536) {
				config.LOCAL_PORT = portVal;
				LOGGER_API.info(`Local port set to ${portVal}`);
				res.writeHead(200, { 'Content-Type': 'text/plain' });
				res.end(`Local port set to ${portVal}\n`);
			} else {
				res.writeHead(400, { 'Content-Type': 'text/plain' });
				res.end('Invalid port parameter. Usage: "/set-local-port?port=8888"\n');
			}
			return true;
		}
		// /set-delay?ms=15000
		else if (req.url.startsWith('/set-delay')) {
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
		else if (req.url.startsWith('/activate-delay')) {
			config.state = 'REWIND';
			LOGGER_API.info(`Delay activated`);
			LOGGER.info(`Delay activated`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Delay activated\n`);
			return true;
		}
		// /deactivate-delay
		else if (req.url.startsWith('/deactivate-delay')) {
			config.state = 'FORWARD';
			LOGGER_API.info(`Delay deactivated`);
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`Delay deactivated\n`);
			return true;
		}
		// /set-remote-url?url=live.twitch.tv
		else if (req.url.startsWith('/set-remote-url')) {
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
		else if (req.url.startsWith('/set-rtmp-port')) {
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
		else if (req.url.startsWith('/set-latency')) {
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
		else if (req.url.startsWith('/set-max-chunks')) {
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
		else if (req.url.startsWith('/set-max-bytes')) {
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
		else if (req.url === '/start-server') {
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
		else if (req.url === '/stop-server') {
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
		else if (req.url === '/status') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(config.toString());
			return true;
		}

		return false; // No matching endpoint found
	}

	sendPage(res, fileName) {
		const filePath = getFilePath('api/' + fileName, true);
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

// PARSER TAG
const PacketTypeSequenceStart$1 = 0;
const PacketTypeCodedFrames$1 = 1;
const PacketTypeCodedFramesX$1 = 3;
const PacketTypeMetadata$1 = 4;
const PacketTypeMPEG2TSSequenceStart = 5;
const FLV_AVC_SEQUENCE_HEADER$1 = 0;
const FOURCC_AV1$1 = Buffer.from('av01');
const FOURCC_VP9$1 = Buffer.from('vp09');
const FOURCC_HEVC$1 = Buffer.from('hvc1');
const FLV_CODECID_H264$1 = 7;
const FLV_FRAME_KEY$1 = 1;
const FLV_CODECID_AAC$1 = 10;

/**
 * @enum {number}
 */
const CodecType = {
	AUDIO: 0x08, // 8 Audio Packet.
	VIDEO: 0x09, // 9 Video Packet.
	DATA: 0x12};

/**
 * @enum {number}
 */
const PacketFlags = {
	AUDIO_HEADER: 0, // 0 Audio Header - Set Audio Header (FLV_CODECID_AAC)
	AUDIO_FRAME: 1, // 1 Audio Frame - Add GOP
	VIDEO_HEADER: 2, // 2 Video Header - Set Video Header (PacketTypeSequenceStart)
	KEY_FRAME: 3, // 3 Key Frame - New GOP
	VIDEO_FRAME: 4, // 4 Video Frame - Add Video Frame
	METADATA: 5, // 5 Metadata - Set Metadata
	HDR_METADATA: 6, // 6 hdrMetadata - Should not happen
	MPEG2TS_METADATA: 7 // 7 mpeg2tsMetadata - Should not happen
};

/** Parses FLV payload to extract only the relevant packet flag.
 * @param {number} type - RTMP packet type (e.g., 8 for audio, 9 for video, 18 for metadata)
 * @param {Buffer} payload - The RTMP packet payload (FLV tag data)
 * @returns {PacketFlags} -1 if not a valid packet type, otherwise returns the packet flag
 */
function parsePacketFlag(type, payload) {
	// Audio packet
	if (type === CodecType.AUDIO) {
		const soundFormat = payload[0] >> 4;
		if (soundFormat === FLV_CODECID_AAC$1) {
			const aacPacketType = payload[1];
			if (aacPacketType === 0) return PacketFlags.AUDIO_HEADER;
		}
		return PacketFlags.AUDIO_FRAME;
	}

	// Video packet
	else if (type === CodecType.VIDEO) {
		const frameType = (payload[0] >> 4) & 0b0111;
		const codecID = payload[0] & 0x0f;
		const isExHeader = frameType !== 0;

		if (isExHeader) {
			const packetType = payload[0] & 0x0f;
			const fourCC = payload.subarray(1, 5);
			if (fourCC.compare(FOURCC_AV1$1) === 0 || fourCC.compare(FOURCC_VP9$1) === 0 || fourCC.compare(FOURCC_HEVC$1) === 0) {
				if (packetType === PacketTypeSequenceStart$1) return PacketFlags.VIDEO_HEADER;
				else if (packetType === PacketTypeCodedFrames$1 || packetType === PacketTypeCodedFramesX$1) {
					// 1
					if (frameType === FLV_FRAME_KEY$1) return PacketFlags.KEY_FRAME;
					else return PacketFlags.VIDEO_FRAME;
				} else if (packetType === PacketTypeMetadata$1) return PacketFlags.HDR_METADATA;
				else if (packetType === PacketTypeMPEG2TSSequenceStart) return PacketFlags.MPEG2TS_METADATA;
			} else {
				const packetType = payload[1];
				if (codecID === FLV_CODECID_H264$1) {
					if (packetType === FLV_AVC_SEQUENCE_HEADER$1) return PacketFlags.VIDEO_HEADER;
					else if (frameType === FLV_FRAME_KEY$1) return PacketFlags.KEY_FRAME;
				}
				return PacketFlags.VIDEO_FRAME;
			}
		}
	}

	// Metadata
	else if (type === CodecType.DATA) return PacketFlags.METADATA;

	return -1;
}

/*

StreamBuffer class for managing video stream chunks with timing and delay buffers.
There are ChunkData Arrays:
1. `buffer`: 
2. `delayBuffer`: A rolling window of chunks from the last N seconds. (The amount of time we want to delay the stream)


*/


const LOG_EVERY = 100; // Log every 100 chunks for performance

/**
 * @typedef {Object} ChunkData
 * @property {Buffer} chunk
 * @property {number} time
 * @property {number} id
 * @property {boolean} keyFrame
 */

/**
 * @class
 * @property {number} CURRENT_ID - Unique ID for each chunk
 * @property {ChunkData[]} buffer - Chunks currently in the buffer
 * @property {ChunkData[]} delayBuffer - Rolling window of chunks from the last N ms
 * @property {boolean} isDelayBufferActive - Whether the delay buffer is currently active
 * @property {number} totalLength - Total length of all chunks in bytes
 * @property {boolean} paused - Whether the buffer is paused
 * @property {number} chunkAddCount - Count of chunks added to the buffer
 * @property {number} relayCount - Count of chunks relayed
 */
class StreamBuffer {
	constructor() {
		this.CURRENT_ID = 0;
		/** @type {ChunkData[]} */
		this.buffer = [];
		this.totalLength = 0;
		/** @type {ChunkData[]} */
		this.delayBuffer = [];
		this.isDelayBufferActive = false;

		this.paused = false;
		this.chunkAddCount = 0;
		this.relayCount = 0;
	}

	formatBytes(bytes) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	handleMemoryManagement(socket) {
		// Memory management: pause or drop
		if (this.buffer.length > config.MAX_BUFFER_CHUNKS || this.totalLength > config.MAX_BUFFER_BYTES) {
			if (typeof socket.pause === 'function' && !this.paused) {
				socket.pause();
				this.paused = true;
				if (config.state !== 'REWIND') {
					LOGGER.warn(`[Memory] Buffer limit reached. Pausing OBS input. Buffer: ${this.buffer.length} chunks, ${this.totalLength} bytes`);
				} else {
					LOGGER.warn(`[Memory] Buffer limit reached while buffering. Pausing OBS input. Buffer: ${this.buffer.length} chunks, ${this.totalLength} bytes`);
				}
			} else {
				// Drop oldest chunk
				const dropped = this.buffer.shift();
				if (dropped) this.totalLength -= dropped.chunk.length;
				LOGGER.warn(`[Memory] Buffer overflow! Dropped oldest chunk. Buffer: ${this.buffer.length} chunks, ${this.totalLength} bytes`);
			}
		} else if (this.paused && this.buffer.length < config.MAX_BUFFER_CHUNKS * 0.8 && this.totalLength < config.MAX_BUFFER_BYTES * 0.8) {
			// Resume if buffer is below 80% of limit
			if (typeof socket.resume === 'function') {
				socket.resume();
				this.paused = false;
				LOGGER.info(`[Memory] Buffer below threshold. Resumed OBS input.`);
			}
		}
	}

	/**
	 * Push a chunk of data to the buffer.
	 * @param {Buffer} chunk - The data chunk to push.
	 * @param {number} codec - The codec type of the chunk.
	 * @param {number} flags - The flags associated with the chunk.
	 */
	pushToBuffer(chunk, codec, flags) {
		const now = Date.now();

		let keyFrame = false;
		if (this.CURRENT_ID > 0 && codec === CodecType.VIDEO) {
			if (flags === PacketFlags.KEY_FRAME && this.lastFlags !== PacketFlags.KEY_FRAME) {
				keyFrame = true;
			}
		}
		this.lastCodec = codec;
		this.lastFlags = flags;

		const chunkData = { chunk, time: now, id: this.CURRENT_ID++, keyFrame };
		this.buffer.push(chunkData);
		this.totalLength += chunk.length;

		if (!this.isDelayBufferActive && keyFrame) this.isDelayBufferActive = true;
		if (this.isDelayBufferActive) this.delayBuffer.push(chunkData);
		this.updateDelayBuffer(now);

		this.chunkAddCount++;
		if (this.chunkAddCount % LOG_EVERY === 0) {
			LOGGER.info(`[Buffer] Added ${this.chunkAddCount} chunks so far`);
			LOGGER.info(`[Buffer] timedBuffer: ${this.buffer.length} chunks, ${this.formatBytes(this.totalLength)} | delayBuffer: ${this.delayBuffer.length} chunks`);
		}
	}

	/**
	 * Pop and return all chunks ready to be relayed based on state and delay
	 * @returns {Array<{chunk: Buffer, time: number, id: number}>}
	 */
	popReadyChunks() {
		if (config.state === 'REWIND') {
			this.handleRewinding();
			config.state = 'DELAY';
		}
		if (config.state === 'FORWARD') {
			this.handleForwarding();
			config.state = 'REALTIME';
		}

		const readyChunks = [];
		const now = Date.now();

		while (this.buffer.length > 0 && (config.state === 'REALTIME' || now - this.buffer[0].time > config.STREAM_DELAY_MS)) {
			const buf = this.buffer.shift();
			readyChunks.push(buf);
			this.totalLength -= buf.chunk.length;
		}

		if (readyChunks.length > 0) {
			this.relayCount += readyChunks.length;
			if (this.relayCount % LOG_EVERY === 0) {
				LOGGER.info(`[Relay] Relayed ${readyChunks.length}/${this.relayCount} chunks so far`);
			}
			if (readyChunks.length > 25) {
				LOGGER.warn(`[Relay] Sending ${readyChunks.length} chunks to Remote at once!`);
			}
		}

		return readyChunks;
	}

	/**
	 * Removes chunks from delayBuffer that are older than STREAM_DELAY_MS.
	 * Ensures the buffer starts at a key frame for clean playback.
	 */
	updateDelayBuffer(now) {
		if (config.state === 'REWIND') return;
		while (this.delayBuffer.length > 0 && now - this.delayBuffer[0].time > config.STREAM_DELAY_MS) {
			// Remove chunks until we find a key frame or the buffer is empty
			let skipSameKeyFrame = this.delayBuffer[0].keyFrame;
			while (this.delayBuffer.length > 0 && !skipSameKeyFrame) {
				this.delayBuffer.shift();
				skipSameKeyFrame = this.delayBuffer[0]?.keyFrame;
			}

			// Remove all chunks associated with the found key frame or the buffer is empty
			let foundNewKeyFrame = false;
			while (this.delayBuffer.length > 0 && !foundNewKeyFrame) {
				const buf = this.delayBuffer[0];
				const isKeyFrame = buf.keyFrame;
				// Dont check for key frame if we are skipping same key frame headers
				if (!isKeyFrame && skipSameKeyFrame) skipSameKeyFrame = false;
				// When we find a new key frame, we stop removing chunks
				if (isKeyFrame && !skipSameKeyFrame) foundNewKeyFrame = true;
				else this.delayBuffer.shift();
			}
		}
	}

	handleRewinding() {
		// Add all chunks from delayBuffer to the start of buffer
		// this.buffer.unshift(...this.delayBuffer);
		for (let i = this.delayBuffer.length - 1; i >= 0; i--) {
			const chunkData = this.delayBuffer[i];
			if (this.buffer.findIndex(b => b.id === chunkData.id) === -1) {
				this.buffer.unshift(chunkData);
				this.totalLength += chunkData.chunk.length;
			}
		}
	}

	handleForwarding() {
		// Only keep chunks associated with the most recent key frame

		let mostRecentKeyFrameStart = -1;
		for (let i = this.buffer.length - 1; i >= 0; i--) {
			const isKeyFrame = this.buffer[i].keyFrame;
			if (!isKeyFrame) {
				if (mostRecentKeyFrameStart === -1) {
					break; // Found the start of the most recent key frame
				}
			} else mostRecentKeyFrameStart = i;
		}

		// Now remove all chunks before the most recent key frame
		if (mostRecentKeyFrameStart !== -1) {
			this.buffer = this.buffer.slice(mostRecentKeyFrameStart);
			this.totalLength = this.buffer.reduce((sum, buf) => sum + buf.chunk.length, 0);
		} else {
			this.buffer = [];
			this.totalLength = 0;
		}
	}
}

/**
 * @class
 * @property {net.Socket} clientSocket
 * @property {net.Socket} remoteSocket
 * @property {StreamBuffer} buffer
 * @property {boolean} ended
 */
class Connection {
	/** @param {net.Socket} clientSocket */
	constructor(clientSocket) {
		this.clientSocket = clientSocket;
		this.buffer = new StreamBuffer();
		this.ended = false;
		this.initializeClient();
		this.initializeRemote();
	}

	run() {
		this.remoteSocket.connect(config.REMOTE_RTMP_PORT, config.REMOTE_RTMP_URL);
		this.clientSocket.resume();
		this.interval = setInterval(this.sendChunks.bind(this), config.LATENCY_INTERVAL);
	}

	initializeClient() {
		this.clientSocket.setNoDelay(true);

		this.clientSocket.on('data', data => {
			if (this.ended) return;
			LOGGER.debug(`[Data] Received Client data: ${data.length} bytes`);
			this.onData(data);
		});

		this.clientSocket.on('error', err => {
			LOGGER.error(`Client socket error(${err}): \nName: ${err.name}\nMessage: ${err.message}\nStack: ${err.stack}\nCause: ${err.cause}`);
		});

		this.clientSocket.on('close', hadError => {
			if (hadError) LOGGER.error(`[Disconnect] Client connection closed with error: ${hadError}`);
			else LOGGER.info(`[Disconnect] Client connection closed`);
			this.ended = true;
			clearInterval(this.interval);
			this.remoteSocket.end();
			config.clientConnected = false;
		});
	}

	initializeRemote() {
		this.remoteSocket = new net.Socket();
		this.remoteSocket.setNoDelay(true);

		this.remoteSocket.on('connect', () => {
			LOGGER.info(`[Connect] Connected to Remote`);
			config.clientConnected = true;
			// this.remoteSocket.pipe(this.clientSocket);
		});

		this.remoteSocket.on('data', data => {
			if (this.ended) return;
			LOGGER.debug(`[Data] Received Remote data: ${data.length} bytes`);
			this.clientSocket.write(data);
		});

		this.remoteSocket.on('error', err => {
			LOGGER.error(`Remote socket error(${err}): \nName: ${err.name}\nMessage: ${err.message}\nStack: ${err.stack}\nCause: ${err.cause}`);
		});

		this.remoteSocket.on('close', hadError => {
			if (hadError) LOGGER.error(`[Disconnect] Remote connection closed with error: ${hadError}`);
			else LOGGER.info(`[Disconnect] Remote connection closed`);
			this.ended = true;
			clearInterval(this.interval);
			this.clientSocket.end();
			config.clientConnected = false;
		});
	}

	sendChunks() {
		if (this.ended) return;
		const readyChunks = this.buffer.popReadyChunks();

		for (const { chunk, id } of readyChunks) {
			if (this.remoteSocket?.writable) {
				LOGGER.debug(`[Flush] Sending [${id}] ${chunk.length} bytes to Remote`);
				this.remoteSocket.write(chunk);
			} else {
				LOGGER.warn(`[Flush] Remote socket not writable, skipping chunk [${id}]`);
			}
		}
	}

	/**
	 *  @abstract This method should be implemented in subclasses to handle incoming data.
	 * @param {Buffer} chunks
	 */
	onData(chunks) {}
}

// @ts-check
//
//  Created by Chen Mingliang on 23/12/01.
//  illuspas@msn.com
//  Copyright (c) 2023 NodeMedia. All rights reserved.
//

class Logger {
	constructor(level = 'info') {
		this.levels = ['trace', 'debug', 'info', 'warn', 'error'];
		this.level = this.levels.includes(level) ? level : 'info';
	}

	log(message, logLevel = 'info') {
		const messageLevel = this.levels.indexOf(logLevel);
		const currentLevel = this.levels.indexOf(this.level);

		if (messageLevel >= currentLevel) {
			console.log(`[${this.getTime()}] [${logLevel.toUpperCase()}] ${message}`);
		}
	}

	getTime() {
		const now = new Date();
		return now.toLocaleString();
	}

	/**
	 * @param {string} message
	 */
	trace(message) {
		this.log(message, 'trace');
	}

	/**
	 * @param {string} message
	 */
	debug(message) {
		this.log(message, 'debug');
	}

	/**
	 * @param {string} message
	 */
	info(message) {
		this.log(message, 'info');
	}

	/**
	 * @param {string} message
	 */
	warn(message) {
		this.log(message, 'warn');
	}

	/**
	 * @param {string} message
	 */
	error(message) {
		this.log(message, 'error');
	}
}

var logger = new Logger('debug');

/**
 * Created by delian on 3/12/14.
 * This module provides encoding and decoding of the AMF0 format
 */


const amf0dRules = {
	0x00: amf0decNumber,
	0x01: amf0decBool,
	0x02: amf0decString,
	0x03: amf0decObject,
	//    0x04: amf0decMovie, // Reserved
	0x05: amf0decNull,
	0x06: amf0decUndefined,
	0x07: amf0decRef,
	0x08: amf0decArray,
	// 0x09: amf0decObjEnd, // Should never happen normally
	0x0a: amf0decSArray,
	0x0b: amf0decDate,
	0x0c: amf0decLongString,
	//    0x0D: amf0decUnsupported, // Has been never originally implemented by Adobe!
	//    0x0E: amf0decRecSet, // Has been never originally implemented by Adobe!
	0x0f: amf0decXmlDoc,
	0x10: amf0decTypedObj
};

const amf0eRules = {
	'string': amf0encString,
	'integer': amf0encNumber,
	'double': amf0encNumber,
	'xml': amf0encXmlDoc,
	'object': amf0encObject,
	'array': amf0encArray,
	'sarray': amf0encSArray,
	'binary': amf0encString,
	'true': amf0encBool,
	'false': amf0encBool,
	'undefined': amf0encUndefined,
	'null': amf0encNull
};

/**
 *
 * @param {any} o
 * @returns {string}
 */
function amfType(o) {
	let jsType = typeof o;

	if (o === null) return 'null';
	if (jsType == 'undefined') return 'undefined';
	if (jsType == 'number') {
		if (parseInt(o) == o) return 'integer';
		return 'double';
	}
	if (jsType == 'boolean') return o ? 'true' : 'false';
	if (jsType == 'string') return 'string';
	if (jsType == 'object') {
		if (o instanceof Array) {
			if (o.sarray) return 'sarray';
			return 'array';
		}
		return 'object';
	}
	throw new Error('Unsupported type!');
}

// AMF0 Implementation

/**
 * AMF0 Decode Number
 * @param {Buffer} buf
 * @returns {{len: number, value: (* | number)}}
 */
function amf0decNumber(buf) {
	return { len: 9, value: buf.readDoubleBE(1) };
}

/**
 * AMF0 Encode Number
 * @param {number} num
 * @returns {Buffer}
 */
function amf0encNumber(num) {
	let buf = Buffer.alloc(9);
	buf.writeUInt8(0x00, 0);
	buf.writeDoubleBE(num, 1);
	return buf;
}

/**
 * AMF0 Decode Boolean
 * @param {Buffer} buf
 * @returns {{len: number, value: boolean}}
 */
function amf0decBool(buf) {
	return { len: 2, value: buf.readUInt8(1) != 0 };
}

/**
 * AMF0 Encode Boolean
 * @param {number} num
 * @returns {Buffer}
 */
function amf0encBool(num) {
	let buf = Buffer.alloc(2);
	buf.writeUInt8(0x01, 0);
	buf.writeUInt8(num ? 1 : 0, 1);
	return buf;
}

/**
 * AMF0 Decode Null
 * @returns {{len: number, value: null}}
 */
function amf0decNull() {
	return { len: 1, value: null };
}

/**
 * AMF0 Encode Null
 * @returns {Buffer}
 */
function amf0encNull() {
	let buf = Buffer.alloc(1);
	buf.writeUInt8(0x05, 0);
	return buf;
}

/**
 * AMF0 Decode Undefined
 * @returns {{len: number, value: undefined}}
 */
function amf0decUndefined() {
	return { len: 1, value: undefined };
}

/**
 * AMF0 Encode Undefined
 * @returns {Buffer}
 */
function amf0encUndefined() {
	let buf = Buffer.alloc(1);
	buf.writeUInt8(0x06, 0);
	return buf;
}

/**
 * AMF0 Decode Date
 * @param {Buffer} buf
 * @returns {{len: number, value: (* | number)}}
 */
function amf0decDate(buf) {
	//    let s16 = buf.readInt16BE(1);
	let ts = buf.readDoubleBE(3);
	return { len: 11, value: ts };
}

/**
 * AMF0 Decode Object
 * @param {Buffer} buf
 * @returns {{len: number, value: {}}}
 */
function amf0decObject(buf) {
	// TODO: Implement references!
	let obj = {};
	let iBuf = buf.slice(1);
	let len = 1;
	//    logger.debug('ODec',iBuf.readUInt8(0));
	while (iBuf.readUInt8(0) != 0x09) {
		// logger.debug('Field', iBuf.readUInt8(0), iBuf);
		let prop = amf0decUString(iBuf);
		// logger.debug('Got field for property', prop);
		len += prop.len;
		if (iBuf.length < prop.len) {
			break;
		}
		if (iBuf.slice(prop.len).readUInt8(0) == 0x09) {
			len++;
			// logger.debug('Found the end property');
			break;
		} // END Object as value, we shall leave
		if (prop.value == '') break;
		let val = amf0DecodeOne(iBuf.slice(prop.len));
		// logger.debug('Got field for value', val);
		obj[prop.value] = val.value;
		len += val.len;
		iBuf = iBuf.slice(prop.len + val.len);
	}
	return { len: len, value: obj };
}

/**
 * AMF0 Encode Object
 * @param {object} o
 * @returns {Buffer}
 */
function amf0encObject(o) {
	if (typeof o !== 'object') return null;

	let data = Buffer.alloc(1);
	data.writeUInt8(0x03, 0); // Type object
	let k;
	for (k in o) {
		data = Buffer.concat([data, amf0encUString(k), amf0EncodeOne(o[k])]);
	}
	let termCode = Buffer.alloc(1);
	termCode.writeUInt8(0x09, 0);
	return Buffer.concat([data, amf0encUString(''), termCode]);
}

/**
 * AMF0 Decode Reference
 * @param {Buffer} buf
 * @returns {{len: number, value: string}}
 */
function amf0decRef(buf) {
	let index = buf.readUInt16BE(1);
	return { len: 3, value: 'ref' + index };
}

/**
 * AMF0 Decode String
 * @param {Buffer} buf
 * @returns {{len: *, value: (* | string | string)}}
 */
function amf0decString(buf) {
	let sLen = buf.readUInt16BE(1);
	return { len: 3 + sLen, value: buf.toString('utf8', 3, 3 + sLen) };
}

/**
 * AMF0 Decode Untyped (without the type byte) String
 * @param {Buffer} buf
 * @returns {{len: *, value: (* | string | string)}}
 */
function amf0decUString(buf) {
	let sLen = buf.readUInt16BE(0);
	return { len: 2 + sLen, value: buf.toString('utf8', 2, 2 + sLen) };
}

/**
 * Do AMD0 Encode of Untyped String
 * @param {string} str
 * @returns {Buffer}
 */
function amf0encUString(str) {
	let data = Buffer.from(str, 'utf8');
	let sLen = Buffer.alloc(2);
	sLen.writeUInt16BE(data.length, 0);
	return Buffer.concat([sLen, data]);
}

/**
 * AMF0 Encode String
 * @param {string} str
 * @returns {Buffer}
 */
function amf0encString(str) {
	let buf = Buffer.alloc(3);
	buf.writeUInt8(0x02, 0);
	buf.writeUInt16BE(str.length, 1);
	return Buffer.concat([buf, Buffer.from(str, 'utf8')]);
}

/**
 * AMF0 Decode Long String
 * @param {Buffer} buf
 * @returns {{len: *, value: (* | string | string)}}
 */
function amf0decLongString(buf) {
	let sLen = buf.readUInt32BE(1);
	return { len: 5 + sLen, value: buf.toString('utf8', 5, 5 + sLen) };
}

/**
 * AMF0 Decode Array
 * @param {Buffer} buf
 * @returns {{len: *, value: ({}|*)}}
 */
function amf0decArray(buf) {
	//    let count = buf.readUInt32BE(1);
	let obj = amf0decObject(buf.slice(4));
	return { len: 5 + obj.len, value: obj.value };
}

/**
 * AMF0 Encode Array
 * @param {Array} a
 * @returns {Buffer}
 */
function amf0encArray(a) {
	let l = 0;
	if (a instanceof Array) l = a.length;
	else l = Object.keys(a).length;
	debug('Array encode', l, a);
	let buf = Buffer.alloc(5);
	buf.writeUInt8(8, 0);
	buf.writeUInt32BE(l, 1);
	let data = amf0encObject(a);
	return Buffer.concat([buf, data.subarray(1)]);
}

/**
 * AMF0 Decode XMLDoc
 * @param {Buffer} buf
 * @returns {{len: *, value: (* | string | string)}}
 */
function amf0decXmlDoc(buf) {
	let sLen = buf.readUInt16BE(1);
	return { len: 3 + sLen, value: buf.toString('utf8', 3, 3 + sLen) };
}

/**
 * AMF0 Encode XMLDoc
 * @param {string} str
 * @returns {Buffer}
 */
function amf0encXmlDoc(str) {
	// Essentially it is the same as string
	let buf = Buffer.alloc(3);
	buf.writeUInt8(0x0f, 0);
	buf.writeUInt16BE(str.length, 1);
	return Buffer.concat([buf, Buffer.from(str, 'utf8')]);
}

/**
 * AMF0 Decode Strict Array
 * @param {Buffer} buf
 * @returns {{len: number, value: Array}}
 */
function amf0decSArray(buf) {
	let a = [];
	let len = 5;
	let ret;
	for (let count = buf.readUInt32BE(1); count; count--) {
		ret = amf0DecodeOne(buf.slice(len));
		a.push(ret.value);
		len += ret.len;
	}
	return { len: len, value: amf0markSArray(a) };
}

/**
 * AMF0 Encode Strict Array
 * @param {Array} a Array
 * @returns {Buffer}
 */
function amf0encSArray(a) {
	debug('Do strict array!');
	let buf = Buffer.alloc(5);
	buf.writeUInt8(0x0a, 0);
	buf.writeUInt32BE(a.length, 1);
	let i;
	for (i = 0; i < a.length; i++) {
		buf = Buffer.concat([buf, amf0EncodeOne(a[i])]);
	}
	return buf;
}

/**
 *
 * @param {Array} a
 * @returns {Array}
 */
function amf0markSArray(a) {
	Object.defineProperty(a, 'sarray', { value: true });
	return a;
}

/**
 * AMF0 Decode Typed Object
 * @param {Buffer} buf
 * @returns {{len: number, value: ({}|*)}}
 */
function amf0decTypedObj(buf) {
	let className = amf0decString(buf);
	let obj = amf0decObject(buf.slice(className.len - 1));
	obj.value.__className__ = className.value;
	return { len: className.len + obj.len - 1, value: obj.value };
}

/**
 * Decode one value from the Buffer according to the applied rules
 * @param {Array} rules
 * @param {Buffer} buffer
 * @returns {*}
 */
function amfXDecodeOne(rules, buffer) {
	if (!rules[buffer.readUInt8(0)]) {
		error('Unknown field', buffer.readUInt8(0));
		return null;
	}
	return rules[buffer.readUInt8(0)](buffer);
}

/**
 * Decode one AMF0 value
 * @param {Buffer} buffer
 * @returns {*}
 */
function amf0DecodeOne(buffer) {
	return amfXDecodeOne(amf0dRules, buffer);
}

/**
 * Encode one AMF value according to rules
 * @param {Array} rules
 * @param {object} o
 * @returns {*}
 */
function amfXEncodeOne(rules, o) {
	//    logger.debug('amfXEncodeOne type',o,amfType(o),rules[amfType(o)]);
	let f = rules[amfType(o)];
	if (f) return f(o);
	throw new Error('Unsupported type for encoding!');
}

/**
 * Encode one AMF0 value
 * @param {object} o
 * @returns {*}
 */
function amf0EncodeOne(o) {
	return amfXEncodeOne(amf0eRules, o);
}

const rtmpCmdCode = {
	'_result': ['transId', 'cmdObj', 'info'],
	'_error': ['transId', 'cmdObj', 'info', 'streamId'], // Info / Streamid are optional
	'onStatus': ['transId', 'cmdObj', 'info'],
	'releaseStream': ['transId', 'cmdObj', 'streamName'],
	'getStreamLength': ['transId', 'cmdObj', 'streamId'],
	'getMovLen': ['transId', 'cmdObj', 'streamId'],
	'FCPublish': ['transId', 'cmdObj', 'streamName'],
	'FCUnpublish': ['transId', 'cmdObj', 'streamName'],
	'FCSubscribe': ['transId', 'cmdObj', 'streamName'],
	'onFCPublish': ['transId', 'cmdObj', 'info'],
	'connect': ['transId', 'cmdObj', 'args'],
	'call': ['transId', 'cmdObj', 'args'],
	'createStream': ['transId', 'cmdObj'],
	'close': ['transId', 'cmdObj'],
	'play': ['transId', 'cmdObj', 'streamName', 'start', 'duration', 'reset'],
	'play2': ['transId', 'cmdObj', 'params'],
	'deleteStream': ['transId', 'cmdObj', 'streamId'],
	'closeStream': ['transId', 'cmdObj'],
	'receiveAudio': ['transId', 'cmdObj', 'bool'],
	'receiveVideo': ['transId', 'cmdObj', 'bool'],
	'publish': ['transId', 'cmdObj', 'streamName', 'type'],
	'seek': ['transId', 'cmdObj', 'ms'],
	'pause': ['transId', 'cmdObj', 'pause', 'ms']
};

const rtmpDataCode = {
	'@setDataFrame': ['method', 'dataObj'],
	'onFI': ['info'],
	'onMetaData': ['dataObj'],
	'|RtmpSampleAccess': ['bool1', 'bool2']
};

/**
 * Decode a command!
 * @param {Buffer} dbuf
 * @returns {{cmd: (* | string | string | *), value: *}}
 */
function decodeAmf0Cmd(dbuf) {
	let buffer = dbuf;
	let resp = {};

	let cmd = amf0DecodeOne(buffer);
	if (!cmd) {
		error('Failed to decode AMF0 command');
		return resp;
	}

	resp.cmd = cmd.value;
	buffer = buffer.slice(cmd.len);

	if (rtmpCmdCode[cmd.value]) {
		rtmpCmdCode[cmd.value].forEach(function (n) {
			if (buffer.length > 0) {
				let r = amf0DecodeOne(buffer);
				buffer = buffer.slice(r.len);
				resp[n] = r.value;
			}
		});
	} else {
		error('Unknown command', resp);
	}
	return resp;
}

/**
 * Encode AMF0 Command
 * @param {object} opt
 * @returns {*}
 */
function encodeAmf0Cmd(opt) {
	let data = amf0EncodeOne(opt.cmd);

	if (rtmpCmdCode[opt.cmd]) {
		rtmpCmdCode[opt.cmd].forEach(function (n) {
			if (Object.prototype.hasOwnProperty.call(opt, n)) data = Buffer.concat([data, amf0EncodeOne(opt[n])]);
		});
	} else {
		error('Unknown command', opt);
	}
	// logger.debug('Encoded as',data.toString('hex'));
	return data;
}

/**
 *
 * @param {object} opt
 * @returns {Buffer}
 */
function encodeAmf0Data(opt) {
	let data = amf0EncodeOne(opt.cmd);

	if (rtmpDataCode[opt.cmd]) {
		rtmpDataCode[opt.cmd].forEach(function (n) {
			if (Object.prototype.hasOwnProperty.call(opt, n)) data = Buffer.concat([data, amf0EncodeOne(opt[n])]);
		});
	} else {
		error('Unknown data', opt);
	}
	// logger.debug('Encoded as',data.toString('hex'));
	return data;
}

// @ts-check
//
//  Created by Chen Mingliang on 23/12/01.
//  illuspas@msn.com
//  Copyright (c) 2023 NodeMedia. All rights reserved.
//

class AVPacket {
	constructor() {
		this.codec_id = 0;
		this.codec_type = 0;
		this.duration = 0;
		this.flags = 0;
		this.pts = 0;
		this.dts = 0;
		this.size = 0;
		this.offset = 0;
		this.data = Buffer.alloc(0);
	}
}

// @ts-check
//
//  Created by Chen Mingliang on 23/12/01.
//  illuspas@msn.com
//  Copyright (c) 2023 Nodemedia. All rights reserved.
//


const FLV_MEDIA_TYPE_AUDIO = 8;
const FLV_MEDIA_TYPE_VIDEO = 9;
const FLV_MEDIA_TYPE_SCRIPT = 18;

const FLV_PARSE_INIT = 0;
const FLV_PARSE_HEAD = 1;
const FLV_PARSE_TAGS = 2;
const FLV_PARSE_PREV = 3;

const FLV_FRAME_KEY = 1; ///< key frame (for AVC, a seekable frame)

const FLV_AVC_SEQUENCE_HEADER = 0;
const FLV_CODECID_AAC = 10;
const FLV_CODECID_H264 = 7;

const FOURCC_AV1 = Buffer.from('av01');
const FOURCC_VP9 = Buffer.from('vp09');
const FOURCC_HEVC = Buffer.from('hvc1');

const PacketTypeSequenceStart = 0;
const PacketTypeCodedFrames = 1;
const PacketTypeCodedFramesX = 3;
const PacketTypeMetadata = 4;

/**
 * @class
 */
class Flv {
	constructor() {
		this.parserBuffer = Buffer.alloc(13);
		this.parserState = FLV_PARSE_INIT;
		this.parserHeaderBytes = 0;
		this.parserTagBytes = 0;
		this.parserTagType = 0;
		this.parserTagSize = 0;
		this.parserTagTime = 0;
		this.parserTagCapacity = 1024 * 1024;
		this.parserTagData = Buffer.alloc(this.parserTagCapacity);
		this.parserPreviousBytes = 0;
	}

	/**
	 * @abstract
	 * @param {AVPacket} avpacket
	 */
	onPacketCallback = avpacket => {};

	/**
	 * @param {Buffer} buffer
	 * @returns {string | null} error
	 */
	parserData = buffer => {
		let s = buffer.length;
		let n = 0;
		let p = 0;
		while (s > 0) {
			switch (this.parserState) {
				case FLV_PARSE_INIT:
					n = 13 - this.parserHeaderBytes;
					n = n <= s ? n : s;
					buffer.copy(this.parserBuffer, this.parserHeaderBytes, p, p + n);
					this.parserHeaderBytes += n;
					s -= n;
					p += n;
					if (this.parserHeaderBytes === 13) {
						this.parserState = FLV_PARSE_HEAD;
						this.parserHeaderBytes = 0;
					}
					break;
				case FLV_PARSE_HEAD:
					n = 11 - this.parserHeaderBytes;
					n = n <= s ? n : s;
					buffer.copy(this.parserBuffer, this.parserHeaderBytes, p, p + n);
					this.parserHeaderBytes += n;
					s -= n;
					p += n;
					if (this.parserHeaderBytes === 11) {
						this.parserState = FLV_PARSE_TAGS;
						this.parserHeaderBytes = 0;
						this.parserTagType = this.parserBuffer[0];
						this.parserTagSize = this.parserBuffer.readUintBE(1, 3);
						this.parserTagTime = (this.parserBuffer[4] << 16) | (this.parserBuffer[5] << 8) | this.parserBuffer[6] | (this.parserBuffer[7] << 24);
						logger.trace(`parser tag type=${this.parserTagType} time=${this.parserTagTime} size=${this.parserTagSize} `);
					}
					break;
				case FLV_PARSE_TAGS:
					this.parserTagAlloc(this.parserTagSize);
					n = this.parserTagSize - this.parserTagBytes;
					n = n <= s ? n : s;
					buffer.copy(this.parserTagData, this.parserTagBytes, p, p + n);
					this.parserTagBytes += n;
					s -= n;
					p += n;
					if (this.parserTagBytes === this.parserTagSize) {
						this.parserState = FLV_PARSE_PREV;
						this.parserTagBytes = 0;
					}
					break;
				case FLV_PARSE_PREV:
					n = 4 - this.parserPreviousBytes;
					n = n <= s ? n : s;
					buffer.copy(this.parserBuffer, this.parserPreviousBytes, p, p + n);
					this.parserPreviousBytes += n;
					s -= n;
					p += n;
					if (this.parserPreviousBytes === 4) {
						this.parserState = FLV_PARSE_HEAD;
						this.parserPreviousBytes = 0;
						const parserPreviousNSize = this.parserBuffer.readUint32BE();
						if (parserPreviousNSize === this.parserTagSize + 11) {
							let packet = Flv.parserTag(this.parserTagType, this.parserTagTime, this.parserTagSize, this.parserTagData);
							this.onPacketCallback(packet);
						} else {
							return 'flv tag parser error';
						}
					}
					break;
			}
		}
		return null;
	};

	/**
	 * @param {number} size
	 */
	parserTagAlloc = size => {
		if (this.parserTagCapacity < size) {
			this.parserTagCapacity = size * 2;
			const newBuffer = Buffer.alloc(this.parserTagCapacity);
			this.parserTagData.copy(newBuffer);
			this.parserTagData = newBuffer;
		}
	};

	/**
	 * @param {boolean} hasAudio
	 * @param {boolean} hasVideo
	 * @returns {Buffer}
	 */
	static createHeader = (hasAudio, hasVideo) => {
		const buffer = Buffer.from([0x46, 0x4c, 0x56, 0x01, 0x00, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x00]);
		if (hasAudio) {
			buffer[4] |= 4;
		}

		if (hasVideo) {
			buffer[4] |= 1;
		}
		return buffer;
	};

	/**
	 * @param {AVPacket} avpacket
	 * @returns {Buffer}
	 */
	static createMessage = avpacket => {
		const buffer = Buffer.alloc(11 + avpacket.size + 4);
		buffer[0] = avpacket.codec_type;
		buffer.writeUintBE(avpacket.size, 1, 3);
		buffer[4] = (avpacket.dts >> 16) & 0xff;
		buffer[5] = (avpacket.dts >> 8) & 0xff;
		buffer[6] = avpacket.dts & 0xff;
		buffer[7] = (avpacket.dts >> 24) & 0xff;
		avpacket.data.copy(buffer, 11, 0, avpacket.size);
		buffer.writeUint32BE(11 + avpacket.size, 11 + avpacket.size);
		return buffer;
	};

	/**
	 * @param {number} type
	 * @param {number} time
	 * @param {number} size
	 * @param {Buffer} data
	 * @returns {AVPacket}
	 */
	static parserTag = (type, time, size, data) => {
		let packet = new AVPacket();
		packet.codec_type = type;
		packet.pts = time;
		packet.dts = time;
		packet.size = size;
		packet.data = data;
		if (type === FLV_MEDIA_TYPE_AUDIO) {
			const codecID = data[0] >> 4;
			packet.codec_id = codecID;
			packet.flags = 1;
			if (codecID === FLV_CODECID_AAC) {
				if (data[1] === 0) {
					packet.flags = 0;
				}
			}
		} else if (type === FLV_MEDIA_TYPE_VIDEO) {
			const frameType = (data[0] >> 4) & 0b0111;
			const codecID = data[0] & 0x0f;
			const isExHeader = ((data[0] >> 4) & 0b1000) !== 0;

			if (isExHeader) {
				const packetType = data[0] & 0x0f;
				const fourCC = data.subarray(1, 5);
				if (fourCC.compare(FOURCC_AV1) === 0 || fourCC.compare(FOURCC_VP9) === 0 || fourCC.compare(FOURCC_HEVC) === 0) {
					packet.codec_id = fourCC.readUint32BE();
					if (packetType === PacketTypeSequenceStart) {
						packet.flags = 2;
					} else if (packetType === PacketTypeCodedFrames || packetType === PacketTypeCodedFramesX) {
						if (frameType === FLV_FRAME_KEY) {
							packet.flags = 3;
						} else {
							packet.flags = 4;
						}
					} else if (packetType === PacketTypeMetadata) {
						// const hdrMetadata = AMF.parseScriptData(packet.data.buffer, 5, packet.size);
						// logger.debug(`hdrMetadata:${JSON.stringify(hdrMetadata)}`);
						packet.flags = 6;
					}

					if (fourCC.compare(FOURCC_HEVC) === 0) {
						if (packetType === PacketTypeCodedFrames) {
							const cts = data.readUintBE(5, 3);
							packet.pts = packet.dts + cts;
						}
					}
				}
			} else {
				const cts = data.readUintBE(2, 3);
				const packetType = data[1];
				packet.codec_id = codecID;
				packet.pts = packet.dts + cts;
				packet.flags = 4;
				if (codecID === FLV_CODECID_H264) {
					if (packetType === FLV_AVC_SEQUENCE_HEADER) {
						packet.flags = 2;
					} else {
						if (frameType === FLV_FRAME_KEY) {
							packet.flags = 3;
						} else {
							packet.flags = 4;
						}
					}
				}
			}
		} else if (type === FLV_MEDIA_TYPE_SCRIPT) {
			packet.flags = 5;
		}
		return packet;
	};
}

// @ts-check
//
//  Created by Chen Mingliang on 24/11/30.
//  illuspas@msn.com
//  Copyright (c) 2024 Nodemedia. All rights reserved.
//

const RTMP_HANDSHAKE_SIZE = 1536;
const RTMP_HANDSHAKE_UNINIT = 0;
const RTMP_HANDSHAKE_0 = 1;
const RTMP_HANDSHAKE_1 = 2;
const RTMP_HANDSHAKE_2 = 3;

const RTMP_PARSE_INIT = 0;
const RTMP_PARSE_BASIC_HEADER = 1;
const RTMP_PARSE_MESSAGE_HEADER = 2;
const RTMP_PARSE_EXTENDED_TIMESTAMP = 3;
const RTMP_PARSE_PAYLOAD = 4;

const MAX_CHUNK_HEADER = 18;

const RTMP_CHUNK_TYPE_0 = 0; // 11-bytes: timestamp(3) + length(3) + stream type(1) + stream id(4)
const RTMP_CHUNK_TYPE_1 = 1; // 7-bytes: delta(3) + length(3) + stream type(1)
const RTMP_CHUNK_TYPE_2 = 2; // 3-bytes: delta(3)
const RTMP_CHUNK_TYPE_3 = 3; // 0-byte
const RTMP_CHANNEL_INVOKE = 3;
const RTMP_CHANNEL_AUDIO = 4;
const RTMP_CHANNEL_VIDEO = 5;
const RTMP_CHANNEL_DATA = 6;

const rtmpHeaderSize = [11, 7, 3, 0];

/* Protocol Control Messages */
const RTMP_TYPE_SET_CHUNK_SIZE = 1;
const RTMP_TYPE_ABORT = 2;
const RTMP_TYPE_ACKNOWLEDGEMENT = 3; // bytes read report
const RTMP_TYPE_WINDOW_ACKNOWLEDGEMENT_SIZE = 5; // server bandwidth
const RTMP_TYPE_SET_PEER_BANDWIDTH = 6; // client bandwidth

/* User Control Messages Event (4) */
const RTMP_TYPE_EVENT = 4;

const RTMP_TYPE_AUDIO = 8;
const RTMP_TYPE_VIDEO = 9;

/* Data Message */
const RTMP_TYPE_FLEX_STREAM = 15; // AMF3
const RTMP_TYPE_DATA = 18; // AMF0

/* Command Message */
const RTMP_TYPE_FLEX_MESSAGE = 17; // AMF3
const RTMP_TYPE_INVOKE = 20; // AMF0

const RTMP_CHUNK_SIZE = 128;
const RTMP_MAX_CHUNK_SIZE = 0xffff;

const STREAM_BEGIN = 0x00;

const MESSAGE_FORMAT_0 = 0;
const MESSAGE_FORMAT_1 = 1;
const MESSAGE_FORMAT_2 = 2;

const RTMP_SIG_SIZE = 1536;
const SHA256DL = 32;

const RandomCrud = Buffer.from([
	0xf0, 0xee, 0xc2, 0x4a, 0x80, 0x68, 0xbe, 0xe8, 0x2e, 0x00, 0xd0, 0xd1, 0x02, 0x9e, 0x7e, 0x57, 0x6e, 0xec, 0x5d, 0x2d, 0x29, 0x80, 0x6f, 0xab, 0x93, 0xb8, 0xe6, 0x36, 0xcf, 0xeb, 0x31, 0xae
]);

const GenuineFMSConst = 'Genuine Adobe Flash Media Server 001';
const GenuineFMSConstCrud = Buffer.concat([Buffer.from(GenuineFMSConst, 'utf8'), RandomCrud]);

const GenuineFPConst = 'Genuine Adobe Flash Player 001';
Buffer.concat([Buffer.from(GenuineFPConst, 'utf8'), RandomCrud]);

/**
 *
 * @param {Buffer} data
 * @param {Buffer | string} key
 * @returns {Buffer}
 */
function calcHmac(data, key) {
	let hmac = node_crypto.createHmac('sha256', key);
	hmac.update(data);
	return hmac.digest();
}

/**
 *
 * @param {Buffer} buf
 * @returns {number}
 */
function GetClientGenuineConstDigestOffset(buf) {
	let offset = buf[0] + buf[1] + buf[2] + buf[3];
	offset = (offset % 728) + 12;
	return offset;
}

/**
 *
 * @param {Buffer} buf
 * @returns {number}
 */
function GetServerGenuineConstDigestOffset(buf) {
	let offset = buf[0] + buf[1] + buf[2] + buf[3];
	offset = (offset % 728) + 776;
	return offset;
}

/**
 *
 * @param {Buffer} clientsig
 * @returns {number}
 */
function detectClientMessageFormat(clientsig) {
	let computedSignature, msg, providedSignature, sdl;
	sdl = GetServerGenuineConstDigestOffset(clientsig.slice(772, 776));
	msg = Buffer.concat([clientsig.slice(0, sdl), clientsig.slice(sdl + SHA256DL)], 1504);
	computedSignature = calcHmac(msg, GenuineFPConst);
	providedSignature = clientsig.slice(sdl, sdl + SHA256DL);
	if (computedSignature.equals(providedSignature)) {
		return MESSAGE_FORMAT_2;
	}
	sdl = GetClientGenuineConstDigestOffset(clientsig.slice(8, 12));
	msg = Buffer.concat([clientsig.slice(0, sdl), clientsig.slice(sdl + SHA256DL)], 1504);
	computedSignature = calcHmac(msg, GenuineFPConst);
	providedSignature = clientsig.slice(sdl, sdl + SHA256DL);
	if (computedSignature.equals(providedSignature)) {
		return MESSAGE_FORMAT_1;
	}
	return MESSAGE_FORMAT_0;
}

/**
 *
 * @param {number} messageFormat
 * @returns {Buffer}
 */
function generateS1(messageFormat) {
	let randomBytes = node_crypto.randomBytes(RTMP_SIG_SIZE - 8);
	let handshakeBytes = Buffer.concat([Buffer.from([0, 0, 0, 0, 1, 2, 3, 4]), randomBytes], RTMP_SIG_SIZE);

	let serverDigestOffset;
	if (messageFormat === 1) {
		serverDigestOffset = GetClientGenuineConstDigestOffset(handshakeBytes.slice(8, 12));
	} else {
		serverDigestOffset = GetServerGenuineConstDigestOffset(handshakeBytes.slice(772, 776));
	}

	let msg = Buffer.concat([handshakeBytes.slice(0, serverDigestOffset), handshakeBytes.slice(serverDigestOffset + SHA256DL)], RTMP_SIG_SIZE - SHA256DL);
	let hash = calcHmac(msg, GenuineFMSConst);
	hash.copy(handshakeBytes, serverDigestOffset, 0, 32);
	return handshakeBytes;
}

/**
 *
 * @param {number} messageFormat
 * @param {Buffer} clientsig
 * @returns {Buffer}
 */
function generateS2(messageFormat, clientsig) {
	let randomBytes = node_crypto.randomBytes(RTMP_SIG_SIZE - 32);
	let challengeKeyOffset;
	if (messageFormat === 1) {
		challengeKeyOffset = GetClientGenuineConstDigestOffset(clientsig.slice(8, 12));
	} else {
		challengeKeyOffset = GetServerGenuineConstDigestOffset(clientsig.slice(772, 776));
	}
	let challengeKey = clientsig.slice(challengeKeyOffset, challengeKeyOffset + 32);
	let hash = calcHmac(challengeKey, GenuineFMSConstCrud);
	let signature = calcHmac(randomBytes, hash);
	let s2Bytes = Buffer.concat([randomBytes, signature], RTMP_SIG_SIZE);
	return s2Bytes;
}

/**
 *
 * @param {Buffer} clientsig
 * @returns {Buffer}
 */
function generateS0S1S2(clientsig) {
	let clientType = Buffer.alloc(1, 3);
	let messageFormat = detectClientMessageFormat(clientsig);
	let allBytes;
	if (messageFormat === MESSAGE_FORMAT_0) {
		//    logger.debug('[rtmp handshake] using simple handshake.');
		allBytes = Buffer.concat([clientType, clientsig, clientsig]);
	} else {
		//    logger.debug('[rtmp handshake] using complex handshake.');
		allBytes = Buffer.concat([clientType, generateS1(messageFormat), generateS2(messageFormat, clientsig)]);
	}
	return allBytes;
}

class RtmpPacket {
	constructor(fmt = 0, cid = 0) {
		this.header = {
			fmt: fmt,
			cid: cid,
			timestamp: 0,
			length: 0,
			type: 0,
			stream_id: 0
		};
		this.clock = 0;
		this.payload = Buffer.alloc(0);
		this.capacity = 0;
		this.bytes = 0;
	}
}

class Rtmp {
	constructor() {
		this.handshakePayload = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
		this.handshakeState = RTMP_HANDSHAKE_UNINIT;
		this.handshakeBytes = 0;

		this.parserBuffer = Buffer.alloc(MAX_CHUNK_HEADER);
		this.parserState = RTMP_PARSE_INIT;
		this.parserBytes = 0;
		this.parserBasicBytes = 0;
		this.parserPacket = new RtmpPacket();
		this.inPackets = new Map();

		this.inChunkSize = RTMP_CHUNK_SIZE;
		this.outChunkSize = RTMP_MAX_CHUNK_SIZE;

		this.streams = 0;
		this.flv = new Flv();
	}

	/**
	 * @param {object} req
	 * @abstract
	 */
	onConnectCallback = req => {};

	/**
	 * @abstract
	 */
	onPlayCallback = () => {};

	/**
	 * @abstract
	 */
	onPushCallback = () => {};

	/**
	 * @abstract
	 * @param {AVPacket} avpacket
	 */
	onPacketCallback = avpacket => {};

	/**
	 * @abstract
	 * @param {Buffer} buffer
	 */
	onOutputCallback = buffer => {};

	/**
	 * @param {Buffer} buffer
	 * @returns {string | null}
	 */
	parserData = buffer => {
		let bytes = buffer.length;
		let p = 0;
		let n = 0;
		while (bytes > 0) {
			switch (this.handshakeState) {
				case RTMP_HANDSHAKE_UNINIT:
					// logger.log('RTMP_HANDSHAKE_UNINIT');
					this.handshakeState = RTMP_HANDSHAKE_0;
					this.handshakeBytes = 0;
					bytes -= 1;
					p += 1;
					break;
				case RTMP_HANDSHAKE_0:
					// logger.log('RTMP_HANDSHAKE_0');
					n = RTMP_HANDSHAKE_SIZE - this.handshakeBytes;
					n = n <= bytes ? n : bytes;
					buffer.copy(this.handshakePayload, this.handshakeBytes, p, p + n);
					this.handshakeBytes += n;
					bytes -= n;
					p += n;
					if (this.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
						this.handshakeState = RTMP_HANDSHAKE_1;
						this.handshakeBytes = 0;
						let s0s1s2 = generateS0S1S2(this.handshakePayload);
						this.onOutputCallback(s0s1s2);
					}
					break;
				case RTMP_HANDSHAKE_1:
					// logger.log('RTMP_HANDSHAKE_1');
					n = RTMP_HANDSHAKE_SIZE - this.handshakeBytes;
					n = n <= bytes ? n : bytes;
					buffer.copy(this.handshakePayload, this.handshakeBytes, p, n);
					this.handshakeBytes += n;
					bytes -= n;
					p += n;
					if (this.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
						this.handshakeState = RTMP_HANDSHAKE_2;
						this.handshakeBytes = 0;
					}
					break;
				case RTMP_HANDSHAKE_2:
				default:
					return this.chunkRead(buffer, p, bytes);
			}
		}
		return null;
	};

	/**
	 * @param {AVPacket} avpacket
	 * @returns {Buffer}
	 */
	static createMessage = avpacket => {
		let rtmpPacket = new RtmpPacket();
		rtmpPacket.header.fmt = MESSAGE_FORMAT_0;
		switch (avpacket.codec_type) {
			case 8:
				rtmpPacket.header.cid = RTMP_CHANNEL_AUDIO;
				break;
			case 9:
				rtmpPacket.header.cid = RTMP_CHANNEL_VIDEO;
				break;
			case 18:
				rtmpPacket.header.cid = RTMP_CHANNEL_DATA;
				break;
		}
		rtmpPacket.header.length = avpacket.size;
		rtmpPacket.header.type = avpacket.codec_type;
		rtmpPacket.header.timestamp = avpacket.dts;
		rtmpPacket.clock = avpacket.dts;
		rtmpPacket.payload = avpacket.data;
		return Rtmp.chunksCreate(rtmpPacket);
	};

	static chunkBasicHeaderCreate = (fmt, cid) => {
		let out;
		if (cid >= 64 + 255) {
			out = Buffer.alloc(3);
			out[0] = (fmt << 6) | 1;
			out[1] = (cid - 64) & 0xff;
			out[2] = ((cid - 64) >> 8) & 0xff;
		} else if (cid >= 64) {
			out = Buffer.alloc(2);
			out[0] = (fmt << 6) | 0;
			out[1] = (cid - 64) & 0xff;
		} else {
			out = Buffer.alloc(1);
			out[0] = (fmt << 6) | cid;
		}
		return out;
	};

	static chunkMessageHeaderCreate = header => {
		let out = Buffer.alloc(rtmpHeaderSize[header.fmt % 4]);
		if (header.fmt <= RTMP_CHUNK_TYPE_2) {
			out.writeUIntBE(header.timestamp >= 0xffffff ? 0xffffff : header.timestamp, 0, 3);
		}

		if (header.fmt <= RTMP_CHUNK_TYPE_1) {
			out.writeUIntBE(header.length, 3, 3);
			out.writeUInt8(header.type, 6);
		}

		if (header.fmt === RTMP_CHUNK_TYPE_0) {
			out.writeUInt32LE(header.stream_id, 7);
		}
		return out;
	};

	/**
	 *
	 * @param {RtmpPacket} packet
	 * @returns {Buffer}
	 */
	static chunksCreate = packet => {
		let header = packet.header;
		let payload = packet.payload;
		let payloadSize = header.length;
		let chunkSize = RTMP_MAX_CHUNK_SIZE;
		let chunksOffset = 0;
		let payloadOffset = 0;
		let chunkBasicHeader = Rtmp.chunkBasicHeaderCreate(header.fmt, header.cid);
		let chunkBasicHeader3 = Rtmp.chunkBasicHeaderCreate(RTMP_CHUNK_TYPE_3, header.cid);
		let chunkMessageHeader = Rtmp.chunkMessageHeaderCreate(header);
		let useExtendedTimestamp = header.timestamp >= 0xffffff;
		let headerSize = chunkBasicHeader.length + chunkMessageHeader.length + (useExtendedTimestamp ? 4 : 0);
		let n = headerSize + payloadSize + Math.floor(payloadSize / chunkSize);

		if (useExtendedTimestamp) {
			n += Math.floor(payloadSize / chunkSize) * 4;
		}
		if (!(payloadSize % chunkSize)) {
			n -= 1;
			if (useExtendedTimestamp) {
				//TODO CHECK
				n -= 4;
			}
		}

		let chunks = Buffer.alloc(n);
		chunkBasicHeader.copy(chunks, chunksOffset);
		chunksOffset += chunkBasicHeader.length;
		chunkMessageHeader.copy(chunks, chunksOffset);
		chunksOffset += chunkMessageHeader.length;
		if (useExtendedTimestamp) {
			chunks.writeUInt32BE(header.timestamp, chunksOffset);
			chunksOffset += 4;
		}
		while (payloadSize > 0) {
			if (payloadSize > chunkSize) {
				payload.copy(chunks, chunksOffset, payloadOffset, payloadOffset + chunkSize);
				payloadSize -= chunkSize;
				chunksOffset += chunkSize;
				payloadOffset += chunkSize;
				chunkBasicHeader3.copy(chunks, chunksOffset);
				chunksOffset += chunkBasicHeader3.length;
				if (useExtendedTimestamp) {
					chunks.writeUInt32BE(header.timestamp, chunksOffset);
					chunksOffset += 4;
				}
			} else {
				payload.copy(chunks, chunksOffset, payloadOffset, payloadOffset + payloadSize);
				payloadSize -= payloadSize;
				chunksOffset += payloadSize;
				payloadOffset += payloadSize;
			}
		}
		return chunks;
	};

	/**
	 *
	 * @param {Buffer} data
	 * @param {number} p
	 * @param {number} bytes
	 * @returns {string | null}
	 */
	chunkRead = (data, p, bytes) => {
		let size = 0;
		let offset = 0;
		let extended_timestamp = 0;

		while (offset < bytes) {
			switch (this.parserState) {
				case RTMP_PARSE_INIT:
					this.parserBytes = 1;
					this.parserBuffer[0] = data[p + offset++];
					if (0 === (this.parserBuffer[0] & 0x3f)) {
						this.parserBasicBytes = 2;
					} else if (1 === (this.parserBuffer[0] & 0x3f)) {
						this.parserBasicBytes = 3;
					} else {
						this.parserBasicBytes = 1;
					}
					this.parserState = RTMP_PARSE_BASIC_HEADER;
					break;
				case RTMP_PARSE_BASIC_HEADER:
					while (this.parserBytes < this.parserBasicBytes && offset < bytes) {
						this.parserBuffer[this.parserBytes++] = data[p + offset++];
					}
					if (this.parserBytes >= this.parserBasicBytes) {
						this.parserState = RTMP_PARSE_MESSAGE_HEADER;
					}
					break;
				case RTMP_PARSE_MESSAGE_HEADER:
					size = rtmpHeaderSize[this.parserBuffer[0] >> 6] + this.parserBasicBytes;
					while (this.parserBytes < size && offset < bytes) {
						this.parserBuffer[this.parserBytes++] = data[p + offset++];
					}
					if (this.parserBytes >= size) {
						this.packetParse();
						this.parserState = RTMP_PARSE_EXTENDED_TIMESTAMP;
					}
					break;
				case RTMP_PARSE_EXTENDED_TIMESTAMP:
					size = rtmpHeaderSize[this.parserPacket.header.fmt] + this.parserBasicBytes;
					if (this.parserPacket.header.timestamp === 0xffffff) {
						size += 4;
					}
					while (this.parserBytes < size && offset < bytes) {
						this.parserBuffer[this.parserBytes++] = data[p + offset++];
					}
					if (this.parserBytes >= size) {
						if (this.parserPacket.header.timestamp === 0xffffff) {
							extended_timestamp = this.parserBuffer.readUInt32BE(rtmpHeaderSize[this.parserPacket.header.fmt] + this.parserBasicBytes);
						} else {
							extended_timestamp = this.parserPacket.header.timestamp;
						}

						if (this.parserPacket.bytes === 0) {
							if (RTMP_CHUNK_TYPE_0 === this.parserPacket.header.fmt) {
								this.parserPacket.clock = extended_timestamp;
							} else {
								this.parserPacket.clock += extended_timestamp;
							}
							this.packetAlloc();
						}
						this.parserState = RTMP_PARSE_PAYLOAD;
					}
					break;
				case RTMP_PARSE_PAYLOAD:
					size = Math.min(this.inChunkSize - (this.parserPacket.bytes % this.inChunkSize), this.parserPacket.header.length - this.parserPacket.bytes);
					size = Math.min(size, bytes - offset);
					if (size > 0) {
						data.copy(this.parserPacket.payload, this.parserPacket.bytes, p + offset, p + offset + size);
					}
					this.parserPacket.bytes += size;
					offset += size;

					if (this.parserPacket.bytes >= this.parserPacket.header.length) {
						this.parserState = RTMP_PARSE_INIT;
						this.parserPacket.bytes = 0;
						if (this.parserPacket.clock > 0xffffffff) {
							break;
						}
						this.packetHandler();
					} else if (0 === this.parserPacket.bytes % this.inChunkSize) {
						this.parserState = RTMP_PARSE_INIT;
					}
					break;
			}
		}
		return null;
	};

	packetParse = () => {
		let fmt = this.parserBuffer[0] >> 6;
		let cid = 0;
		if (this.parserBasicBytes === 2) {
			cid = 64 + this.parserBuffer[1];
		} else if (this.parserBasicBytes === 3) {
			cid = (64 + this.parserBuffer[1] + this.parserBuffer[2]) << 8;
		} else {
			cid = this.parserBuffer[0] & 0x3f;
		}
		this.parserPacket = this.inPackets.get(cid) ?? new RtmpPacket(fmt, cid);
		this.inPackets.set(cid, this.parserPacket);
		this.parserPacket.header.fmt = fmt;
		this.parserPacket.header.cid = cid;
		this.chunkMessageHeaderRead();
	};

	chunkMessageHeaderRead = () => {
		let offset = this.parserBasicBytes;

		// timestamp / delta
		if (this.parserPacket.header.fmt <= RTMP_CHUNK_TYPE_2) {
			this.parserPacket.header.timestamp = this.parserBuffer.readUIntBE(offset, 3);
			offset += 3;
		}

		// message length + type
		if (this.parserPacket.header.fmt <= RTMP_CHUNK_TYPE_1) {
			this.parserPacket.header.length = this.parserBuffer.readUIntBE(offset, 3);
			this.parserPacket.header.type = this.parserBuffer[offset + 3];
			// LOGGER_API.debug(`[CODEC]: ${this.parserPacket.header.type}`);
			offset += 4;
		}

		if (this.parserPacket.header.fmt === RTMP_CHUNK_TYPE_0) {
			this.parserPacket.header.stream_id = this.parserBuffer.readUInt32LE(offset);
			offset += 4;
		}
		return offset;
	};

	packetAlloc = () => {
		if (this.parserPacket.capacity < this.parserPacket.header.length) {
			this.parserPacket.payload = Buffer.alloc(this.parserPacket.header.length + 1024);
			this.parserPacket.capacity = this.parserPacket.header.length + 1024;
		}
	};

	packetHandler = () => {
		switch (this.parserPacket.header.type) {
			case RTMP_TYPE_SET_CHUNK_SIZE:
			case RTMP_TYPE_ABORT:
			case RTMP_TYPE_ACKNOWLEDGEMENT:
			case RTMP_TYPE_WINDOW_ACKNOWLEDGEMENT_SIZE:
			case RTMP_TYPE_SET_PEER_BANDWIDTH:
				return this.controlHandler();
			case RTMP_TYPE_EVENT:
				return this.eventHandler();
			case RTMP_TYPE_FLEX_MESSAGE:
			case RTMP_TYPE_INVOKE:
				return this.invokeHandler();
			case RTMP_TYPE_AUDIO:
			case RTMP_TYPE_VIDEO:
			case RTMP_TYPE_FLEX_STREAM: // AMF3
			case RTMP_TYPE_DATA: // AMF0
				return this.dataHandler();
		}
	};

	controlHandler = () => {
		let payload = this.parserPacket.payload;
		switch (this.parserPacket.header.type) {
			case RTMP_TYPE_SET_CHUNK_SIZE:
				this.inChunkSize = payload.readUInt32BE();
				// logger.debug('set inChunkSize', this.inChunkSize);
				break;
			case RTMP_TYPE_ABORT:
				break;
			case RTMP_TYPE_ACKNOWLEDGEMENT:
				break;
			case RTMP_TYPE_WINDOW_ACKNOWLEDGEMENT_SIZE:
				this.ackSize = payload.readUInt32BE();
				// logger.debug('set ack Size', this.ackSize);
				break;
		}
	};

	eventHandler = () => {};

	invokeHandler() {
		let offset = this.parserPacket.header.type === RTMP_TYPE_FLEX_MESSAGE ? 1 : 0;
		let payload = this.parserPacket.payload.subarray(offset, this.parserPacket.header.length);

		let invokeMessage = decodeAmf0Cmd(payload);
		switch (invokeMessage.cmd) {
			case 'connect':
				this.onConnect(invokeMessage);
				break;
			case 'createStream':
				this.onCreateStream(invokeMessage);
				break;
			case 'publish':
				this.onPublish(invokeMessage);
				break;
			case 'play':
				this.onPlay(invokeMessage);
				break;
			case 'deleteStream':
				this.onDeleteStream(invokeMessage);
				break;
			default:
				logger.trace(`unhandle invoke message ${invokeMessage.cmd}`);
				break;
		}
	}

	dataHandler = () => {
		let parcket = Flv.parserTag(this.parserPacket.header.type, this.parserPacket.clock, this.parserPacket.header.length, this.parserPacket.payload);
		// LOGGER_API.debug(`[FLAGS]: ${parcket.flags}`);
		this.onPacketCallback(parcket);
	};

	onConnect = invokeMessage => {
		const url = new URL(invokeMessage.cmdObj.tcUrl);
		this.connectCmdObj = invokeMessage.cmdObj;
		this.streamApp = invokeMessage.cmdObj.app;
		this.streamHost = url.hostname;
		this.objectEncoding = invokeMessage.cmdObj.objectEncoding != null ? invokeMessage.cmdObj.objectEncoding : 0;
		this.connectTime = new Date();
		this.startTimestamp = Date.now();
		this.sendWindowACK(5000000);
		this.setPeerBandwidth(5000000, 2);
		this.setChunkSize(this.outChunkSize);
		this.respondConnect(invokeMessage.transId);
	};

	onCreateStream = invokeMessage => {
		this.respondCreateStream(invokeMessage.transId);
	};

	onPublish = invokeMessage => {
		this.streamName = invokeMessage.streamName.split('?')[0];
		this.streamQuery = node_querystring.parse(invokeMessage.streamName.split('?')[1]);
		this.streamId = this.parserPacket.header.stream_id;
		this.respondPublish();
		this.onConnectCallback({
			app: this.streamApp,
			name: this.streamName,
			host: this.streamHost,
			query: this.streamQuery
		});
		this.onPushCallback();
	};

	onPlay = invokeMessage => {
		this.streamName = invokeMessage.streamName.split('?')[0];
		this.streamQuery = node_querystring.parse(invokeMessage.streamName.split('?')[1]);
		this.streamId = this.parserPacket.header.stream_id;
		this.respondPlay();
		this.onConnectCallback({
			app: this.streamApp,
			name: this.streamName,
			host: this.streamHost,
			query: this.streamQuery
		});
		this.onPlayCallback();
	};

	onDeleteStream = invokeMessage => {};

	sendACK = size => {
		let rtmpBuffer = Buffer.from('02000000000004030000000000000000', 'hex');
		rtmpBuffer.writeUInt32BE(size, 12);
		this.onOutputCallback(rtmpBuffer);
	};

	sendWindowACK = size => {
		let rtmpBuffer = Buffer.from('02000000000004050000000000000000', 'hex');
		rtmpBuffer.writeUInt32BE(size, 12);
		this.onOutputCallback(rtmpBuffer);
	};

	setPeerBandwidth = (size, type) => {
		let rtmpBuffer = Buffer.from('0200000000000506000000000000000000', 'hex');
		rtmpBuffer.writeUInt32BE(size, 12);
		rtmpBuffer[16] = type;
		this.onOutputCallback(rtmpBuffer);
	};

	setChunkSize = size => {
		let rtmpBuffer = Buffer.from('02000000000004010000000000000000', 'hex');
		rtmpBuffer.writeUInt32BE(size, 12);
		this.onOutputCallback(rtmpBuffer);
	};

	sendStreamStatus = (st, id) => {
		let rtmpBuffer = Buffer.from('020000000000060400000000000000000000', 'hex');
		rtmpBuffer.writeUInt16BE(st, 12);
		rtmpBuffer.writeUInt32BE(id, 14);
		this.onOutputCallback(rtmpBuffer);
	};

	sendInvokeMessage = (sid, opt) => {
		let packet = new RtmpPacket();
		packet.header.fmt = RTMP_CHUNK_TYPE_0;
		packet.header.cid = RTMP_CHANNEL_INVOKE;
		packet.header.type = RTMP_TYPE_INVOKE;
		packet.header.stream_id = sid;
		packet.payload = encodeAmf0Cmd(opt);
		packet.header.length = packet.payload.length;
		let chunks = Rtmp.chunksCreate(packet);
		this.onOutputCallback(chunks);
	};

	sendDataMessage(opt, sid) {
		let packet = new RtmpPacket();
		packet.header.fmt = RTMP_CHUNK_TYPE_0;
		packet.header.cid = RTMP_CHANNEL_DATA;
		packet.header.type = RTMP_TYPE_DATA;
		packet.payload = encodeAmf0Data(opt);
		packet.header.length = packet.payload.length;
		packet.header.stream_id = sid;
		let chunks = Rtmp.chunksCreate(packet);
		this.onOutputCallback(chunks);
	}

	sendStatusMessage(sid, level, code, description) {
		let opt = {
			cmd: 'onStatus',
			transId: 0,
			cmdObj: null,
			info: {
				level: level,
				code: code,
				description: description
			}
		};
		this.sendInvokeMessage(sid, opt);
	}

	sendRtmpSampleAccess(sid) {
		let opt = {
			cmd: '|RtmpSampleAccess',
			bool1: false,
			bool2: false
		};
		this.sendDataMessage(opt, sid);
	}

	respondConnect(tid) {
		let opt = {
			cmd: '_result',
			transId: tid,
			cmdObj: {
				fmsVer: 'FMS/3,0,1,123',
				capabilities: 31
			},
			info: {
				level: 'status',
				code: 'NetConnection.Connect.Success',
				description: 'Connection succeeded.',
				objectEncoding: this.objectEncoding
			}
		};
		this.sendInvokeMessage(0, opt);
	}

	respondCreateStream(tid) {
		this.streams++;
		let opt = {
			cmd: '_result',
			transId: tid,
			cmdObj: null,
			info: this.streams
		};
		this.sendInvokeMessage(0, opt);
	}

	respondPublish() {
		this.sendStatusMessage(this.streamId, 'status', 'NetStream.Publish.Start', `/${this.streamApp}/${this.streamName} is now published.`);
	}

	respondPlay() {
		this.sendStreamStatus(STREAM_BEGIN, this.streamId);
		this.sendStatusMessage(this.streamId, 'status', 'NetStream.Play.Reset', 'Playing and resetting stream.');
		this.sendStatusMessage(this.streamId, 'status', 'NetStream.Play.Start', 'Started playing stream.');
		this.sendRtmpSampleAccess();
	}
}

class RtmpConnection extends Connection {
	/** @param {Buffer} chunks */
	onData(chunks) {
		LOGGER.debug(`[RTMP] Received data: ${chunks.length} bytes`);
		const err = this.incoming.parserData(chunks); // Parse Client RTMP data
		if (err != null) {
			LOGGER.fatal(`[RTMP] Error parsing client data: ${err}`);
			this.clientSocket.end();
			return;
		}

		// const my_codec_type = this.parsePacketType(chunks);
		// LOGGER.debug(`[CODEC/ME] ${my_codec_type}`);

		/** @type {CodecType} */
		const codec_type = this.incoming.parserPacket.header.type;
		LOGGER.debug(`[RTMP] Codec Type: ${codec_type}`);
		const flags = parsePacketFlag(codec_type, this.incoming.parserPacket.payload);
		LOGGER.debug(`[RTMP] Flags/Me: ${flags}`);
		if (codec_type != CodecType.AUDIO && codec_type != CodecType.VIDEO) {
			LOGGER.debug(`[RTMP] Client Packet received: Codec: ${codec_type}, Flags: ${flags}`);
		}
		this.buffer.pushToBuffer(chunks, codec_type, flags);
		this.buffer.handleMemoryManagement(this.clientSocket);

		// this.remoteSocket.write(chunks);
	}

	initializeClient() {
		super.initializeClient();

		this.incoming = new Rtmp();
		this.incoming.onConnectCallback = () => {
			LOGGER.info(`[RTMP] Client connected`);
		};
		this.incoming.onPushCallback = () => {
			LOGGER.info(`[RTMP] Client pushing stream`);
		};
		this.incoming.onPlayCallback = () => {
			LOGGER.info(`[RTMP] Client playing stream`);
		};
	}
}

class RelayServer {
	constructor() {
		this.server = net.createServer({ pauseOnConnect: false });
		/** @type {Set<net.Socket>} */
		this.clients = new Set();
		this.server.on('connection', this.handleClient.bind(this));

		config.server = this;
		config.serverRunning = false;
	}

	/** @param {net.Socket} clientSocket */
	handleClient(clientSocket) {
		this.clients.add(clientSocket);
		clientSocket.on('close', () => this.clients.delete(clientSocket));

		const client = new RtmpConnection(clientSocket);
		client.run();
	}

	run() {
		if (this.server.listening) {
			LOGGER.warn('Relay server is already running');
			return;
		}
		this.server.listen(config.LOCAL_PORT, () => {
			config.serverRunning = true;
			LOGGER.info(`DelayRelay proxy listening on port ${config.LOCAL_PORT}`);
			LOGGER.info(`Forwarding to Remote with ${config.STREAM_DELAY_MS / 1000}s delay.`);
		});
	}

	close(callback) {
		if (!this.server.listening) {
			LOGGER.warn('Relay server is not running');
			if (callback) callback();
			return;
		}
		this.server.close(() => {
			config.serverRunning = false;
			LOGGER.info('Relay server closed');
			if (callback) callback();
		});

		// Gracefully close all client sockets
		for (const clientSocket of this.clients) {
			clientSocket.end();
			// If the socket doesn't close gracefully in 5s, force destroy
			const destroyTimeout = setTimeout(() => {
				if (!clientSocket.destroyed) clientSocket.destroy();
			}, 5000);
			clientSocket.once('close', () => clearTimeout(destroyTimeout));
		}
	}
}

const apiServer = new ApiServer();
apiServer.run();

const relayServer = new RelayServer();
apiServer.relayServer = relayServer;
