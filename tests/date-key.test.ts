import { describe, it, expect } from 'vitest';
import {
	timelineDays,
	monthGridDays,
	monthsInOverview,
	rangeBounds,
	weekStart,
	addDays,
	isSameMonth,
	dayNoteLabel,
	dayShortLabel,
} from '../src/core/date-key';
import { keyToMoment } from '../src/core/date-key';

describe('date-key ranges', () => {
	it('enumerates day / 3-day / week', () => {
		expect(timelineDays('2026-07-24', 'day', 'monday')).toEqual(['2026-07-24']);
		expect(timelineDays('2026-07-24', '3days', 'monday')).toEqual(['2026-07-24', '2026-07-25', '2026-07-26']);
		const week = timelineDays('2026-07-24', 'week', 'monday'); // Fri 24th → week starts Mon 20th
		expect(week[0]).toBe('2026-07-20');
		expect(week).toHaveLength(7);
		expect(week[6]).toBe('2026-07-26');
	});

	it('week honours sunday start', () => {
		const week = timelineDays('2026-07-24', 'week', 'sunday');
		expect(week[0]).toBe('2026-07-19');
	});

	it('month grid is 42 days covering the month', () => {
		const grid = monthGridDays('2026-07-01', 'monday');
		expect(grid).toHaveLength(42);
		expect(grid.some((d) => d === '2026-07-01')).toBe(true);
		expect(grid.some((d) => d === '2026-07-31')).toBe(true);
	});

	it('overview lists 6 or 12 months', () => {
		expect(monthsInOverview('2026-07-24', 6)).toHaveLength(6);
		const year = monthsInOverview('2026-07-24', 12);
		expect(year).toHaveLength(12);
		expect(year[0]).toBe('2026-01-01');
	});

	it('rangeBounds spans the full visible window', () => {
		const b = rangeBounds('2026-07-24', 'month', 'monday');
		expect(b.from <= '2026-07-01').toBe(true);
		expect(b.to >= '2026-07-31').toBe(true);
	});

	it('addDays and isSameMonth', () => {
		expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
		expect(isSameMonth('2026-07-15', '2026-07-01')).toBe(true);
		expect(isSameMonth('2026-08-01', '2026-07-01')).toBe(false);
	});

	it('weekStart returns the correct weekday', () => {
		const ws = weekStart(keyToMoment('2026-07-24'), 'monday');
		expect(ws.format('YYYY-MM-DD')).toBe('2026-07-20');
		expect(ws.day()).toBe(1); // Monday
	});
});

describe('dayNoteLabel — a header says what its note is CALLED', () => {
	it('THE BUG: a sub-foldered format renders only the basename', () => {
		// `pathFor` joins the format straight into the path, so `/` is legitimate.
		// Rendering it whole made every header read the entire path.
		expect(dayNoteLabel('2026-08-11', 'YYYY/MM-MMMM/YYYY-MM-DD')).toBe('2026-08-11');
		expect(dayNoteLabel('2026-08-11', 'YYYY/MM/DD')).toBe('11');
	});

	it('leaves an ordinary format alone', () => {
		expect(dayNoteLabel('2026-08-11', 'YYYY-MM-DD')).toBe('2026-08-11');
		expect(dayNoteLabel('2026-08-11', 'DD.MM.YYYY')).toBe('11.08.2026');
	});

	it('keeps everything after the last separator, spaces included', () => {
		expect(dayNoteLabel('2026-08-11', 'YYYY/[Daily] YYYY-MM-DD')).toBe('Daily 2026-08-11');
	});

	it('falls back rather than rendering an empty header', () => {
		expect(dayNoteLabel('2026-08-11', '')).toBe('2026-08-11');
	});
});

describe('dayShortLabel — the narrow-column form', () => {
	it('is short enough for a ~44px column', () => {
		for (let d = 1; d <= 28; d++) {
			const key = `2026-08-${`${d}`.padStart(2, '0')}`;
			expect(dayShortLabel(key).length).toBeLessThanOrEqual(6);
		}
	});

	it('still carries the day number, so two columns are never identical', () => {
		expect(dayShortLabel('2026-08-11')).toContain('11');
		expect(dayShortLabel('2026-08-11')).not.toBe(dayShortLabel('2026-08-12'));
	});
});
