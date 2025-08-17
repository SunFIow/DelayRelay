// Small helper: next power of two >= n
function nextPowerOfTwo(n) {
	n = Math.max(1, n >>> 0);
	let p = 1;
	while (p < n) p <<= 1;
	return p;
}

/**
 * Simple RingBuffer<T> (circular buffer) implementation optimized for push/shift
 * @template T
 */
export default class RingBuffer {
	/**
	 * @param {number} capacity - initial slot capacity
	 */
	constructor(capacity = 32) {
		this._cap = Math.max(32, nextPowerOfTwo(capacity));
		this._buf = new Array(this._cap);
		this._head = 0;
		this._len = 0;

		this.ensurePowerOfTwo();
	}

	/** sanity check: capacity must be power of two */
	ensurePowerOfTwo() {
		if (this._cap & (this._cap - 1)) throw new Error('RingBuffer: capacity must be a power of two: ' + this._cap);
	}

	/** Return current buffer length */
	get length() {
		return this._len;
	}

	/** Return current buffer capacity */
	get capacity() {
		return this._cap;
	}

	/** Return the first item in the buffer without removing it.
	 * @returns {T}
	 */
	peek() {
		return this.get(0);
	}

	/** Get an item at a specific index.
	 * @param {number} index - The index to retrieve.
	 * @returns {T}
	 */
	get(index) {
		if (index < 0 || index >= this._len) return undefined;
		return this._buf[(this._head + index) & (this._cap - 1)];
	}

	/** Find the index of an item in the buffer. Otherwise returns -1.
	 * @param {(value: T, index: number, obj: T[]) => unknown} predicate
	 * - The function to test each element.
	 * @param {*} [thisArg]
	 * - The value to use as `this` when executing `predicate`.
	 * @returns {number}
	 */
	findIndex(predicate, thisArg = undefined) {
		for (let i = 0; i < this._len; i++) {
			if (predicate.call(thisArg, this.get(i), i, this._buf)) return i;
		}
		return -1;
	}

	/** Add an item to the end of the buffer. */
	push(item) {
		if (this._len === this._cap) this._grow();
		const idx = (this._head + this._len) & (this._cap - 1);
		this._buf[idx] = item;
		this._len++;
	}

	/** Remove and return the last item from the buffer.
	 * @returns {T}
	 */
	pop() {
		if (this._len === 0) return undefined;
		const idx = (this._head + this._len - 1) & (this._cap - 1);
		const item = this._buf[idx];
		this._buf[idx] = undefined; // allow GC
		this._len--;
		return item;
	}

	/** Insert an item at the front of the buffer. */
	unshift(item) {
		if (this._len === this._cap) this._grow();
		this._head = (this._head - 1) & (this._cap - 1);
		this._buf[this._head] = item;
		this._len++;
	}

	/** Remove and return the first item from the buffer.
	 * @returns {T}
	 */
	shift() {
		if (this._len === 0) return undefined;
		const item = this._buf[this._head];
		this._buf[this._head] = undefined; // allow GC
		this._head = (this._head + 1) & (this._cap - 1);
		this._len--;
		return item;
	}

	/** Clear the buffer. */
	clear() {
		this._buf.fill(undefined);
		this._head = 0;
		this._len = 0;
	}

	/** Reduce the buffer to a single value.
	 * @param {(previousValue: any, currentValue: T, currentIndex: number, array: T[]) => any} callbackFn
	 * - The function to execute on each element.
	 * @param initialValue
	 * - The initial value to use for the accumulator.
	 * @returns {any}
	 */
	reduce(callbackFn, initialValue) {
		let accumulator = initialValue;
		for (let i = 0; i < this._len; i++) {
			accumulator = callbackFn(accumulator, this.get(i), i, this._buf);
		}
		return accumulator;
	}

	/** Convert the buffer to an array.
	 * @returns {T[]}
	 */
	toArray() {
		const out = new Array(this._len);
		for (let i = 0; i < this._len; i++) out[i] = this.get(i);
		return out;
	}

	_grow() {
		const newCap = this._cap * 2;
		const newBuf = new Array(newCap);
		for (let i = 0; i < this._len; i++) newBuf[i] = this.get(i);
		this._buf = newBuf;
		this._cap = newCap;
		this._head = 0;

		this.ensurePowerOfTwo();
	}
}
