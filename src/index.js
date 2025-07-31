import { ApiServer } from './api/apiServer.js';
import { RelayServer } from './relayServer.js';

const apiServer = new ApiServer();
apiServer.run();

const relayServer = new RelayServer();
apiServer.relayServer = relayServer;
relayServer.run();
