import { StreamBuffer as StreamBufferOld } from '../streamBufferOld.js';
import { Connection } from './connection.js';

export class SimpleConnection extends Connection {
	onData(data) {
		if (!(this.buffer instanceof StreamBufferOld)) this.buffer = new StreamBufferOld();
		this.buffer.pushToBuffer(data);
	}
}
