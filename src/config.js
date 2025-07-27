class Config {
	constructor() {
		this.TESTING = true; // Set to true for local testing

		this.LOCAL_PORT = 8888; // Local port for the proxy server
		this.STREAM_DELAY_MS = 30_000; // 30 seconds delay
		/**@type {"REALTIME" | "BUFFERING" | "DELAY" | "FORWARDING"} */
		this.STATE = 'REALTIME'; // Initial state

		// http://localhost:8081/app/live_157072648_HXdnAA0L7kzXUcsU8OOlIOB9rsQxqE.flv
		this.REMOTE_RTMP_URL = this.TESTING ? 'localhost' : 'live.twitch.tv';
		this.REMOTE_RTMP_PORT = this.TESTING ? 9999 : 1935;
		this.LATENCY_INTERVAL = 10; // Check every 10ms for low latency
		this.MAX_BUFFER_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB max buffer size
		this.MAX_BUFFER_CHUNKS = this.MAX_BUFFER_BYTES / 6000; // Max number of chunks in buffer
	}
}

export const config = new Config();
