import net from 'net';
import { LOGGER } from '../logger.js';

/**
 * Restreamer
 * Contract:
 * - constructor(providers: Array<{name:string,host:string,port:number}>)
 * - connectAll(): connects to all providers and maintains reconnect logic
 * - write(buffer: Buffer): writes the buffer to all connected providers
 * - addProvider(provider): add and connect a new provider at runtime
 * - removeProvider(name): remove provider and close its socket
 * - closeAll(): close all sockets and stop reconnect attempts
 *
 * Notes: This class focuses on TCP-level relay for RTMP (no RTMP handshakes).
 * Integration with RTMP parsing/handshake should be done at a higher layer
 * (for example, by performing the RTMP handshake once per downstream endpoint
 * before starting to forward chunks).
 */
export class Restreamer {
	constructor(providers = []) {
		/** @type {Array<{name:string,host:string,port:number}>} */
		this.providers = [];
		/** name -> socket */
		this.sockets = new Map();
		/** name -> reconnect timer id */
		this.reconnectTimers = new Map();
		this.defaultReconnectMs = 2000;
		this.maxReconnectMs = 60_000;
		providers.forEach(p => this.addProvider(p));
	}

	normalizeProvider(p) {
		return { name: p.name || `${p.host}:${p.port}`, host: p.host, port: p.port };
	}

	addProvider(provider) {
		const p = this.normalizeProvider(provider);
		const exists = this.providers.find(x => x.name === p.name);
		if (exists) return;
		this.providers.push(p);
		this.connectProvider(p);
	}

	removeProvider(name) {
		const idx = this.providers.findIndex(p => p.name === name);
		if (idx === -1) return;
		const p = this.providers.splice(idx, 1)[0];
		const sock = this.sockets.get(p.name);
		if (sock) {
			try {
				sock.end();
				sock.destroy();
			} catch (e) {
				/* ignore */
			}
			this.sockets.delete(p.name);
		}
		const t = this.reconnectTimers.get(p.name);
		if (t) clearTimeout(t);
		this.reconnectTimers.delete(p.name);
	}

	connectAll() {
		for (const p of this.providers) this.connectProvider(p);
	}

	connectProvider(provider) {
		const name = provider.name;
		// Prevent multiple parallel attempts
		if (this.sockets.has(name) && !this.sockets.get(name).destroyed) return;

		const socket = new net.Socket();
		socket.setNoDelay(true);
		socket.once('connect', () => {
			LOGGER.info(`[Restreamer] Connected to ${name} (${provider.host}:${provider.port})`);
			// Clear any previous reconnect attempts
			const t = this.reconnectTimers.get(name);
			if (t) {
				clearTimeout(t);
				this.reconnectTimers.delete(name);
			}
		});

		socket.on('error', err => {
			LOGGER.error(`[Restreamer] Socket error for ${name}: ${err?.message || err}`);
		});

		socket.on('close', hadError => {
			LOGGER.warn(`[Restreamer] Connection closed for ${name} (error=${hadError})`);
			// schedule reconnect
			this.sockets.delete(name);
			this.scheduleReconnect(provider, this.defaultReconnectMs);
		});

		// store socket reference immediately so writes can check presence
		this.sockets.set(name, socket);
		// Start connect
		try {
			socket.connect(provider.port, provider.host);
		} catch (e) {
			LOGGER.error(`[Restreamer] Failed to start connect to ${name}: ${e}`);
			this.sockets.delete(name);
			this.scheduleReconnect(provider, this.defaultReconnectMs);
		}
	}

	scheduleReconnect(provider, delayMs) {
		const name = provider.name;
		const current = this.reconnectTimers.get(name);
		if (current) return; // already scheduled
		const nextDelay = Math.min(delayMs * 2, this.maxReconnectMs);
		const timer = setTimeout(() => {
			this.reconnectTimers.delete(name);
			this.connectProvider(provider);
			// bump default for next time
			this.defaultReconnectMs = Math.min(nextDelay, this.maxReconnectMs);
		}, delayMs);
		this.reconnectTimers.set(name, timer);
	}

	/** Write a buffer to all currently connected providers. If a provider is not
	 * connected, the write for that provider is skipped and a reconnect is scheduled.
	 * This is a simple fan-out and does not perform per-socket backpressure queueing.
	 */
	write(buffer) {
		for (const p of this.providers) {
			const sock = this.sockets.get(p.name);
			if (sock && sock.writable && !sock.destroyed) {
				try {
					const ok = sock.write(buffer);
					if (!ok) {
						// Node's socket buffer is full; log and continue. A more advanced
						// implementation could pause the upstream or buffer per-socket.
						LOGGER.debug(`[Restreamer] Backpressure on ${p.name}`);
					}
				} catch (e) {
					LOGGER.error(`[Restreamer] Error writing to ${p.name}: ${e}`);
				}
			} else {
				LOGGER.warn(`[Restreamer] ${p.name} not writable, scheduling reconnect`);
				this.scheduleReconnect(p, this.defaultReconnectMs);
			}
		}
	}

	closeAll() {
		for (const [name, sock] of this.sockets.entries()) {
			try {
				sock.end();
				sock.destroy();
			} catch (e) {
				/* ignore */
			}
			this.sockets.delete(name);
		}
		for (const t of this.reconnectTimers.values()) clearTimeout(t);
		this.reconnectTimers.clear();
	}
}

export default Restreamer;
