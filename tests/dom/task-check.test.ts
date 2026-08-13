// @vitest-environment happy-dom
//
// The first component test in this repo, and it exists for one bug: ticking a
// remote calendar event and then unticking it left the box ticked.
//
// Nothing in the pure layer could catch it. `toggleHidden` is symmetric,
// immutable and well covered; the model flipped correctly every time. The defect
// lived entirely in the DOM: `preventDefault()` on a checkbox runs the legacy
// canceled-activation behaviour, which restores `input.checked` at the END of
// dispatch, while Svelte had already written the new value through a MEMOISED
// setter. Svelte's cache then said "done" and every later flush short-circuited.
//
// happy-dom implements that restore (verified before this file was written), so
// this reproduces the real thing rather than a mock of it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Harness from './TaskCheckHarness.svelte';

describe('TaskCheck — the box must follow the model on every click', () => {
	let host: HTMLElement;
	let app: Record<string, unknown>;
	let toggles: boolean[];

	/** The checkbox the harness rendered. */
	const box = (): HTMLInputElement => {
		const el = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
		if (!el) throw new Error('no checkbox rendered');
		return el;
	};

	/** Click, then let both the microtask flush and the macrotask re-assert run. */
	const clickAndSettle = async (): Promise<void> => {
		box().click();
		flushSync();
		// The fix re-asserts on a macrotask, because the browser's restore happens
		// after the microtask checkpoint Svelte flushes in.
		await new Promise((resolve) => setTimeout(resolve, 1));
		flushSync();
	};

	beforeEach(() => {
		toggles = [];
		host = document.createElement('div');
		document.body.appendChild(host);
		app = mount(Harness, { target: host, props: { onToggle: (n: boolean) => toggles.push(n) } });
	});

	afterEach(() => {
		void unmount(app);
		host.remove();
	});

	it('starts ticked, matching a remote occurrence that is already hidden', () => {
		expect(box().checked).toBe(true);
	});

	it('THE BUG: unticking sticks, and the box agrees with the model', async () => {
		await clickAndSettle();
		expect(toggles, 'the model must have been told to un-hide').toEqual([false]);
		expect(box().checked, 'the box must show what the model says').toBe(false);
	});

	it('and a second click ticks it again rather than repeating the first', async () => {
		// This is what actually went wrong for the user: because the box was stuck
		// ticked, `onToggle(!checked)` kept re-sending "hide", so the mark never
		// left data.json and the event stayed struck through.
		await clickAndSettle();
		await clickAndSettle();
		expect(toggles).toEqual([false, true]);
		expect(box().checked).toBe(true);
	});

	it('survives four clicks without drifting out of step', async () => {
		// Asserted after EVERY click, not just at the end: the broken component
		// happens to land on the right final value while having been wrong in
		// between, so an end-state-only check passes against the bug.
		const expected = [false, true, false, true];
		for (const want of expected) {
			await clickAndSettle();
			expect(box().checked, `after click ${toggles.length}`).toBe(want);
		}
		expect(toggles).toEqual(expected);
	});
});
