import { StreamBuffer } from '../src/streamBuffer.js';
import { config } from '../src/config.js';

describe('StreamBuffer', () => {
	beforeEach(() => {
		config.STREAM_DELAY_MS = 1000;
		config.state = 'DELAY';
	});

	it('removes all chunks up to the next keyframe when oldest keyframe is expired', () => {
		const buf = new StreamBuffer();
		const now = Date.now();

		// Old keyframe and intermediate chunks, then a new keyframe
		buf.delayBuffer.push({ chunk: Buffer.from('a'), time: now - 2300, id: 1, keyFrame: true }); // expired keyframe
		buf.delayBuffer.push({ chunk: Buffer.from('b'), time: now - 2000, id: 2, keyFrame: false }); // expired intermediate
		buf.delayBuffer.push({ chunk: Buffer.from('c'), time: now - 1700, id: 3, keyFrame: false }); // expired intermediate
		buf.delayBuffer.push({ chunk: Buffer.from('d'), time: now - 1500, id: 4, keyFrame: true }); // expired keyframe
		buf.delayBuffer.push({ chunk: Buffer.from('e'), time: now - 1100, id: 5, keyFrame: false }); // expired intermediate
		buf.delayBuffer.push({ chunk: Buffer.from('f'), time: now - 900, id: 6, keyFrame: false }); // intermediate for expired keyframe
		buf.delayBuffer.push({ chunk: Buffer.from('g'), time: now - 500, id: 7, keyFrame: true }); // valid keyframe
		buf.delayBuffer.push({ chunk: Buffer.from('h'), time: now - 200, id: 8, keyFrame: false }); // valid intermediate

		buf.updateDelayBuffer(now);

		// Only the valid keyframe and later chunks remain
		expect(buf.delayBuffer.length).toBe(2);
		expect(buf.delayBuffer[0].id).toBe(7);
		expect(buf.delayBuffer[0].keyFrame).toBe(true);
		expect(buf.delayBuffer[1].id).toBe(8);
	});

	it('removes all expired chunks if no keyframe remains', () => {
		const buf = new StreamBuffer();
		const now = Date.now();

		buf.delayBuffer.push({ chunk: Buffer.from('a'), time: now - 2000, id: 1, keyFrame: true }); // expired keyframe
		buf.delayBuffer.push({ chunk: Buffer.from('b'), time: now - 1500, id: 2, keyFrame: false }); // expired intermediate
		buf.delayBuffer.push({ chunk: Buffer.from('c'), time: now - 1200, id: 3, keyFrame: false }); // expired intermediate

		buf.updateDelayBuffer(now);

		// Buffer should be empty
		expect(buf.delayBuffer.length).toBe(0);
	});

	it('does not remove chunks if all are within delay window', () => {
		const buf = new StreamBuffer();
		const now = Date.now();

		buf.delayBuffer.push({ chunk: Buffer.from('a'), time: now - 500, id: 1, keyFrame: true });
		buf.delayBuffer.push({ chunk: Buffer.from('b'), time: now - 200, id: 2, keyFrame: false });

		buf.updateDelayBuffer(now);

		expect(buf.delayBuffer.length).toBe(2);
	});
});
