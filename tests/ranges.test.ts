import { describe, it, expect } from 'vitest';
import {
	TIMELINE_RANGES,
	PRIMARY_TIMELINE_RANGES,
	SECONDARY_TIMELINE_RANGES,
	RANGE_LABELS,
	ZOOM_OUT,
	isPrimaryRange,
	type TimelineRange,
} from '../src/constants';

describe('the range sequence', () => {
	it('reads ascending, and the menu is its continuation', () => {
		// This is the property the toolbar depends on: buttons then menu, in order.
		expect([...PRIMARY_TIMELINE_RANGES, ...SECONDARY_TIMELINE_RANGES]).toEqual([...TIMELINE_RANGES]);
	});

	it('shows day, 3 days, week and month as buttons', () => {
		expect([...PRIMARY_TIMELINE_RANGES]).toEqual(['day', '3days', 'week', 'month']);
	});

	it('isPrimaryRange agrees with the tuple for every range', () => {
		for (const r of TIMELINE_RANGES) {
			expect(isPrimaryRange(r)).toBe((PRIMARY_TIMELINE_RANGES as readonly string[]).includes(r));
		}
	});

	it('labels every range', () => {
		for (const r of TIMELINE_RANGES) expect(RANGE_LABELS[r]?.length).toBeGreaterThan(0);
	});
});

describe('the zoom-out ladder', () => {
	const indexOf = (r: TimelineRange) => TIMELINE_RANGES.indexOf(r);

	it('always widens, never narrows', () => {
		for (const r of TIMELINE_RANGES) {
			const next = ZOOM_OUT[r];
			if (next) expect(indexOf(next)).toBeGreaterThan(indexOf(r));
		}
	});

	it('terminates from every range, and never cycles', () => {
		for (const start of TIMELINE_RANGES) {
			const seen = new Set<TimelineRange>();
			let at: TimelineRange | null = start;
			while (at) {
				expect(seen.has(at)).toBe(false);
				seen.add(at);
				at = ZOOM_OUT[at];
			}
		}
	});

	it('walks the whole sequence from day, skipping no rung the toolbar shows', () => {
		const walk: TimelineRange[] = [];
		let at: TimelineRange | null = 'day';
		while (at) {
			walk.push(at);
			at = ZOOM_OUT[at];
		}
		expect(walk).toEqual([...TIMELINE_RANGES]);
	});

	it('ends at the widest range', () => {
		expect(ZOOM_OUT.year).toBeNull();
	});
});
