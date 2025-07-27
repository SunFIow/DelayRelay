import { ApiServer } from './apiServer.js';
import { RelayServer } from './relayServer.js';

const apiServer = new ApiServer();
apiServer.run();

const relayServer = new RelayServer();
relayServer.run();
