export class Config {
	constructor() {
		this.TESTING = false; // Set to true for local testing

		this.LOCAL_PORT = 8888; // Local port for the proxy server
		this.server = null; // Will hold the server instance
		this.serverRunning = false; // Track if the relay server is running
		this.clientConnected = false; // Track If the client is connected to the remote server
		this.STREAM_DELAY_MS = 30_000; // 30 seconds delay
		/**@type {"REALTIME" | "REWIND" | "DELAY" | "FORWARD"} */
		this.STATE = 'REALTIME'; // Initial state

		this.REMOTE_RTMP_URL = this.TESTING ? 'localhost' : 'live.twitch.tv';
		this.REMOTE_RTMP_PORT = this.TESTING ? 9999 : 1935;
		this.LATENCY_INTERVAL = 5; // Check every 10ms for low latency
		this.MAX_BUFFER_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB max buffer size
		this.MAX_BUFFER_CHUNKS = this.MAX_BUFFER_BYTES / 6000; // Max number of chunks in buffer
	}

	toString() {
		return JSON.stringify({
			TESTING: this.TESTING,
			LOCAL_PORT: this.LOCAL_PORT,
			serverRunning: this.serverRunning,
			STREAM_DELAY_MS: this.STREAM_DELAY_MS,
			STATE: this.STATE,
			REMOTE_RTMP_URL: this.REMOTE_RTMP_URL,
			REMOTE_RTMP_PORT: this.REMOTE_RTMP_PORT,
			LATENCY_INTERVAL: this.LATENCY_INTERVAL,
			MAX_BUFFER_BYTES: this.MAX_BUFFER_BYTES,
			MAX_BUFFER_CHUNKS: this.MAX_BUFFER_CHUNKS
		});
	}
}

export const config = new Config();
