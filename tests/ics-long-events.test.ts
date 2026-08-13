// THE EVENT THAT WAS ALREADY RUNNING.
//
// `expandIcs` admits an occurrence by testing its START against the display
// window. That silently loses anything that STARTED before the window opens and
// is still going: parental leave, a sabbatical, a semester, a two-week holiday, a
// long hotel booking, a conference you are in the middle of.
//
// The window looks back ICS_WINDOW_BACK_DAYS (90) and forward. So on 13 August, a
// single VEVENT running 5 January → 1 September is simply not on the calendar —
// no block, no all-day chip, no diagnostic. The day you are living inside it is
// the day it is least visible.
//
// tests/ics.test.ts covers a zero-length ancient event, which is exactly the case
// the start-only test gets right.

import { describe, it, expect } from 'vitest';
import { expandIcs } from '../src/core/ics-expand';

const CAL = { id: 'c', name: 'Cal', email: 'me@example.com' };
const NOW = Date.parse('2026-08-13T12:00:00Z');

function ics(body: string): string {
	return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN', body, 'END:VCALENDAR'].join('\r\n');
}

function vevent(lines: string[]): string {
	return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

const titles = (text: string) => expandIcs(text, CAL, '#fff', NOW).map((e) => e.title);

describe('an event that spans the window start', () => {
	it('THE BUG: a long all-day event in progress is missing entirely', () => {
		const text = ics(
			vevent([
				'UID:leave-1',
				'DTSTART;VALUE=DATE:20260105',
				'DTEND;VALUE=DATE:20260901',
				'SUMMARY:Parental leave',
			]),
		);
		expect(titles(text)).toContain('Parental leave');
	});

	it('a long TIMED event in progress is present too', () => {
		const text = ics(
			vevent([
				'UID:conf-1',
				'DTSTART:20260101T090000Z',
				'DTEND:20260901T170000Z',
				'SUMMARY:Long booking',
			]),
		);
		expect(titles(text)).toContain('Long booking');
	});

	it('an event that ended BEFORE the window is still excluded', () => {
		const text = ics(
			vevent([
				'UID:old-1',
				'DTSTART;VALUE=DATE:20250101',
				'DTEND;VALUE=DATE:20250110',
				'SUMMARY:Ancient',
			]),
		);
		expect(titles(text)).not.toContain('Ancient');
	});

	it('an event starting AFTER the window is still excluded', () => {
		const text = ics(
			vevent([
				'UID:far-1',
				'DTSTART;VALUE=DATE:20301201',
				'DTEND;VALUE=DATE:20301202',
				'SUMMARY:Far future',
			]),
		);
		expect(titles(text)).not.toContain('Far future');
	});

	it('an ordinary in-window event is unaffected', () => {
		const text = ics(
			vevent(['UID:n-1', 'DTSTART:20260813T090000Z', 'DTEND:20260813T100000Z', 'SUMMARY:Standup']),
		);
		expect(titles(text)).toContain('Standup');
	});

	it('a RECURRING occurrence straddling the window start also survives', () => {
		// A monthly 10-day block: the instance that began before the window opened
		// but has not finished must still draw.
		const text = ics(
			vevent([
				'UID:rec-1',
				'DTSTART;VALUE=DATE:20260101',
				'DTEND;VALUE=DATE:20260111',
				'RRULE:FREQ=MONTHLY;COUNT=24',
				'SUMMARY:Ten day block',
			]),
		);
		expect(titles(text)).toContain('Ten day block');
	});
});
