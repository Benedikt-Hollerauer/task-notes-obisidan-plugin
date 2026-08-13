import { describe, it, expect } from 'vitest';
import { createSerialQueue } from '../src/core/serial-queue';

const deferred = <T>() => {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

describe('createSerialQueue', () => {
	it('does not start the next unit until the previous one settles', async () => {
		const queue = createSerialQueue();
		const gate = deferred<void>();
		const order: string[] = [];

		const first = queue(async () => {
			order.push('a:start');
			await gate.promise;
			order.push('a:end');
		});
		const second = queue(async () => {
			order.push('b:start');
		});

		// B must not have started while A is parked.
		await Promise.resolve();
		expect(order).toEqual(['a:start']);

		gate.resolve();
		await Promise.all([first, second]);
		expect(order).toEqual(['a:start', 'a:end', 'b:start']);
	});

	it('a rejection settles only its own caller, and the queue keeps running', async () => {
		const queue = createSerialQueue();
		const failed = queue(async () => {
			throw new Error('boom');
		});
		const after = queue(async () => 'still here');

		await expect(failed).rejects.toThrow('boom');
		await expect(after).resolves.toBe('still here');
	});

	it('delivers results in call order', async () => {
		const queue = createSerialQueue();
		const results = await Promise.all([
			queue(async () => 1),
			queue(async () => 2),
			queue(async () => 3),
		]);
		expect(results).toEqual([1, 2, 3]);
	});
});
