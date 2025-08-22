import fs from 'fs';

import { LOGGER } from './logger.js';
import { getFilePath } from './utils.js';

const TESTING = false; // Set to true for local testing
export const silentProxy = false; // Enable silent proxy mode
export const dummyRemote = false; // Enable dummy remote server

const CONFIG_PATH = getFilePath('config.json');
const TEST_PATH = getFilePath('config.test.json');

class Config {
	constructor() {
		this.server = null; // Will hold the server instance
		this.serverStatus = 'stopped'; // Track if the relay server is running
		this.clientConnected = false; // Track If the client is connected to the remote server
		this.state = 'REALTIME'; // Initial state
		this.configPath = TESTING ? TEST_PATH : CONFIG_PATH;

		this.loadFromDisk();

		this._API_PORT ??= 8080; // Local port for the API server
		this._LOCAL_PORT ??= 8888; // Local port for the proxy server
		this._STREAM_DELAY_MS ??= 30_000; // 30 seconds delay
		/** @type {"REALTIME" | "REWIND" | "DELAY" | "FORWARD"} */
		this._REMOTE_RTMP_URL ??= TESTING ? 'localhost' : 'live.twitch.tv';
		this._REMOTE_RTMP_PORT ??= TESTING ? 9999 : 1935;
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
			serverStatus: this.serverStatus,
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
export default config;
// const relayTypes = [CodecType.AUDIO, CodecType.VIDEO];
