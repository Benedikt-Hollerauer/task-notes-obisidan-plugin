import { describe, it, expect } from 'vitest';
import ICAL from 'ical.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expandIcs, registerTimezones, isDeclined } from '../src/core/ics-expand';
import { tsToLocalKey } from '../src/core/date-key';
import { eventSpan } from '../src/core/event-range';

const CAL = { id: 'cal1', name: 'Work' };
const NOW = Date.parse('2026-07-20T12:00:00Z');

const BERLIN_VTIMEZONE = [
	'BEGIN:VTIMEZONE',
	'TZID:Europe/Berlin',
	'BEGIN:DAYLIGHT',
	'TZOFFSETFROM:+0100',
	'TZOFFSETTO:+0200',
	'TZNAME:CEST',
	'DTSTART:19700329T020000',
	'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
	'END:DAYLIGHT',
	'BEGIN:STANDARD',
	'TZOFFSETFROM:+0200',
	'TZOFFSETTO:+0100',
	'TZNAME:CET',
	'DTSTART:19701025T030000',
	'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
	'END:STANDARD',
	'END:VTIMEZONE',
].join('\n');

function ics(...body: string[]): string {
	return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...body, 'END:VCALENDAR'].join('\n');
}

function vevent(...lines: string[]): string {
	return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\n');
}

describe('time zones', () => {
	it('THE BUG: a TZID event lands at the right absolute instant', () => {
		// 14:00 Berlin in July is 12:00Z. Without registering the feed's VTIMEZONE,
		// ical.js does not know the zone and falls back to floating time — every
		// event in a non-local-zone calendar was shown at the wrong hour.
		const text = ics(
			BERLIN_VTIMEZONE,
			vevent('UID:tz-1', 'SUMMARY:Standup', 'DTSTART;TZID=Europe/Berlin:20260724T140000', 'DTEND;TZID=Europe/Berlin:20260724T143000'),
		);
		const [ev] = expandIcs(text, CAL, '#fff', NOW);
		expect(new Date(ev.startTs).toISOString()).toBe('2026-07-24T12:00:00.000Z');
		expect(new Date(ev.endTs).toISOString()).toBe('2026-07-24T12:30:00.000Z');
	});

	it('registers each VTIMEZONE once and tolerates a malformed one', () => {
		const comp = new ICAL.Component(ICAL.parse(ics(BERLIN_VTIMEZONE)));
		registerTimezones(comp);
		registerTimezones(comp); // idempotent: the service is a process-global singleton
		expect(ICAL.TimezoneService.has('Europe/Berlin')).toBe(true);

		const junk = new ICAL.Component(ICAL.parse(ics('BEGIN:VTIMEZONE', 'END:VTIMEZONE')));
		expect(() => registerTimezones(junk)).not.toThrow();
	});

	it('handles UTC and floating times', () => {
		const text = ics(
			vevent('UID:utc-1', 'SUMMARY:UTC', 'DTSTART:20260724T090000Z', 'DTEND:20260724T100000Z'),
		);
		const [ev] = expandIcs(text, CAL, '#fff', NOW);
		expect(new Date(ev.startTs).toISOString()).toBe('2026-07-24T09:00:00.000Z');
	});
});

