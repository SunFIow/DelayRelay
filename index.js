import { StreamBuffer } from './streamBuffer.js';
import { LOGGER } from './logger.js';
import { ApiServer } from './apiServer.js';
import Rtmp from 'node-media-server/src/protocol/rtmp.js';
import { createServer, connect } from 'net';
import AVPacket from 'node-media-server/src/core/avpacket.js';

// Configuration
let LOCAL_PORT = 8888; // RTMP default port
let STREAM_DELAY_MS = 30_000; // 30 seconds delay
/**@type {"REALTIME" | "BUFFERING" | "DELAY" | "FORWARDING"} */
let STATE = 'REALTIME'; // Whether to apply the delay

// let REMOTE_RTMP_URL = 'live.twitch.tv'; // Twitch RTMP URL
// let REMOTE_RTMP_PORT = 1935; // Twitch RTMP port
let REMOTE_RTMP_URL = 'localhost'; // Dummy RTMP server for testing
let REMOTE_RTMP_PORT = 9999; // Dummy RTMP port for testing
// http://localhost:8081/app/live_157072648_HXdnAA0L7kzXUcsU8OOlIOB9rsQxqE.flv
let LATENCY_INTERVAL = 10; // Check every 10ms for low latency
let MAX_BUFFER_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB max buffer size
let MAX_BUFFER_CHUNKS = MAX_BUFFER_BYTES / 6000; // Max number of chunks in buffer

// Simple HTTP API for dynamic delay adjustment
const HTTP_API_PORT = 8080; // Port for the HTTP API

const LOG_EVERY = 100; // Log every 100 chunks for performance

// Extracted HTTP API server (handlers are now in apiServer.js)

new ApiServer({
	port: HTTP_API_PORT,
	getConfig: () => ({
		LOCAL_PORT,
		STREAM_DELAY_MS,
		STATE,
		REMOTE_RTMP_URL,
		REMOTE_RTMP_PORT,
		LATENCY_INTERVAL,
		MAX_BUFFER_CHUNKS,
		MAX_BUFFER_BYTES
	}),
	setConfig: (key, value) => {
		if (key === 'LOCAL_PORT') LOCAL_PORT = value;
		if (key === 'STREAM_DELAY_MS') STREAM_DELAY_MS = value;
		if (key === 'STATE') STATE = value;
		if (key === 'REMOTE_RTMP_URL') REMOTE_RTMP_URL = value;
		if (key === 'REMOTE_RTMP_PORT') REMOTE_RTMP_PORT = value;
		if (key === 'LATENCY_INTERVAL') LATENCY_INTERVAL = value;
		if (key === 'MAX_BUFFER_CHUNKS') MAX_BUFFER_CHUNKS = value;
		if (key === 'MAX_BUFFER_BYTES') MAX_BUFFER_BYTES = value;
	}
});

