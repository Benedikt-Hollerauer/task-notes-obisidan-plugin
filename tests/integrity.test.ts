// Regressions for the "the plugin must not touch my vault by itself" bug class.
import { describe, it, expect } from 'vitest';
import { isDailyNotePath, parentFolder } from '../src/core/daily-path';
import { daySlot, resolveSlot } from '../src/core/event-slot';
import { overlapLayout } from '../src/core/overlap';
import { serializePlannerLine, parsePlannerLine } from '../src/core/planner-line';

const SETTINGS = { dayStartHour: 8, defaultEventDurationMinutes: 60 };

describe('daily-note identity is folder-aware', () => {
	it('accepts the exact configured path', () => {
		expect(isDailyNotePath('Daily/2026-07-24.md', 'Daily/2026-07-24.md')).toBe(true);
	});

	it('accepts a sibling in the same folder (custom formats)', () => {
		expect(isDailyNotePath('Daily/2026-07-24 Fri.md', 'Daily/2026-07-24.md')).toBe(true);
	});

	it('rejects a date-named note filed elsewhere', () => {
		// This is the bug: such a note used to become a "day plan" and could drive
		// automatic renames of the 📅 files it linked.
		expect(isDailyNotePath('Meetings/2026-07-24.md', 'Daily/2026-07-24.md')).toBe(false);
		expect(isDailyNotePath('Archive/Daily/2026-07-24.md', 'Daily/2026-07-24.md')).toBe(false);
	});

	it('handles root-level daily notes', () => {
		expect(isDailyNotePath('2026-07-24.md', '2026-07-24.md')).toBe(true);
		expect(isDailyNotePath('Sub/2026-07-24.md', '2026-07-24.md')).toBe(false);
		expect(parentFolder('2026-07-24.md')).toBe('');
	});
});

describe('midnight-crossing blocks', () => {
	const night = { startMinutes: 23 * 60, endMinutes: 60 }; // 23:00 - 01:00

	it('draws to the day edge instead of collapsing to a sliver', () => {
		const slot = daySlot(night, SETTINGS);
		expect(slot.start).toBe(1380);
		expect(slot.end).toBe(1440);
		expect(slot.crossesMidnight).toBe(true);
	});

	it('treats a same start/end as zero-length, not a wrap', () => {
		const slot = daySlot({ startMinutes: 600, endMinutes: 600 }, SETTINGS);
		expect(slot.crossesMidnight).toBe(false);
		expect(slot.end).toBe(601);
	});

	it('leaves the write-side resolveSlot untouched', () => {
		expect(resolveSlot(night, SETTINGS)).toEqual({ start: 1380, end: 1381 });
	});

	it('clamps an end beyond the day', () => {
		expect(daySlot({ startMinutes: 1400, endMinutes: 1500 }, SETTINGS).end).toBe(1440);
	});
});

describe('block creation never writes an unparseable time', () => {
	it('clamps a late-evening default duration to 23:59', () => {
		// 23:15 + 60 used to produce "24:15", which the parser then folded into the
		// task text — losing the end time and corrupting the title.
		const line = serializePlannerLine({ startMinutes: 1395, endMinutes: 1455, text: 'Foo' });
		expect(line).toBe('- [ ] 23:15 - 23:59 Foo');
		const parsed = parsePlannerLine(line, 0);
		expect(parsed?.startMinutes).toBe(1395);
		expect(parsed?.endMinutes).toBe(1439);
		expect(parsed?.text).toBe('Foo');
	});
});

describe('overlap detection', () => {
	const iv = (id: string, start: number, end: number) => ({ id, start, end });

	it('finds nothing when blocks are disjoint', () => {
		expect(overlapLayout([iv('a', 540, 600), iv('b', 600, 660)]).overlapping.size).toBe(0);
	});

	it('flags both members of a simple overlap', () => {
		expect([...overlapLayout([iv('a', 540, 660), iv('b', 600, 700)]).overlapping].sort()).toEqual(['a', 'b']);
	});

	it('flags a contained block and its container', () => {
		expect([...overlapLayout([iv('a', 540, 720), iv('b', 600, 640)]).overlapping].sort()).toEqual(['a', 'b']);
	});

	it('flags every member of a chained cluster', () => {
		const ids = overlapLayout([iv('a', 540, 620), iv('b', 600, 700), iv('c', 680, 760)]).overlapping;
		expect([...ids].sort()).toEqual(['a', 'b', 'c']);
	});

	it('keeps independent clusters separate', () => {
		const ids = overlapLayout([iv('a', 540, 600), iv('b', 550, 610), iv('lonely', 900, 960)]).overlapping;
		expect(ids.has('lonely')).toBe(false);
		expect(ids.size).toBe(2);
	});
});
