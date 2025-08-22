/**
 * Modified from Node-Media-Server (https://github.com/illuspas/Node-Media-Server)
 * Original author: Chen Mingliang
 * Original license: Apache-2.0
 * Changes by: SunFIow — 2025-08-23 — removed dependency on full repo
 */

export class RtmpPacket {
	constructor(fmt = 0, cid = 0) {
		this.header = {
			fmt: fmt,
			cid: cid,
			timestamp: 0,
			length: 0,
			type: 0,
			stream_id: 0
		};
		this.clock = 0;
		this.payload = Buffer.alloc(0);
		this.capacity = 0;
		this.bytes = 0;
	}
}