describe('event shapes', () => {
	it('marks a DATE-valued event as all-day', () => {
		const text = ics(vevent('UID:ad-1', 'SUMMARY:Conf', 'DTSTART;VALUE=DATE:20260724', 'DTEND;VALUE=DATE:20260726'));
		const [ev] = expandIcs(text, CAL, '#fff', NOW);
		expect(ev.allDay).toBe(true);
		expect(ev.title).toBe('Conf');
	});

	it('gives a zero-length or end-less event a default duration', () => {
		const text = ics(vevent('UID:z-1', 'SUMMARY:Ping', 'DTSTART:20260724T090000Z', 'DTEND:20260724T090000Z'));
		const [ev] = expandIcs(text, CAL, '#fff', NOW);
		expect(ev.endTs - ev.startTs).toBe(30 * 60_000);
	});

	it('falls back to a placeholder title and carries the calendar identity', () => {
		const text = ics(vevent('UID:n-1', 'DTSTART:20260724T090000Z'));
		const [ev] = expandIcs(text, CAL, '#abc', NOW);
		expect(ev.title).toBe('(no title)');
		expect(ev.calendarName).toBe('Work');
		expect(ev.color).toBe('#abc');
		expect(ev.id).toContain('cal1::n-1::');
	});

	it('drops events far outside the display window', () => {
		const text = ics(
			vevent('UID:old', 'SUMMARY:Ancient', 'DTSTART:20200101T090000Z'),
			vevent('UID:far', 'SUMMARY:Distant', 'DTSTART:20300101T090000Z'),
			vevent('UID:near', 'SUMMARY:Soon', 'DTSTART:20260724T090000Z'),
		);
		expect(expandIcs(text, CAL, '#fff', NOW).map((e) => e.title)).toEqual(['Soon']);
	});
});

describe('recurrence', () => {
	it('expands a weekly rule inside the window', () => {
		const text = ics(
			vevent(
				'UID:r-1',
				'SUMMARY:Weekly sync',
				'DTSTART:20260706T090000Z',
				'DTEND:20260706T093000Z',
				'RRULE:FREQ=WEEKLY;COUNT=4',
			),
		);
		const days = expandIcs(text, CAL, '#fff', NOW).map((e) => new Date(e.startTs).toISOString().slice(0, 10));
		// Every occurrence is a Monday — the weekday must survive expansion.
		expect(days).toEqual(['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']);
	});

	it('applies a moved occurrence (RECURRENCE-ID override)', () => {
		const text = ics(
			vevent('UID:r-2', 'SUMMARY:Daily', 'DTSTART:20260721T090000Z', 'DTEND:20260721T093000Z', 'RRULE:FREQ=DAILY;COUNT=3'),
			vevent(
				'UID:r-2',
				'SUMMARY:Daily (moved)',
				'RECURRENCE-ID:20260722T090000Z',
				'DTSTART:20260722T140000Z',
				'DTEND:20260722T143000Z',
			),
		);
		const events = expandIcs(text, CAL, '#fff', NOW);
		const moved = events.find((e) => e.title.includes('moved'));
		expect(moved).toBeDefined();
		expect(new Date(moved!.startTs).toISOString()).toBe('2026-07-22T14:00:00.000Z');
	});
});

describe('declined events', () => {
	const withAttendees = (...attendees: string[]) =>
		ics(vevent('UID:a-1', 'SUMMARY:Meeting', 'DTSTART:20260724T090000Z', ...attendees));

	it('hides an event this user declined', () => {
		const text = withAttendees('ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com');
		expect(expandIcs(text, { ...CAL, email: 'me@example.com' }, '#fff', NOW)).toHaveLength(0);
	});

	it('THE BUG: keeps scanning past a first, non-declined match for the same person', () => {
		// The old loop returned on the FIRST attendee whose address matched, so a
		// duplicate listing (common when you are invited via a group too) hid the
		// decline — or, the other way round, hid an event that was never declined.
		const text = withAttendees(
			'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:me@example.com',
			'ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com',
		);
		expect(expandIcs(text, { ...CAL, email: 'me@example.com' }, '#fff', NOW)).toHaveLength(0);
	});

	it('keeps events other people declined, and events with no email configured', () => {
		const text = withAttendees(
			'ATTENDEE;PARTSTAT=DECLINED:mailto:someone@example.com',
			'ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com',
		);
		expect(expandIcs(text, { ...CAL, email: 'me@example.com' }, '#fff', NOW)).toHaveLength(1);
		expect(expandIcs(text, CAL, '#fff', NOW)).toHaveLength(1);
	});

	it('matches on the CN parameter too', () => {
		const text = withAttendees('ATTENDEE;CN=Me Myself;PARTSTAT=DECLINED:mailto:other@example.com');
		expect(expandIcs(text, { ...CAL, email: 'me myself' }, '#fff', NOW)).toHaveLength(0);
	});

	it('isDeclined is false without an email', () => {
		const comp = new ICAL.Component(ICAL.parse(withAttendees('ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com')));
		const event = new ICAL.Event(comp.getAllSubcomponents('vevent')[0]);
		expect(isDeclined(event)).toBe(false);
	});
});

