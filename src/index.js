import { ApiServer } from './api/apiServer.js';
import config from './config.js';
import { NMSConnection } from './connections/nmsConnection.js';
import { RtmpConnection } from './connections/rtmpConnection.js';
import { SimpleConnection } from './connections/simpleConnection.js';
import { RelayServer } from './relayServer.js';

function simple_ConnectionHandler(clientSocket) {
	return new SimpleConnection(clientSocket);
}

function nms_ConnectionHandler(clientSocket) {
	return new NMSConnection(clientSocket);
}

function rtmp_ConnectionHandler(clientSocket) {
	return new RtmpConnection(clientSocket);
}

const relayServer = new RelayServer(rtmp_ConnectionHandler);
config.server = relayServer;
config.serverRunning = false;

const apiServer = new ApiServer();
apiServer.run();
