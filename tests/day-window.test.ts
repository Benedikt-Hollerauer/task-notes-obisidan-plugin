import { describe, it, expect } from 'vitest';
import {
	dayWindow,
	configuredWindow,
	windowHours,
	fitBlockInWindow,
} from '../src/core/day-window';

const FULL = { visibleStartHour: 0, visibleEndHour: 24 };
const WORK = { visibleStartHour: 7, visibleEndHour: 22 };

describe('the configured window', () => {
	it('is the whole day by default, which is what the grid always did', () => {
		expect(configuredWindow(FULL)).toEqual({ startMin: 0, endMin: 1440 });
	});

	it('narrows to the hours you set', () => {
		expect(configuredWindow(WORK)).toEqual({ startMin: 420, endMin: 1320 });
	});

	it('falls back to the whole day rather than showing nothing', () => {
		// An inverted or degenerate window would otherwise render an empty grid,
		// which reads as a broken plugin.
		expect(configuredWindow({ visibleStartHour: 20, visibleEndHour: 8 })).toEqual({ startMin: 0, endMin: 1440 });
		expect(configuredWindow({ visibleStartHour: 9, visibleEndHour: 9 })).toEqual({ startMin: 0, endMin: 1440 });
	});

	it('clamps nonsense instead of trusting it', () => {
		expect(configuredWindow({ visibleStartHour: -5, visibleEndHour: 99 })).toEqual({ startMin: 0, endMin: 1440 });
		expect(configuredWindow({ visibleStartHour: NaN, visibleEndHour: 24 })).toEqual({ startMin: 0, endMin: 1440 });
	});
});

describe('widening — nothing you scheduled can be undrawable', () => {
	it('keeps the window when everything fits inside it', () => {
		const win = dayWindow([{ startMin: 9 * 60, endMin: 10 * 60 }], WORK);
		expect(win).toEqual({ startMin: 420, endMin: 1320 });
	});

	it('THE RULE: stretches down to an early block, snapped to the hour', () => {
		// The real note has a 04:00 row. With a 07:00–22:00 window it must still
		// appear, or the plugin would be hiding something the user wrote.
		const win = dayWindow([{ startMin: 4 * 60 + 15, endMin: 5 * 60 }], WORK);
		expect(win).toEqual({ startMin: 240, endMin: 1320 });
	});

	it('stretches up to a late block, snapped to the hour', () => {
		const win = dayWindow([{ startMin: 23 * 60, endMin: 1440 }], WORK);
		expect(win).toEqual({ startMin: 420, endMin: 1440 });
	});

	it('stretches both ways at once, and never past the day', () => {
		const win = dayWindow(
			[
				{ startMin: 30, endMin: 90 },
				{ startMin: 23 * 60 + 30, endMin: 1440 },
			],
			WORK,
		);
		expect(win).toEqual({ startMin: 0, endMin: 1440 });
	});

	it('is unaffected by an empty day', () => {
		expect(dayWindow([], WORK)).toEqual(configuredWindow(WORK));
	});

	it('always draws at least one hour', () => {
		const win = dayWindow([], { visibleStartHour: 23, visibleEndHour: 24 });
		expect(win.endMin - win.startMin).toBeGreaterThanOrEqual(60);
	});
});

describe('the ruler', () => {
	it('labels every hour of the window, starting at its first', () => {
		expect(windowHours({ startMin: 420, endMin: 600 })).toEqual([7, 8, 9]);
		expect(windowHours({ startMin: 0, endMin: 1440 })).toHaveLength(24);
	});

	it('rounds a part-hour window up so the last row is labelled', () => {
		expect(windowHours({ startMin: 420, endMin: 455 })).toEqual([7]);
	});
});

describe('minutes ↔ pixels through the window', () => {
	const pxPerMinute = 1;
	const yOf = (win: { startMin: number }, minutes: number) => (minutes - win.startMin) * pxPerMinute;
	const minutesOf = (win: { startMin: number }, y: number) => win.startMin + y / pxPerMinute;

	it('round-trips at both edges and in the middle', () => {
		const win = dayWindow([], WORK);
		for (const m of [win.startMin, win.startMin + 1, 12 * 60, win.endMin - 1, win.endMin]) {
			expect(minutesOf(win, yOf(win, m))).toBe(m);
		}
	});

	it('puts the window start at pixel 0', () => {
		const win = dayWindow([], WORK);
		expect(yOf(win, 7 * 60)).toBe(0);
		expect(yOf(win, 8 * 60)).toBe(60);
	});
});

describe('fitBlockInWindow — a dropped block keeps its length', () => {
	const FULL_WIN = { startMin: 0, endMin: 1440 };
	const WORK_WIN = { startMin: 420, endMin: 1320 };

	it('THE BUG: an hour dropped at 23:50 becomes 23:00–24:00, not fifteen minutes', () => {
		// Clamping only the end wrote `23:45 - 24:00` — a 15-minute event the user
		// never asked for, and the 📅 file was then renamed to match.
		expect(fitBlockInWindow(FULL_WIN, 23 * 60 + 50, 60)).toEqual({ start: 1380, end: 1440 });
	});

	it('slides up at the end of a narrowed window too', () => {
		expect(fitBlockInWindow(WORK_WIN, 21 * 60 + 55, 60)).toEqual({ start: 1260, end: 1320 });
	});

	it('leaves an ordinary drop exactly where it was dropped', () => {
		expect(fitBlockInWindow(WORK_WIN, 9 * 60, 60)).toEqual({ start: 540, end: 600 });
	});

	it('pushes a drop above the window down to its start', () => {
		expect(fitBlockInWindow(WORK_WIN, 5 * 60, 60)).toEqual({ start: 420, end: 480 });
	});

	it('only shortens a block that is longer than the whole window', () => {
		const win = { startMin: 540, endMin: 600 };
		expect(fitBlockInWindow(win, 540, 240)).toEqual({ start: 540, end: 600 });
	});

	it('never produces a zero-length block', () => {
		expect(fitBlockInWindow(FULL_WIN, 600, 0).end).toBeGreaterThan(600);
		expect(fitBlockInWindow(FULL_WIN, 600, -30).end).toBeGreaterThan(600);
	});
});
