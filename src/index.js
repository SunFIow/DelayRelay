import { ApiServer } from './api/apiServer.js';
import config from './config.js';
import { MultiConnection } from './connections/multiConnection.js';
import { RtmpConnection } from './connections/rtmpConnection.js';
import { SimpleConnection } from './connections/simpleConnection.js';
import { RelayServer } from './relayServer.js';

function simple_ConnectionHandler(clientSocket) {
	return new SimpleConnection(clientSocket);
}

function rtmp_ConnectionHandler(clientSocket) {
	return new RtmpConnection(clientSocket);
}

function multi_ConnectionHandler(clientSocket) {
	return new MultiConnection(clientSocket);
}

const relayServer = new RelayServer(multi_ConnectionHandler);
config.server = relayServer;

const apiServer = new ApiServer();
apiServer.run();
