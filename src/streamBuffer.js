/*

StreamBuffer class for managing video stream chunks with timing and delay buffers.
There are ChunkData Arrays:
1. `buffer`: 
2. `delayBuffer`: A rolling window of chunks from the last N seconds. (The amount of time we want to delay the stream)


*/

import { LOGGER } from './logger.js';

const LOG_EVERY = 100; // Log every 100 chunks for performance

import config from './config.js';
import { CodecType, PacketFlags } from './parsing.js';

// Simple RingBuffer (circular buffer) implementation optimized for push/shift
class RingBuffer {
	constructor(capacity = 1024) {
		this._cap = Math.max(4, capacity);
		this._buf = new Array(this._cap);
		this._head = 0; // index of first element
		this._len = 0;
	}
	push(item) {
		if (this._len === this._cap) this._grow();
		const idx = (this._head + this._len) % this._cap;
		this._buf[idx] = item;
		this._len++;
	}
	shift() {
		if (this._len === 0) return undefined;
		const item = this._buf[this._head];
		this._buf[this._head] = undefined; // allow GC
		this._head = (this._head + 1) % this._cap;
		this._len--;
		return item;
	}
	get(index) {
		if (index < 0 || index >= this._len) return undefined;
		return this._buf[(this._head + index) % this._cap];
	}
	peek() {
		return this.get(0);
	}
	toArray() {
		const out = new Array(this._len);
		for (let i = 0; i < this._len; i++) out[i] = this.get(i);
		return out;
	}
	_grow() {
		const newCap = this._cap * 2;
		const newBuf = new Array(newCap);
		for (let i = 0; i < this._len; i++) newBuf[i] = this.get(i);
		this._buf = newBuf;
		this._cap = newCap;
		this._head = 0;
	}
	get length() {
		return this._len;
	}
}

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
export class StreamBuffer {
	constructor() {
		this.CURRENT_ID = 0;
		/** @type {ChunkData[]} */
		this.buffer = [];
		this.totalLength = 0;
		/** @type {ChunkData[]} */
		this.delayBuffer = new RingBuffer(2048);
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

		// handleMemoryManagement();
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
		while (this.delayBuffer.length > 0 && now - this.delayBuffer.peek().time > config.STREAM_DELAY_MS) {
			// Remove chunks until we find a key frame or the buffer is empty
			let skipSameKeyFrame = this.delayBuffer.peek().keyFrame;
			while (this.delayBuffer.length > 0 && !skipSameKeyFrame) {
				this.delayBuffer.shift();
				skipSameKeyFrame = this.delayBuffer.peek()?.keyFrame;
			}

			// Remove all chunks associated with the found key frame or the buffer is empty
			let foundNewKeyFrame = false;
			while (this.delayBuffer.length > 0 && !foundNewKeyFrame) {
				const buf = this.delayBuffer.peek();
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
			const chunkData = this.delayBuffer.get(i);
			if (this.buffer.findIndex(b => b.id === chunkData.id) === -1) {
				this.buffer.unshift(chunkData);
				this.totalLength += chunkData.chunk.length;
			}
		}
	}

	handleForwarding() {
		// Only keep chunks associated with the most recent key frame

		let mostRecentKeyFrameStart = -1;
		let mostRecentKeyFrameEnd = -1;
		for (let i = this.buffer.length - 1; i >= 0; i--) {
			const isKeyFrame = this.buffer[i].keyFrame;
			if (!isKeyFrame) {
				if (mostRecentKeyFrameStart === -1) {
					break; // Found the start of the most recent key frame
				}
			} else if (!mostRecentKeyFrameEnd) mostRecentKeyFrameEnd = i;
			else mostRecentKeyFrameStart = i;
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
