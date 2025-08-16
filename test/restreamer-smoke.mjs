import net from 'net';
import Restreamer from '../src/connections/restreamer.js';

function createDummyServer(port) {
	return new Promise(resolve => {
		const chunks = [];
		const server = net.createServer(socket => {
			socket.on('data', d => chunks.push(d));
		});
		server.listen(port, '127.0.0.1', () => resolve({ server, chunks }));
	});
}

async function run() {
	const p1 = createDummyServer(9991);
	const p2 = createDummyServer(9992);

	const srv1 = await p1;
	const srv2 = await p2;

	// Now create restreamer and point it at the two servers
	const r = new Restreamer([
		{ name: 'one', host: '127.0.0.1', port: 9991 },
		{ name: 'two', host: '127.0.0.1', port: 9992 }
	]);

	// Wait a short time for connections to establish
	await new Promise(res => setTimeout(res, 200));

	const testBuf = Buffer.from('hello-restream');
	r.write(testBuf);

	// Give some time for data to arrive
	await new Promise(res => setTimeout(res, 200));

	const got1 = srv1.chunks.reduce((acc, c) => Buffer.concat([acc, c]), Buffer.alloc(0));
	const got2 = srv2.chunks.reduce((acc, c) => Buffer.concat([acc, c]), Buffer.alloc(0));

	console.log('srv1 got:', got1.toString());
	console.log('srv2 got:', got2.toString());

	if (got1.toString() === testBuf.toString() && got2.toString() === testBuf.toString()) {
		console.log('SMOKE TEST PASSED');
		process.exitCode = 0;
	} else {
		console.error('SMOKE TEST FAILED');
		process.exitCode = 2;
	}

	console.log('Closing connections...');

	r.closeAll();
	srv1.server.close();
	srv2.server.close();

	console.log('All connections closed.');
}

run().catch(e => {
	console.error(e);
	process.exit(3);
});
