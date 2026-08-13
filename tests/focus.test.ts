import { describe, it, expect } from 'vitest';
import { scrollTopAfterWindowShift } from '../src/ui/views/svelte/timegrid/scroll';
import { initialFocus, nextFocus, shouldMoveAnchor, shouldPageMonth } from '../src/core/focus';
import { scrollTopFor } from '../src/ui/views/svelte/timegrid/scroll';

const WEEK = { from: '2026-07-20', to: '2026-07-26' };

describe('focus publishing', () => {
	it('does not publish the day that is already focused', () => {
		// Loop guard: a view echoing back what it just received changes nothing.
		const cur = initialFocus('2026-07-24');
		expect(nextFocus(cur, '2026-07-24', 'sidebar')).toBeNull();
	});

	it('re-publishes the same day when forced', () => {
		const cur = initialFocus('2026-07-24');
		expect(nextFocus(cur, '2026-07-24', 'command', true)?.seq).toBe(1);
	});

	it('increases the sequence monotonically', () => {
		let focus = initialFocus('2026-07-24');
		focus = nextFocus(focus, '2026-07-25', 'sidebar')!;
		focus = nextFocus(focus, '2026-07-26', 'timeline')!;
		expect(focus.seq).toBe(2);
		expect(focus.key).toBe('2026-07-26');
		expect(focus.source).toBe('timeline');
	});
});

describe('who moves the timeline anchor', () => {
	const focus = (key: string, source: Parameters<typeof nextFocus>[2]) =>
		nextFocus(initialFocus('2026-01-01'), key, source)!;

	it('never yanks the timeline when a note is opened', () => {
		expect(shouldMoveAnchor(focus('2026-11-20', 'file-open'), WEEK)).toBe(false);
	});

	it('never re-applies the timeline’s own navigation', () => {
		expect(shouldMoveAnchor(focus('2026-11-20', 'timeline'), WEEK)).toBe(false);
	});

	it('always moves for an explicit command', () => {
		expect(shouldMoveAnchor(focus('2026-11-20', 'command'), WEEK)).toBe(true);
	});

	it('moves for a sidebar click only when the day is off screen', () => {
		expect(shouldMoveAnchor(focus('2026-07-23', 'sidebar'), WEEK)).toBe(false); // inside the week
		expect(shouldMoveAnchor(focus('2026-07-20', 'sidebar'), WEEK)).toBe(false); // first day
		expect(shouldMoveAnchor(focus('2026-07-26', 'sidebar'), WEEK)).toBe(false); // last day
		expect(shouldMoveAnchor(focus('2026-07-27', 'sidebar'), WEEK)).toBe(true); // next week
		expect(shouldMoveAnchor(focus('2026-05-04', 'sidebar'), WEEK)).toBe(true); // months back
	});
});

describe('when a calendar pages to another month', () => {
	const focus = (key: string, source: Parameters<typeof nextFocus>[2]) =>
		nextFocus(initialFocus('2026-01-01'), key, source)!;

	it('stays put within the visible month', () => {
		expect(shouldPageMonth(focus('2026-07-30', 'sidebar'), '2026-07-01')).toBe(false);
	});

	it('pages when the focus leaves the month', () => {
		expect(shouldPageMonth(focus('2026-08-01', 'sidebar'), '2026-07-15')).toBe(true);
	});

	it('pages for any source — opening a note in another month moves the rail too', () => {
		// The `followActiveNote` parameter this used to take corresponded to no
		// setting, so its "do not follow" branch was unreachable in production.
		expect(shouldPageMonth(focus('2026-08-01', 'file-open'), '2026-07-15')).toBe(true);
		expect(shouldPageMonth(focus('2026-07-02', 'file-open'), '2026-07-15')).toBe(false);
	});
});

describe('scroll target', () => {
	const HOUR = 60;
	const VIEWPORT = 600;
	const CONTENT = HOUR * 24; // 1440

	it('places the time about a third down the viewport', () => {
		expect(scrollTopFor(12 * 60, HOUR, VIEWPORT, CONTENT)).toBe(720 - 200);
	});

	it('clamps at the top', () => {
		expect(scrollTopFor(0, HOUR, VIEWPORT, CONTENT)).toBe(0);
		expect(scrollTopFor(60, HOUR, VIEWPORT, CONTENT)).toBe(0);
	});

	it('clamps at the bottom', () => {
		expect(scrollTopFor(23 * 60 + 59, HOUR, VIEWPORT, CONTENT)).toBe(CONTENT - VIEWPORT);
	});

	it('returns 0 when everything fits', () => {
		expect(scrollTopFor(12 * 60, HOUR, 2000, CONTENT)).toBe(0);
	});
});

describe('scrollTopAfterWindowShift — a rebuild must not move the clock', () => {
	const PPM = 60; // hourHeightPx

	it('THE BUG: the window widening down to 04:00 keeps the same minute on screen', () => {
		// win.startMin 480 → 240 moves every block down 240px; without the
		// correction the viewport silently shows four hours earlier.
		expect(scrollTopAfterWindowShift(0, 480, 240, PPM, 600, 1440)).toBe(240);
	});

	it('is a no-op when the window did not move', () => {
		expect(scrollTopAfterWindowShift(300, 420, 420, PPM, 600, 1440)).toBe(300);
	});

	it('clamps to the top and to the end of the content', () => {
		expect(scrollTopAfterWindowShift(0, 240, 480, PPM, 600, 1440)).toBe(0);
		expect(scrollTopAfterWindowShift(800, 480, 0, PPM, 600, 1000)).toBe(400);
	});

	it('holds the top minute invariant', () => {
		const top = (scrollTop: number, startMin: number) => startMin + (scrollTop / PPM) * 60;
		const before = top(180, 480);
		const after = top(scrollTopAfterWindowShift(180, 480, 300, PPM, 600, 2000), 300);
		expect(after).toBe(before);
	});
});
