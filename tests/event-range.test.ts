import { describe, it, expect } from 'vitest';
import { eventSpan, eventTouchesDay, eventTouchesRange, eventDayKeys } from '../src/core/event-range';
import { resolveSlot } from '../src/core/event-slot';
import { findPlacementLine } from '../src/core/placement';
import { diffDays, addDays } from '../src/core/date-key';
import type { LocalEvent, RemoteEvent } from '../src/types';

function local(date: string, endDate?: string): LocalEvent {
	return {
		kind: 'local',
		id: `${date}-${endDate ?? ''}`,
		title: 'x',
		date,
		endDate,
		startMinutes: 600,
		endMinutes: 660,
		checked: false,
		linked: true,
	};
}

function localMidnight(day: string): number {
	return new Date(`${day}T00:00:00`).getTime();
}

function remote(startTs: number, endTs: number): RemoteEvent {
	return {
		kind: 'remote',
		id: 'r',
		calendarId: 'c',
		calendarName: 'C',
		title: 'R',
		startTs,
		endTs,
		allDay: false,
		color: '#123456',
	};
}

describe('event-range', () => {
	it('computes the span of local single-day and multi-day events', () => {
		expect(eventSpan(local('2026-07-24'))).toEqual({ from: '2026-07-24', to: '2026-07-24' });
		expect(eventSpan(local('2026-07-24', '2026-07-26'))).toEqual({ from: '2026-07-24', to: '2026-07-26' });
	});

	it('uses local (not UTC) day keys for remote events and treats endTs as exclusive', () => {
		const ev = remote(localMidnight('2026-07-24'), localMidnight('2026-07-25'));
		expect(eventSpan(ev)).toEqual({ from: '2026-07-24', to: '2026-07-24' });
		expect(eventTouchesDay(ev, '2026-07-24')).toBe(true);
		expect(eventTouchesDay(ev, '2026-07-25')).toBe(false);
	});

	it('detects range overlap for events starting before the window', () => {
		const ev = local('2026-07-20', '2026-07-30');
		expect(eventTouchesRange(ev, '2026-07-24', '2026-07-26')).toBe(true);
		expect(eventTouchesRange(local('2026-08-01'), '2026-07-24', '2026-07-26')).toBe(false);
	});

	it('enumerates every covered day, clamped to the window', () => {
		expect(eventDayKeys(local('2026-07-24', '2026-07-26'), '2026-07-01', '2026-07-31')).toEqual([
			'2026-07-24',
			'2026-07-25',
			'2026-07-26',
		]);
		// Clamped to the visible grid, not the event's own span.
		expect(eventDayKeys(local('2026-07-20', '2026-07-30'), '2026-07-24', '2026-07-25')).toEqual([
			'2026-07-24',
			'2026-07-25',
		]);
		expect(eventDayKeys(local('2026-08-01'), '2026-07-01', '2026-07-31')).toEqual([]);
	});

	it('never enumerates unbounded spans from a malformed end date', () => {
		const broken = local('2026-07-24', '9999-12-31');
		const keys = eventDayKeys(broken, '2026-07-01', '2026-07-31');
		expect(keys).toHaveLength(8); // 07-24 .. 07-31
		expect(keys[keys.length - 1]).toBe('2026-07-31');
	});
});

describe('resolveSlot', () => {
	const settings = { dayStartHour: 8, defaultEventDurationMinutes: 60 };

	it('keeps explicit times', () => {
		expect(resolveSlot({ startMinutes: 540, endMinutes: 600 }, settings)).toEqual({ start: 540, end: 600 });
	});

	it('falls back to day start and the default duration', () => {
		expect(resolveSlot({ startMinutes: null, endMinutes: null }, settings)).toEqual({ start: 480, end: 540 });
		expect(resolveSlot({ startMinutes: 600, endMinutes: null }, settings)).toEqual({ start: 600, end: 660 });
	});

	it('guarantees a non-zero duration', () => {
		expect(resolveSlot({ startMinutes: 600, endMinutes: 600 }, settings).end).toBe(601);
	});
});

describe('findPlacementLine', () => {
	const content = ['# Note', '## Day planner', '- [ ] 09:00 A', '- [ ] 10:00 B'].join('\n');

	it('finds the line at the recorded index', () => {
		expect(findPlacementLine(content, { lineNo: 2, raw: '- [ ] 09:00 A' })).toBe(2);
	});

	it('re-finds a line that shifted position', () => {
		expect(findPlacementLine(content, { lineNo: 0, raw: '- [ ] 10:00 B' })).toBe(3);
	});

	it('returns -1 rather than guessing when the raw line is gone', () => {
		expect(findPlacementLine(content, { lineNo: 2, raw: '- [ ] 09:00 GONE' })).toBe(-1);
	});
});

describe('date-key helpers', () => {
	it('computes whole-day differences and shifts', () => {
		expect(diffDays('2026-07-26', '2026-07-24')).toBe(2);
		expect(diffDays('2026-07-24', '2026-07-26')).toBe(-2);
		expect(addDays('2026-07-24', 3)).toBe('2026-07-27');
	});
});
