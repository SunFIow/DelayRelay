import net from 'net';
import Rtmp from 'node-media-server/src/protocol/rtmp.js';

import { ApiServer } from './apiServer.js';
import { LOGGER } from './logger.js';
import { StreamBuffer } from './streamBuffer.js';

import { config } from './config.js';

const apiServer = new ApiServer();

const server = net.createServer(clientSocket => {
	clientSocket.setNoDelay(true);

	// Connect to Twitch immediately
	const twitchSocket = net.connect(config.REMOTE_RTMP_PORT, config.REMOTE_RTMP_URL, () => {
		LOGGER.info(`[Connect] Connected to Twitch for OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		twitchSocket.pipe(clientSocket);
	});
	twitchSocket.setNoDelay(true);

	twitchSocket.on('error', err => {
		LOGGER.error(`Twitch socket error(${err}): \nName: ${err.name}\nMessage: ${err.message}\nStack: ${err.stack}\nCause: ${err.cause}`);
		LOGGER.error(`Current state: ${config.STATE}`);
		clientSocket.end();
	});
	twitchSocket.on('close', err => {
		if (err) LOGGER.error(`[Disconnect] Twitch socket closed with error: ${err}`);
		else LOGGER.info(`[Disconnect] Twitch socket closed for OBS client ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);
		clientSocket.end();
	});

	let ended = false;

	// Create a buffer instance for this connection
	const buffer = new StreamBuffer();

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
	}, config.LATENCY_INTERVAL);

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
		LOGGER.info(`[RTMP] Client connected: [App/${req.app}] [Name/${req.name}] [Host/${req.host}] [Query/${JSON.stringify(req.query)}]`);
	};
	rtmp.onPlayCallback = () => {
		LOGGER.info(`[RTMP] Client started playing stream`);
	};
	rtmp.onPushCallback = () => {
		LOGGER.info(`[RTMP] Client started pushing stream`);
	};

	/** @param {Buffer} data */
	clientSocket.on('data', data => {
		if (ended) return;
		LOGGER.info(`[RTMP] Received Client data: ${data.length} bytes`);
		let err = rtmp.parserData(data);
		LOGGER.info(`[RTMP] Chunk Size: ${rtmp.inChunkSize}/${rtmp.outChunkSize}`);
		handleData(data, rtmp.inChunkSize);
		if (err != null) {
			LOGGER.error(`[RTMP] Error parsing data: ${err}`);
			clientSocket.end();
		}
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
});

server.listen(config.LOCAL_PORT, () => {
	LOGGER.info(`DelayRelay proxy listening on port ${config.LOCAL_PORT}`);
	LOGGER.info(`Forwarding to Twitch with ${config.STREAM_DELAY_MS / 1000}s delay.`);
});
