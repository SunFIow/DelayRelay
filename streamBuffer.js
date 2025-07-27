// streamBuffer.js
// Encapsulates stream buffering and relay logic for DelayRelay

export default class StreamBuffer {
	/**
	 * @param {object} opts
	 * @param {number} opts.streamDelayMs
	 * @param {number} opts.maxBufferChunks
	 * @param {number} opts.maxBufferBytes
	 * @param {function} opts.logToFile
	 * @param {function} opts.formatBytes
	 * @param {string} opts.initialState
	 * @param {number} opts.logEvery
	 */
	constructor({ streamDelayMs, maxBufferChunks, maxBufferBytes, logToFile, formatBytes, initialState = 'REALTIME', logEvery = 100 }) {
		this.STREAM_DELAY_MS = streamDelayMs;
		this.MAX_BUFFER_CHUNKS = maxBufferChunks;
		this.MAX_BUFFER_BYTES = maxBufferBytes;
		this.STATE = initialState;
		this.LOG_EVERY = logEvery;
		this.logToFile = logToFile;
		this.formatBytes = formatBytes;

		this.timedBuffer = [];
		this.delayBuffer = [];
		this.totalLength = 0;
		this.chunkAddCount = 0;
		this.relayCount = 0;
		this.ID = 0;
		this.paused = false;
	}

	setState(state) {
		this.STATE = state;
	}

	setStreamDelayMs(ms) {
		this.STREAM_DELAY_MS = ms;
	}

	setMaxBufferChunks(chunks) {
		this.MAX_BUFFER_CHUNKS = chunks;
	}

	setMaxBufferBytes(bytes) {
		this.MAX_BUFFER_BYTES = bytes;
	}

	pushToBuffer(chunk, clientSocket) {
		const now = Date.now();
		this.timedBuffer.push({ chunk, time: now, id: this.ID++ });
		this.totalLength += chunk.length;
		this.chunkAddCount++;
		if (this.chunkAddCount % this.LOG_EVERY === 0) {
			this.logToFile('INFO', `[Buffer] Added ${this.chunkAddCount} chunks so far`);
			this.logToFile('INFO', `[Buffer] timedBuffer: ${this.timedBuffer.length} chunks, ${this.formatBytes(this.totalLength)} | delayBuffer: ${this.delayBuffer.length} chunks`);
		}
		// Memory management: pause or drop
		if (this.timedBuffer.length > this.MAX_BUFFER_CHUNKS || this.totalLength > this.MAX_BUFFER_BYTES) {
			if (typeof clientSocket.pause === 'function' && !this.paused) {
				clientSocket.pause();
				this.paused = true;
				if (this.STATE !== 'BUFFERING') {
					this.logToFile('WARN', `[Memory] Buffer limit reached. Pausing OBS input. Buffer: ${this.timedBuffer.length} chunks, ${this.totalLength} bytes`);
				} else {
					this.logToFile('WARN', `[Memory] Buffer limit reached while buffering. Pausing OBS input. Buffer: ${this.timedBuffer.length} chunks, ${this.totalLength} bytes`);
				}
			} else {
				// Drop oldest chunk
				const dropped = this.timedBuffer.shift();
				if (dropped) this.totalLength -= dropped.chunk.length;
				this.logToFile('WARN', `[Memory] Buffer overflow! Dropped oldest chunk. Buffer: ${this.timedBuffer.length} chunks, ${this.totalLength} bytes`);
			}
		} else if (this.paused && this.timedBuffer.length < this.MAX_BUFFER_CHUNKS * 0.8 && this.totalLength < this.MAX_BUFFER_BYTES * 0.8) {
			// Resume if buffer is below 80% of limit
			if (typeof clientSocket.resume === 'function') {
				clientSocket.resume();
				this.paused = false;
				this.logToFile('INFO', `[Memory] Buffer below threshold. Resumed OBS input.`);
			}
		}
	}

	/**
	 * Pop and return all chunks ready to be relayed based on state and delay
	 * @returns {Array<{chunk: Buffer, time: number, id: number}>}
	 */
	popReadyChunks() {
		const ready = [];
		const now = Date.now();
		if (this.STATE === 'FORWARDING') {
			while (this.timedBuffer.length > 0) {
				const buf = this.timedBuffer.shift();
				this.totalLength -= buf.chunk.length;
			}
			this.STATE = 'REALTIME';
		} else if (this.STATE === 'REALTIME') {
			while (this.timedBuffer.length > 0) {
				const buf = this.timedBuffer.shift();
				ready.push(buf);
				this.delayBuffer.push(buf);
				this.totalLength -= buf.chunk.length;
			}
			while (this.delayBuffer.length > 0 && now - this.delayBuffer[0].time > this.STREAM_DELAY_MS) {
				this.delayBuffer.shift();
			}
		} else if (this.STATE === 'DELAY') {
			while (this.timedBuffer.length > 0 && now - this.timedBuffer[0].time > this.STREAM_DELAY_MS) {
				const buf = this.timedBuffer.shift();
				ready.push(buf);
				this.totalLength -= buf.chunk.length;
			}
		} else if (this.STATE === 'BUFFERING') {
			while (this.delayBuffer.length > 0 && now - this.delayBuffer[0].time > this.STREAM_DELAY_MS) {
				const buf = this.delayBuffer.shift();
				ready.push(buf);
			}
			if (this.delayBuffer.length === 0) this.STATE = 'DELAY';
		}
		this.relayCount += ready.length;
		if (this.relayCount % this.LOG_EVERY === 0) {
			this.logToFile('INFO', `[Relay] Relayed ${ready.length}/${this.relayCount} chunk(s) to Twitch (${this.formatBytes(this.totalLength)} left in buffer)`);
			this.logToFile('INFO', `[Buffer] timedBuffer: ${this.timedBuffer.length} chunks, ${this.formatBytes(this.totalLength)} | delayBuffer: ${this.delayBuffer.length} chunks`);
		}
		if (ready.length > 25) {
			this.logToFile('WARN', `[Relay] [WARNING] Sending ${ready.length} chunks to Twitch at once!`);
		}
		return ready;
	}
}
