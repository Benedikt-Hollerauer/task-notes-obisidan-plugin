import { describe, it, expect } from 'vitest';
import {
	nextHourHeight,
	scrollTopAfterZoom,
	HOUR_HEIGHT_MIN,
	HOUR_HEIGHT_MAX,
	HOUR_HEIGHT_STEP,
} from '../src/core/zoom';

describe('nextHourHeight — one step, never out of range', () => {
	it('steps proportionally, so a notch feels the same at either end', () => {
		// A flat pixel step over a 30→800 range is either invisible at the top or
		// violent at the bottom.
		expect(nextHourHeight(60, 1)).toBe(75);
		expect(nextHourHeight(60, -1)).toBe(45);
		expect(nextHourHeight(400, 1)).toBe(500);
		expect(nextHourHeight(400, -1)).toBe(320);
	});

	it('always moves — a step can never round back onto its own value', () => {
		for (let h = HOUR_HEIGHT_MIN; h <= HOUR_HEIGHT_MAX; h += HOUR_HEIGHT_STEP) {
			if (h < HOUR_HEIGHT_MAX) expect(nextHourHeight(h, 1)).toBeGreaterThan(h);
			if (h > HOUR_HEIGHT_MIN) expect(nextHourHeight(h, -1)).toBeLessThan(h);
		}
	});

	it('lands on the slider grid, so the two controls always agree', () => {
		for (const h of [30, 45, 60, 95, 160, 305, 800]) {
			expect(nextHourHeight(h, 1) % HOUR_HEIGHT_STEP).toBe(0);
			expect(nextHourHeight(h, -1) % HOUR_HEIGHT_STEP).toBe(0);
		}
	});

	it('stops at the bounds the settings slider offers', () => {
		expect(nextHourHeight(HOUR_HEIGHT_MIN, -1)).toBe(HOUR_HEIGHT_MIN);
		expect(nextHourHeight(HOUR_HEIGHT_MAX, 1)).toBe(HOUR_HEIGHT_MAX);
		// A value already outside the range is pulled back in, not pushed further.
		expect(nextHourHeight(5000, 1)).toBe(HOUR_HEIGHT_MAX);
		expect(nextHourHeight(5, -1)).toBe(HOUR_HEIGHT_MIN);
	});

	it('crosses the whole range in a sane number of notches', () => {
		let h = HOUR_HEIGHT_MIN;
		let notches = 0;
		while (h < HOUR_HEIGHT_MAX && notches < 100) {
			h = nextHourHeight(h, 1);
			notches++;
		}
		expect(h).toBe(HOUR_HEIGHT_MAX);
		expect(notches).toBeLessThanOrEqual(20);
	});

	it('survives a corrupt setting', () => {
		expect(nextHourHeight(Number.NaN, 1)).toBe(75);
	});
});

describe('scrollTopAfterZoom — the time under the pointer does not move', () => {
	const VIEWPORT = 600;
	/** Content height of a 24h day at a given hour height. */
	const content = (px: number) => 24 * px;

	/** The minute showing at `offset` px down the viewport. */
	const minuteAt = (scrollTop: number, offset: number, hourPx: number) =>
		((scrollTop + offset) / hourPx) * 60;

	it('THE RULE: holds the anchor minute across a zoom in', () => {
		const before = minuteAt(540, 200, 60); // 12:20-ish, 200px down the view
		const after = scrollTopAfterZoom(540, 200, 60, 120, VIEWPORT, content(120));
		expect(minuteAt(after, 200, 120)).toBeCloseTo(before, 6);
	});

	it('holds it across a zoom out too', () => {
		const before = minuteAt(1200, 350, 120);
		const after = scrollTopAfterZoom(1200, 350, 120, 60, VIEWPORT, content(60));
		expect(minuteAt(after, 350, 60)).toBeCloseTo(before, 6);
	});

	it('keeps the top edge still when the anchor IS the top edge', () => {
		// 09:00 at the top of a 60px/h grid is scrollTop 540; at 120px/h it is 1080.
		expect(scrollTopAfterZoom(540, 0, 60, 120, VIEWPORT, content(120))).toBe(1080);
	});

	it('never scrolls past either end', () => {
		expect(scrollTopAfterZoom(0, 0, 60, 30, VIEWPORT, content(30))).toBe(0);
		// Zooming in at the very bottom cannot leave a gap below the content.
		const max = content(160) - VIEWPORT;
		expect(scrollTopAfterZoom(880, 600, 60, 160, VIEWPORT, content(160))).toBeLessThanOrEqual(max);
	});

	it('is a no-op rather than a divide-by-zero on a broken previous height', () => {
		expect(scrollTopAfterZoom(300, 100, 0, 60, VIEWPORT, content(60))).toBe(300);
	});
});

describe('two zoom notches compose into one', () => {
	it('THE RE-ENTRANCY BUG: a fast wheel spin must land where a slow one does', () => {
		// Each notch awaits a render before writing scrollTop. The second used to
		// read the position the FIRST had not written yet, so the two compounded
		// and the grid jumped to a time nobody had scrolled to.
		const VIEWPORT = 600;
		const content = (px: number) => 24 * px;

		const step1 = scrollTopAfterZoom(400, 200, 60, 75, VIEWPORT, content(75));
		const chained = scrollTopAfterZoom(step1, 200, 75, 95, VIEWPORT, content(95));
		const direct = scrollTopAfterZoom(400, 200, 60, 95, VIEWPORT, content(95));

		expect(chained).toBeCloseTo(direct, 6);
	});
});
