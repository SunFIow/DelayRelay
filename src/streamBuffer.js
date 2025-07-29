import { LOGGER } from './logger.js';

const LOG_EVERY = 100; // Log every 100 chunks for performance

import { config } from './config.js';

export class StreamBuffer {
	constructor() {
		this.timedBuffer = [];
		this.delayBuffer = [];
		this.totalLength = 0;

		this.chunkAddCount = 0;
		this.relayCount = 0;
		this.ID = 0;
		this.paused = false;
	}

	formatBytes(bytes) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	handleMemoryManagement(socket) {
		// Memory management: pause or drop
		if (this.timedBuffer.length > config.MAX_BUFFER_CHUNKS || this.totalLength > config.MAX_BUFFER_BYTES) {
			if (typeof socket.pause === 'function' && !this.paused) {
				socket.pause();
				this.paused = true;
				if (config.STATE !== 'BUFFERING') {
					LOGGER.warn(`[Memory] Buffer limit reached. Pausing OBS input. Buffer: ${this.timedBuffer.length} chunks, ${this.totalLength} bytes`);
				} else {
					LOGGER.warn(`[Memory] Buffer limit reached while buffering. Pausing OBS input. Buffer: ${this.timedBuffer.length} chunks, ${this.totalLength} bytes`);
				}
			} else {
				// Drop oldest chunk
				const dropped = this.timedBuffer.shift();
				if (dropped) this.totalLength -= dropped.chunk.length;
				LOGGER.warn(`[Memory] Buffer overflow! Dropped oldest chunk. Buffer: ${this.timedBuffer.length} chunks, ${this.totalLength} bytes`);
			}
		} else if (this.paused && this.timedBuffer.length < config.MAX_BUFFER_CHUNKS * 0.8 && this.totalLength < config.MAX_BUFFER_BYTES * 0.8) {
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
	 */
	pushToBuffer(chunk) {
		const now = Date.now();
		this.timedBuffer.push({ chunk, time: now, id: this.ID++ });
		this.totalLength += chunk.length;
		this.chunkAddCount++;
		if (this.chunkAddCount % LOG_EVERY === 0) {
			LOGGER.info(`[Buffer] Added ${this.chunkAddCount} chunks so far`);
			LOGGER.info(`[Buffer] timedBuffer: ${this.timedBuffer.length} chunks, ${this.formatBytes(this.totalLength)} | delayBuffer: ${this.delayBuffer.length} chunks`);
		}
	}

	/**
	 * Pop and return all chunks ready to be relayed based on state and delay
	 * @returns {Array<{chunk: Buffer, time: number, id: number}>}
	 */
	popReadyChunks() {
		const ready = [];
		const now = Date.now();
		if (config.STATE === 'FORWARDING') {
			while (this.timedBuffer.length > 0) {
				const buf = this.timedBuffer.shift();
				this.totalLength -= buf.chunk.length;
			}
			while (this.delayBuffer.length > 0) {
				this.delayBuffer.shift();
			}
			config.STATE = 'REALTIME';
		} else if (config.STATE === 'REALTIME') {
			while (this.timedBuffer.length > 0) {
				const buf = this.timedBuffer.shift();
				ready.push(buf);
				this.delayBuffer.push(buf);
				this.totalLength -= buf.chunk.length;
			}
			while (this.delayBuffer.length > 0 && now - this.delayBuffer[0].time > config.STREAM_DELAY_MS) {
				this.delayBuffer.shift();
			}
		} else if (config.STATE === 'DELAY') {
			while (this.timedBuffer.length > 0 && now - this.timedBuffer[0].time > config.STREAM_DELAY_MS) {
				const buf = this.timedBuffer.shift();
				ready.push(buf);
				this.totalLength -= buf.chunk.length;
			}
		} else if (config.STATE === 'BUFFERING') {
			while (this.delayBuffer.length > 0 && now - this.delayBuffer[0].time > config.STREAM_DELAY_MS) {
				const buf = this.delayBuffer.shift();
				ready.push(buf);
			}
			if (this.delayBuffer.length === 0) config.STATE = 'DELAY';
		}
		this.relayCount += ready.length;
		if (this.relayCount % LOG_EVERY === 0) {
			LOGGER.info(`[Relay] Relayed ${ready.length}/${this.relayCount} chunks so far`);
		}
		if (ready.length > 25) {
			LOGGER.warn(`[Relay] Sending ${ready.length} chunks to Remote at once!`);
		}
		return ready;
	}
}
