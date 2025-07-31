import fs from 'fs';
import { LOGGER } from './logger';
const CONFIG_PATH = './config.json';

export class Config {
	constructor() {
		this.TESTING = false; // Set to true for local testing
		this.API_PORT = 8080; // Local port for the API server
		this.server = null; // Will hold the server instance
		this.serverRunning = false; // Track if the relay server is running
		this.clientConnected = false; // Track If the client is connected to the remote server
		this.state = 'REALTIME'; // Initial state

		this._LOCAL_PORT = 8888; // Local port for the proxy server
		this._STREAM_DELAY_MS = 30_000; // 30 seconds delay
		/**@type {"REALTIME" | "REWIND" | "DELAY" | "FORWARD"} */
		this._REMOTE_RTMP_URL = this._TESTING ? 'localhost' : 'live.twitch.tv';
		this._REMOTE_RTMP_PORT = this._TESTING ? 9999 : 1935;
		this._LATENCY_INTERVAL = 5; // Check every 10ms for low latency
		this._MAX_BUFFER_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB max buffer size
		this._MAX_BUFFER_CHUNKS = this._MAX_BUFFER_BYTES / 6000; // Max number of chunks in buffer

		this.loadFromDisk();
		this.saveToDisk();
	}

	loadFromDisk() {
		try {
			if (fs.existsSync(CONFIG_PATH)) {
				const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
				for (const k in data) {
					if (Object.hasOwn(this, `_${k}`)) this[`_${k}`] = data[k];
				}
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

			fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 3), 'utf8');
		} catch (e) {
			LOGGER.error('Failed to save config to disk:', e);
		}
	}

	toString() {
		return JSON.stringify({
			TESTING: this.TESTING,
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

export const config = new Config();