describe('malformed input', () => {
	it('throws on a body that is not ICS at all (so the caller can keep its cache)', () => {
		expect(() => expandIcs('<html>404</html>', CAL, '#fff', NOW)).toThrow();
	});

	it('skips a VEVENT with no DTSTART instead of failing the calendar', () => {
		const text = ics(
			vevent('UID:bad', 'SUMMARY:No start'),
			vevent('UID:good', 'SUMMARY:Fine', 'DTSTART:20260724T090000Z'),
		);
		expect(expandIcs(text, CAL, '#fff', NOW).map((e) => e.title)).toEqual(['Fine']);
	});
});

describe('the sample calendar shipped as a fixture', () => {
	// Lives in tests/fixtures/, not test-vault/ — the vault is gitignored (it
	// accumulated real personal notes), so a copy there would leave this test
	// unable to run from a fresh clone.
	const SAMPLE = readFileSync(
		fileURLToPath(new URL('./fixtures/sample-calendar.ics', import.meta.url)),
		'utf-8',
	);
	// Mid-August 2026, so the whole file is inside the display window.
	const AT = Date.parse('2026-08-12T12:00:00Z');
	const events = expandIcs(SAMPLE, { id: 'sample', name: 'Sample', email: 'you@example.com' }, '#4c78a8', AT);
	const byTitle = (needle: string) => events.filter((e) => e.title.includes(needle));

	it('has both all-day and timed events, which is the point of shipping it', () => {
		expect(events.some((e) => e.allDay)).toBe(true);
		expect(events.some((e) => !e.allDay)).toBe(true);
	});

	it('expands the all-day entries, including the multi-day one', () => {
		// All-day events are LOCAL dates, so they are compared with the plugin's own
		// day key — toISOString() would shift them by the machine's UTC offset.
		const holiday = byTitle('Public holiday')[0];
		expect(holiday.allDay).toBe(true);
		expect(tsToLocalKey(holiday.startTs)).toBe('2026-08-10');
		expect(eventSpan(holiday)).toEqual({ from: '2026-08-10', to: '2026-08-10' });

		const conf = byTitle('Conference')[0];
		expect(conf.allDay).toBe(true);
		// DTEND is exclusive: the chip covers the 12th to the 14th.
		expect(eventSpan(conf)).toEqual({ from: '2026-08-12', to: '2026-08-14' });
	});

	it('places a Berlin-time event at the right absolute instant', () => {
		// 09:30 CEST is 07:30Z — this is the VTIMEZONE registration working.
		expect(new Date(byTitle('Standup')[0].startTs).toISOString()).toBe('2026-08-10T07:30:00.000Z');
	});

	it('expands the weekly series and honours the moved occurrence', () => {
		const weekly = byTitle('Weekly sync');
		expect(weekly.length).toBeGreaterThan(3);
		const moved = weekly.find((e) => e.title.includes('moved'));
		expect(moved).toBeDefined();
		expect(new Date(moved!.startTs).toISOString()).toBe('2026-08-17T14:00:00.000Z');
		// …and the 11:00 occurrence it replaced is gone.
		expect(
			weekly.filter((e) => new Date(e.startTs).toISOString() === '2026-08-17T09:00:00.000Z'),
		).toHaveLength(0);
	});

	it('hides the meeting this address declined', () => {
		expect(byTitle('declined')).toHaveLength(0);
		// …but shows it to somebody else.
		const others = expandIcs(SAMPLE, { id: 's', name: 'S' }, '#000', AT);
		expect(others.filter((e) => e.title.includes('declined'))).toHaveLength(1);
	});

	it('keeps an overnight event as one span across midnight', () => {
		const night = byTitle('Night shift')[0];
		expect(new Date(night.startTs).toISOString()).toBe('2026-08-14T20:00:00.000Z');
		expect(new Date(night.endTs).toISOString()).toBe('2026-08-15T04:00:00.000Z');
	});
});
