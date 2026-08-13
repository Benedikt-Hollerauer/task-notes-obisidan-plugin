// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountManagedRender, type ManagedRenderJob } from '../../src/ui/managed-render';

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe('managed asynchronous rendering', () => {
	let el: HTMLElement;

	beforeEach(() => {
		el = document.createElement('span');
		document.body.appendChild(el);
	});

	afterEach(() => el.remove());

	it('never lets an older completion replace newer text', async () => {
		const old = deferred();
		const newer = deferred();
		const oldDispose = vi.fn();
		const newDispose = vi.fn();
		const makeJob = (text: string, completion: Promise<void>, dispose: () => void): ManagedRenderJob => {
			const holder = document.createElement('div');
			holder.textContent = text;
			return { holder, completion, dispose };
		};

		mountManagedRender(el, () => (el.textContent = 'old fallback'), () => makeJob('old', old.promise, oldDispose), vi.fn());
		const cleanup = mountManagedRender(
			el,
			() => (el.textContent = 'new fallback'),
			() => makeJob('new', newer.promise, newDispose),
			vi.fn(),
		);

		newer.resolve();
		await vi.waitFor(() => expect(el.textContent).toBe('new'));
		old.resolve();
		await vi.waitFor(() => expect(oldDispose).toHaveBeenCalledOnce());
		expect(el.textContent).toBe('new');
		expect(newDispose).not.toHaveBeenCalled();

		cleanup();
		expect(newDispose).toHaveBeenCalledOnce();
	});

	it('keeps the owner alive while its rendered DOM is mounted', async () => {
		const done = deferred();
		const dispose = vi.fn();
		const holder = document.createElement('div');
		holder.textContent = 'rendered';
		const cleanup = mountManagedRender(
			el,
			() => (el.textContent = 'fallback'),
			() => ({ holder, completion: done.promise, dispose }),
			vi.fn(),
		);

		done.resolve();
		await vi.waitFor(() => expect(el.textContent).toBe('rendered'));
		expect(dispose).not.toHaveBeenCalled();
		cleanup();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it('does not erase the fallback when a renderer returns an empty tree', async () => {
		const holder = document.createElement('div');
		const dispose = vi.fn();
		mountManagedRender(
			el,
			() => (el.textContent = 'still readable'),
			() => ({ holder, completion: Promise.resolve(), dispose }),
			vi.fn(),
		);
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
		expect(el.textContent).toBe('still readable');
	});
});
