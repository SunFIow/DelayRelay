// @ts-check
//
//  Created by Chen Mingliang on 24/11/28.
//  illuspas@msn.com
//  Copyright (c) 2024 NodeMedia. All rights reserved.
//

const logger = require('./core/logger.js');
const Context = require('./core/context.js');
const BaseSession = require('./session/base_session.js');
const NodeHttpServer = require('./server/http_server.js');
const NodeRtmpServer = require('./server/rtmp_server.js');
const NodeRecordServer = require('./server/record_server.js');
const NodeNotifyServer = require('./server/notify_server.js');

class NodeMediaServer {
	constructor(config) {
		logger.level = 'debug';
		logger.info(`Node-Media-Server v4.0.18`);
		logger.info(`Homepage: https://github.com/illuspas/Node-Media-Server`);
		logger.info(`License: Apache-2.0`);
		logger.info(`Author: Chen Mingliang`);

		Context.config = config;
		this.httpServer = new NodeHttpServer(config);
		this.rtmpServer = new NodeRtmpServer(config);
		this.recordServer = new NodeRecordServer(config);
		this.notifyServer = new NodeNotifyServer(config);
	}

	/**
	 *
	 * @param {string} eventName
	 * @param {(session:BaseSession)=>void} listener
	 */
	on(eventName, listener) {
		Context.eventEmitter.on(eventName, listener);
	}

	run() {
		this.httpServer.run();
		this.rtmpServer.run();
		this.recordServer.run();
		this.notifyServer.run();
	}
}

module.exports = NodeMediaServer;
