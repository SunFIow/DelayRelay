class Config {
	constructor() {
		this.TESTING = false; // Set to true for local testing

		this.LOCAL_PORT = 8888; // Local port for the proxy server
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
		return JSON.stringify(this);
	}
}

export const config = new Config();
