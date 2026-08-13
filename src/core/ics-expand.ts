// Turn an ICS document into RemoteEvents. Pure: no Obsidian, no network, no
// clock of its own — `now` is passed in, which is what makes it testable.

import ICAL from 'ical.js';
import type { RemoteEvent } from '../types';

const MAX_OCCURRENCES = 2000;
/**
 * Separate budget for occurrences before the display window. Generous enough to
 * fast-forward decades of a daily series (365 × 100) while still bounding work.
 */
const MAX_SKIPPED = 40_000;
/**
 * How far back expansion reaches. Exported because core/remote-hidden.ts prunes
 * against it: an occurrence older than this can never be produced again, which
 * is the only reason forgetting its mark is safe.
 */
export const ICS_WINDOW_BACK_DAYS = 90;
const WINDOW_FWD_DAYS = 455;
const DEFAULT_DURATION_MS = 30 * 60_000;

/** What expansion needs to know about the calendar an event came from. */
export interface ExpandTarget {
	id: string;
	name: string;
	/** Used to drop events this user has declined. */
	email?: string;
}

/**
 * Teach ical.js the time zones this document defines.
 *
 * Without this, `DTSTART;TZID=Europe/Berlin:20260724T140000` resolves against a
 * zone ical.js has never heard of and silently falls back to floating time — so
 * every event in a feed from another zone lands at the wrong hour. The service
 * is a process-global singleton, hence the `has` guard.
 */
export function registerTimezones(comp: ICAL.Component): void {
	for (const vt of comp.getAllSubcomponents('vtimezone')) {
		const tzid = String(vt.getFirstPropertyValue('tzid') ?? '').trim();
		if (!tzid || ICAL.TimezoneService.has(tzid)) continue;
		try {
			ICAL.TimezoneService.register(vt);
		} catch {
			/* a malformed VTIMEZONE must not sink the whole calendar */
		}
	}
}

/** True when `email` appears among the attendees with PARTSTAT=DECLINED. */
export function isDeclined(item: ICAL.Event, email?: string): boolean {
	if (!email) return false;
	const target = email.toLowerCase();
	for (const att of item.component.getAllProperties('attendee')) {
		const value = String(att.getFirstValue() ?? '').toLowerCase();
		const cn = String(att.getParameter('cn') ?? '').toLowerCase();
		if (!value.includes(target) && !cn.includes(target)) continue;
		// Keep scanning: an invite can list the same person twice (e.g. once via a
		// group address), and only an explicit DECLINED should hide the event.
		if (String(att.getParameter('partstat') ?? '').toUpperCase() === 'DECLINED') return true;
	}
	return false;
}

function toEvent(
	cal: ExpandTarget,
	color: string,
	item: ICAL.Event,
	start: ICAL.Time,
	end: ICAL.Time,
): RemoteEvent | null {
	if (isDeclined(item, cal.email)) return null;
	const startTs = start.toJSDate().getTime();
	let endTs = end ? end.toJSDate().getTime() : startTs + DEFAULT_DURATION_MS;
	if (endTs <= startTs) endTs = startTs + DEFAULT_DURATION_MS;
	return {
		kind: 'remote',
		id: `${cal.id}::${item.uid}::${startTs}`,
		calendarId: cal.id,
		calendarName: cal.name,
		title: item.summary || '(no title)',
		startTs,
		endTs,
		allDay: start.isDate === true,
		color,
	};
}

/** Expand an ICS document into the events falling inside the display window. */
export function expandIcs(text: string, cal: ExpandTarget, color: string, now: number): RemoteEvent[] {
	// ical.js types `parse()` as `any`, and `Component` is its documented consumer.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
	const comp = new ICAL.Component(ICAL.parse(text));
	registerTimezones(comp);

	const masters: ICAL.Component[] = [];
	const overrides = new Map<string, ICAL.Component[]>();
	for (const ve of comp.getAllSubcomponents('vevent')) {
		const uid = String(ve.getFirstPropertyValue('uid') ?? '');
		if (ve.getFirstPropertyValue('recurrence-id')) {
			const list = overrides.get(uid) ?? [];
			list.push(ve);
			overrides.set(uid, list);
		} else {
			masters.push(ve);
		}
	}

	const windowStart = now - ICS_WINDOW_BACK_DAYS * 86_400_000;
	const windowEnd = now + WINDOW_FWD_DAYS * 86_400_000;
	const out: RemoteEvent[] = [];
	const push = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
		const ev = toEvent(cal, color, item, start, end);
		if (ev) out.push(ev);
	};

	for (const ve of masters) {
		let event: ICAL.Event;
		try {
			event = new ICAL.Event(ve);
		} catch {
			continue;
		}
		// A VEVENT with no DTSTART is not schedulable. Skip just that one: letting it
		// throw would drop the entire calendar back to its cached copy.
		if (event.startDate == null) continue;

		for (const ov of overrides.get(event.uid) ?? []) {
			try {
				event.relateException(new ICAL.Event(ov));
			} catch {
				/* ignore malformed override */
			}
		}

		// An event OVERLAPS the window; it does not have to start inside it. Testing
		// the start alone silently dropped anything already running when the window
		// opens — parental leave, a sabbatical, a term, a long booking — so the day
		// you are living inside it was the day it was least visible.
		const durationMs = event.endDate
			? event.endDate.toJSDate().getTime() - event.startDate.toJSDate().getTime()
			: 0;

		if (!event.isRecurring()) {
			const startTs = event.startDate.toJSDate().getTime();
			const endTs = startTs + durationMs;
			if (endTs >= windowStart && startTs <= windowEnd) {
				push(event, event.startDate, event.endDate);
			}
			continue;
		}

		// Iterate from DTSTART, never from a seed: ical.js derives the pattern from
		// the iterator's start, so seeding would shift the weekday of a `FREQ=WEEKLY`
		// rule with no BYDAY.
		const it = event.iterator();
		let next: ICAL.Time | null;
		let count = 0;
		let skipped = 0;
		while ((next = it.next()) && count < MAX_OCCURRENCES && skipped < MAX_SKIPPED) {
			const startTs = next.toJSDate().getTime();
			if (startTs > windowEnd) break;
			// Pre-window occurrences get their OWN large budget: a daily series started
			// years ago must not exhaust the in-window budget and vanish. An
			// occurrence that STARTED before the window but is still running is not a
			// pre-window occurrence — same overlap rule as above.
			if (startTs + durationMs < windowStart) {
				skipped++;
				continue;
			}
			count++;
			try {
				const details = event.getOccurrenceDetails(next);
				push(details.item, details.startDate, details.endDate);
			} catch {
				/* skip bad occurrence */
			}
		}
	}

	return out;
}

/**
 * Why a fetched body cannot be a calendar, whatever the HTTP status said, or
 * null when it looks usable.
 *
 * A 200 with an empty body — or with a login page — otherwise reports as
 * "0 events · updated 14:32", which reads as "your calendar is empty".
 */
export function icsBodyProblem(text: string): string | null {
	if (text.trim().length === 0) return 'The calendar responded with an empty body';
	if (!/BEGIN:VCALENDAR/i.test(text)) return 'That URL did not return a calendar';
	return null;
}
