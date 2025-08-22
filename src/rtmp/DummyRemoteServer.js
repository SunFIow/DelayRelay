import { Socket } from 'net';
import { LOGGER } from '../logger.js';
import { RtmpServer } from './RtmpServer.js';

/**
 * @typedef CommandMessage
 * @property { string | *} cmd
 * @property {*} value
 */
export class DummyRemoteServer extends Socket {
	constructor() {
		super();
		this._pending = true;
		this.impl = new RtmpServer('DummyRemoteServer');
		this.impl.on('packet', packet => {
			LOGGER.trace(`[DUMMY] Packet received ${packet.type}, ${packet.flags}, ${packet.payload.length}`);
		});
	}

	on(event, listener) {
		switch (event) {
			case 'connect':
				this.impl.on('connect', listener);
				break;
			case 'data':
				this.impl.on('response', listener);
				break;
			case 'error':
				break;
			case 'close':
				break;
		}
	}

	connect() {
		// this.pending = false;
		this.impl.emit('connect');
		this.pending;
	}

	write(buffer) {
		this.impl.feed(buffer);
	}

	get pending() {
		return this._pending;
	}

	get destroyed() {
		return false;
	}

	setNoDelay(value) {}
	end() {}
	destroy() {}
}