const server = createServer(clientSocket => {
	clientSocket.setNoDelay(true);

	// Connect to Twitch immediately
	const twitchSocket = connect(REMOTE_RTMP_PORT, REMOTE_RTMP_URL, () => {
		LOGGER.info(`[Connect] Connected to Twitch for OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		twitchSocket.pipe(clientSocket);
	});
	twitchSocket.setNoDelay(true);

	twitchSocket.on('error', err => {
		LOGGER.error(`Twitch socket error(${err}): \nName: ${err.name}\nMessage: ${err.message}\nStack: ${err.stack}\nCause: ${err.cause}`);
		LOGGER.error(`Current state: ${buffer.STATE}`);
		clientSocket.end();
	});
	twitchSocket.on('close', err => {
		if (err) LOGGER.error(`[Disconnect] Twitch socket closed with error: ${err}`);
		else LOGGER.info(`[Disconnect] Twitch socket closed for OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		clientSocket.end();
	});

	let ended = false;

	// Create a buffer instance for this connection
	const buffer = new StreamBuffer({
		streamDelayMs: STREAM_DELAY_MS,
		maxBufferChunks: MAX_BUFFER_CHUNKS,
		maxBufferBytes: MAX_BUFFER_BYTES,
		formatBytes,
		initialState: STATE,
		logEvery: LOG_EVERY
	});

	// Helper: push chunk with timestamp, with memory management
	/**
	 * Push a chunk to the buffer with its timestamp and size.
	 * @param {Buffer} buffer
	 * @param {number} inChunkSize
	 */
	function handleData(bufferData, inChunkSize) {
		while (bufferData.length >= inChunkSize) {
			const completeChunk = bufferData.slice(0, inChunkSize);
			bufferData = bufferData.slice(inChunkSize);
			buffer.pushToBuffer(completeChunk, clientSocket);
		}
		if (bufferData.length > 0) buffer.pushToBuffer(bufferData, clientSocket);
	}

	clientSocket.on('data', chunk => {
		if (ended) return;
		LOGGER.info(`[Data] Received ${chunk.length} bytes from OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		// pushToBuffer(chunk);
	});

	clientSocket.on('close', () => {
		ended = true;
		clearInterval(interval);
		if (twitchSocket) twitchSocket.end();
		LOGGER.info(`[Disconnect] OBS client disconnected: ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
	});

	clientSocket.on('error', err => {
		ended = true;
		clearInterval(interval);
		if (twitchSocket) twitchSocket.destroy();
		LOGGER.error(`OBS client error: ${err.message}`);
	});

	// Periodically flush delayed data to Twitch
	const interval = setInterval(() => {
		if (ended) return;
		const readyChunks = buffer.popReadyChunks();
		for (const { chunk, id } of readyChunks) {
			if (twitchSocket?.writable) {
				LOGGER.info(`[Flush] Sending [${id}] ${chunk.length} bytes to Twitch`);
				twitchSocket.write(chunk);
			}
		}
	}, LATENCY_INTERVAL);

	// RTMP parser (dummy implementation, replace with actual RTMP parsing logic)
	LOGGER.info(`[RTMP] Initializing RTMP server for OBS client`);
	/** @type {Rtmp} */
	const rtmp = new Rtmp();
	// console.log(`[RTMP] RTMP server initialized for OBS client`);

	/**
	 * @param {object} req
	 * @param {string} req.app
	 * @param {string} req.name
	 * @param {string} req.host
	 * @param {object} req.query
	 */
	rtmp.onConnectCallback = req => {
		LOGGER.info(`[RTMP] Client connected: [App/${req.app}] [Name/${req.name}] [Host/${req.host}] [StreamPath/${req.app}/${req.name}] [Query/${JSON.stringify(req.query)}]`);
	};
	rtmp.onPlayCallback = () => {
		LOGGER.info(`[RTMP] Client started playing stream`);
	};
	rtmp.onPushCallback = () => {
		LOGGER.info(`[RTMP] Client started pushing stream`);
	};
	/** @param {Buffer} buffer */
	rtmp.onOutputCallback = buffer => {
		return; // Disable output callback for now
		if (twitchSocket?.writable) {
			// console.log(`[RTMP] Sending output to Twitch: ${buffer.length} bytes`);
			// twitchSocket.write(buffer);
		} else console.warn(`[RTMP] Cannot send output to Twitch, socket not writable`);
	};
	/** @param {AVPacket} packet */
	rtmp.onPacketCallback = packet => {
		LOGGER.info(`[RTMP] Received packet: Codec ID ${packet.codec_id}, Type ${packet.codec_type}, Size ${packet.size}`);
		return; // Disable packet callback for now
		if (twitchSocket?.writable) {
			const rtmpMessage = Rtmp.createMessage(packet);
			// console.log(`[RTMP] Broadcast packet to Twitch: ${rtmpMessage.length} bytes`);
			// twitchSocket.write(rtmpMessage);
		} else console.warn(`[RTMP] Cannot broadcast packet to Twitch, socket not writable`);
		sentPackage = true; // Indicate that a package was sent
	};

	let sentPackage;

	/** @param {Buffer} data */
	clientSocket.on('data', data => {
		if (ended) return;
		LOGGER.info(`[RTMP] Received Client data: ${data.length} bytes`);
		sentPackage = false;
		let err = rtmp.parserData(data);
		LOGGER.info(`[RTMP] Chunk Size: ${rtmp.inChunkSize}/${rtmp.outChunkSize}`);
		handleData(data, rtmp.inChunkSize);
		sentPackage = true;
		if (!sentPackage) {
			if (!twitchSocket?.writable) {
				LOGGER.warn(`[RTMP] Twitch socket not writable, cannot send data`);
				err = new Error('Twitch socket not writable');
			} else {
				sentPackage = true;
				LOGGER.info(`[RTMP] Sending data to Twitch: ${data.length} bytes`);
				twitchSocket.write(data);
			}
		}
		if (err != null) {
			LOGGER.error(`[RTMP] Error parsing data: ${err}`);
			clientSocket.end();
		}
	});
});

server.listen(LOCAL_PORT, () => {
	LOGGER.info(`DelayRelay proxy listening on port ${LOCAL_PORT}`);
	LOGGER.info(`Forwarding to Twitch with ${STREAM_DELAY_MS / 1000}s delay.`);
});

function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
