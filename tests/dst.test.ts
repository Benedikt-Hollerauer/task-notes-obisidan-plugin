// THE BUG: every time in the plugin was an hour wrong on two days a year.
//
// `timeOnDayTs` was `startOf('day').add(minutes, 'minutes')`, and moment's
// `.add(n,'minutes')` is an ABSOLUTE duration — so it computed
// `midnight + n×60000`, which is not a clock reading on a 23- or 25-hour day.
// Two comments claimed moment handled it. Nothing tested it.

import { describe, it, expect } from 'vitest';
import { moment } from '../src/lib/moment';
import { timeOnDayTs, dayStartTs, addDays } from '../src/core/date-key';
import { spanSlot } from '../src/core/event-slot';
import { remindersFor, eventStartTs } from '../src/core/reminders';
import { MINUTES_PER_DAY } from '../src/core/timestamps';
import type { RemoteEvent, LocalEvent } from '../src/types';

/** Europe/Berlin, pinned in vitest.config.ts. */
const FALL_BACK = '2026-10-25'; // 25 hours: 03:00 happens twice
const SPRING_FORWARD = '2026-03-29'; // 23 hours: 02:00–03:00 does not exist
const NORMAL = '2026-08-11';

const HOUR = 3_600_000;
const SLOT = { dayStartHour: 8, defaultEventDurationMinutes: 60 };
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`).getTime();
const clock = (ts: number) => moment(ts).format('HH:mm');

describe('the premise', () => {
	it('THIS SUITE RUNS IN A ZONE WITH DST — without this every test below is vacuous', () => {
		// A UTC CI box would pass the whole file while proving nothing at all.
		expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).toBe(-60);
		expect(new Date('2026-07-15T12:00:00Z').getTimezoneOffset()).toBe(-120);
	});

	it('and those two days really are 25 and 23 hours long', () => {
		expect(dayStartTs(addDays(FALL_BACK, 1)) - dayStartTs(FALL_BACK)).toBe(25 * HOUR);
		expect(dayStartTs(addDays(SPRING_FORWARD, 1)) - dayStartTs(SPRING_FORWARD)).toBe(23 * HOUR);
		expect(dayStartTs(addDays(NORMAL, 1)) - dayStartTs(NORMAL)).toBe(24 * HOUR);
	});
});

describe('timeOnDayTs is a clock reading, not an elapsed duration', () => {
	it.each([FALL_BACK, SPRING_FORWARD, NORMAL])('09:00 on %s really is 09:00', (day) => {
		// Was 08:00 on the fall-back day and 10:00 on the spring-forward one.
		expect(clock(timeOnDayTs(day, 9 * 60))).toBe('09:00');
	});

	it.each([FALL_BACK, SPRING_FORWARD, NORMAL])('midnight-to-midnight closes the day on %s', (day) => {
		// `dayEnd` used to resolve to 23:00 on the fall-back day, which is what made
		// events after 23:00 fall outside the day entirely.
		expect(timeOnDayTs(day, MINUTES_PER_DAY)).toBe(dayStartTs(addDays(day, 1)));
	});

	it('spans the real length of each day', () => {
		expect(timeOnDayTs(FALL_BACK, MINUTES_PER_DAY) - dayStartTs(FALL_BACK)).toBe(25 * HOUR);
		expect(timeOnDayTs(SPRING_FORWARD, MINUTES_PER_DAY) - dayStartTs(SPRING_FORWARD)).toBe(23 * HOUR);
	});

	it('reads midnight and one minute to midnight correctly', () => {
		for (const day of [FALL_BACK, SPRING_FORWARD, NORMAL]) {
			expect(clock(timeOnDayTs(day, 0))).toBe('00:00');
			expect(clock(timeOnDayTs(day, MINUTES_PER_DAY - 1))).toBe('23:59');
		}
	});

	it('normalises a clock time the spring-forward day does not have', () => {
		// 02:30 never happens on 2026-03-29. Moving forward is the only sane answer;
		// what matters is that it stays inside the day rather than throwing or NaN.
		const ts = timeOnDayTs(SPRING_FORWARD, 2 * 60 + 30);
		expect(Number.isFinite(ts)).toBe(true);
		expect(ts).toBeGreaterThanOrEqual(dayStartTs(SPRING_FORWARD));
		expect(ts).toBeLessThan(dayStartTs(addDays(SPRING_FORWARD, 1)));
	});
});

describe('remote events land on the wall clock they say', () => {
	const remote = (day: string, from: string, to: string): RemoteEvent => ({
		kind: 'remote',
		id: 'r1',
		calendarId: 'c1',
		calendarName: 'Work',
		title: 'Standup',
		startTs: at(day, from),
		endTs: at(day, to),
		allDay: false,
		color: '#123456',
	});

	it('draws 09:00 at 09:00 on a 25-hour day (it drew 10:00)', () => {
		const slot = spanSlot(remote(FALL_BACK, '09:00', '10:00'), FALL_BACK, SLOT)!;
		expect([slot.start, slot.end]).toEqual([9 * 60, 10 * 60]);
	});

	it('draws 09:00 at 09:00 on a 23-hour day (it drew 08:00)', () => {
		const slot = spanSlot(remote(SPRING_FORWARD, '09:00', '10:00'), SPRING_FORWARD, SLOT)!;
		expect([slot.start, slot.end]).toEqual([9 * 60, 10 * 60]);
	});

	it('THE DISAPPEARING EVENT: 23:30 on the fall-back day is drawn at all', () => {
		// `dayEnd` was 23:00, so `startTs >= dayEnd` returned null and the event
		// simply was not there — no error, no warning, nothing on the grid.
		const slot = spanSlot(remote(FALL_BACK, '23:30', '23:45'), FALL_BACK, SLOT);
		expect(slot).not.toBeNull();
		expect([slot!.start, slot!.end]).toEqual([23 * 60 + 30, 23 * 60 + 45]);
	});

	it('still starts at midnight and fills to midnight when it should', () => {
		const slot = spanSlot(remote(FALL_BACK, '00:00', '01:00'), FALL_BACK, SLOT)!;
		expect([slot.start, slot.end]).toEqual([0, 60]);
	});

	it('clamps a span that crosses the transition to each day it covers', () => {
		const crossing: RemoteEvent = {
			...remote(FALL_BACK, '00:00', '00:00'),
			startTs: at('2026-10-24', '22:00'),
			endTs: at(FALL_BACK, '10:00'),
		};
		const first = spanSlot(crossing, '2026-10-24', SLOT)!;
		expect([first.start, first.end]).toEqual([22 * 60, MINUTES_PER_DAY]);
		expect(first.continuesAfter).toBe(true);

		const second = spanSlot(crossing, FALL_BACK, SLOT)!;
		expect([second.start, second.end]).toEqual([0, 10 * 60]);
		expect(second.continuesBefore).toBe(true);
	});

	it('is unchanged on an ordinary day', () => {
		const slot = spanSlot(remote(NORMAL, '09:00', '10:00'), NORMAL, SLOT)!;
		expect([slot.start, slot.end]).toEqual([540, 600]);
	});
});

describe('reminders fire at the time on the clock', () => {
	const event = (day: string): LocalEvent => ({
		kind: 'local',
		id: 'standup',
		title: 'Standup',
		date: day,
		startMinutes: 9 * 60,
		endMinutes: 10 * 60,
		checked: false,
		linked: true,
	});

	const SETTINGS = {
		notifyAtStart: true,
		notifyLeadMinutes: 10,
		notifyForRemoteEvents: true,
		notifyAllDayAtHour: 8,
	};

	it.each([FALL_BACK, SPRING_FORWARD, NORMAL])('a 09:00 event on %s reminds at 09:00', (day) => {
		expect(clock(eventStartTs(event(day))!)).toBe('09:00');
		const start = remindersFor(event(day), SETTINGS).find((r) => r.kind === 'start')!;
		expect(start.body).toBe('Now: 09:00');
	});

	it('the lead reminder is exactly ten REAL minutes early, even across a transition', () => {
		for (const day of [FALL_BACK, SPRING_FORWARD, NORMAL]) {
			const out = remindersFor(event(day), SETTINGS);
			const start = out.find((r) => r.kind === 'start')!;
			const lead = out.find((r) => r.kind === 'lead')!;
			expect(start.fireAt - lead.fireAt).toBe(10 * 60_000);
			expect(clock(lead.fireAt)).toBe('08:50');
		}
	});

	it('announces an all-day item at the configured hour on the clock', () => {
		for (const day of [FALL_BACK, SPRING_FORWARD, NORMAL]) {
			const untimed: LocalEvent = { ...event(day), startMinutes: null, endMinutes: null };
			const [reminder] = remindersFor(untimed, SETTINGS);
			expect(clock(reminder.fireAt)).toBe('08:00');
		}
	});
});
