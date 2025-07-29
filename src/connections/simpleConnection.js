import { Connection } from './connection.js';

export class SimpleConnection extends Connection {
	onData(data) {
		this.buffer.pushToBuffer(data);
		this.buffer.handleMemoryManagement(this.clientSocket);
	}
}
