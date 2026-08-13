// Turning a remote calendar occurrence into a starting point for a task note.
// Pure (no Obsidian imports), so the mapping is testable on its own.
//
// A calendar title is arbitrary text from someone else\'s machine. It does NOT
// split into the filename grammar\'s action/amount/outcome, and guessing would
// produce a name you would immediately have to fix — so only what the event
// really knows is filled in: the date, the time, and the title as a starting
// action. The rest is left for the person creating it.

import type { TaskProperties } from '../types';
// `minutesToDot` is the one place the filename's `HH.MMh` form is written, and
// timestamps.ts is pure with no imports of its own — so reusing it here costs
// nothing and keeps a single spelling of the format.
import { minutesToDot } from './timestamps';

/** Local `YYYY-MM-DD` for a timestamp — the key the filename grammar uses. */
function dayKeyOf(ts: number): string {
	const d = new Date(ts);
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface RemoteOccurrence {
	title: string;
	startTs: number;
	endTs: number;
	allDay: boolean;
}

/**
 * What to put in the create dialog for a remote event.
 *
 * `endDate` is only set for an event that really spans days: an ordinary event
 * ends on the day it started, and writing that into the name would turn every
 * one-hour meeting into a date range.
 */
export function remotePrefill(event: RemoteOccurrence): Partial<TaskProperties> {
	const startDate = dayKeyOf(event.startTs);
	const out: Partial<TaskProperties> = {
		startDate,
		actionWords: event.title.trim(),
	};
	// An all-day event has no meaningful clock time to carry over.
	if (!event.allDay) {
		const start = new Date(event.startTs);
		out.time = minutesToDot(start.getHours() * 60 + start.getMinutes());
	}

	// An all-day event's DTEND is exclusive, so its last day is the day before.
	// Step back ONE MILLISECOND, not one day: a calendar day is not always 86.4M ms.
	// Europe/Berlin's 2026-03-29 is 23 hours long, so subtracting a fixed day from a
	// DTEND of 2026-03-30 landed on 2026-03-28 — every spring-forward event was
	// prefilled a day short, and that value goes straight into a filename.
	// core/event-range.ts already does it this way for the same reason.
	const endTs = event.allDay ? event.endTs - 1 : event.endTs;
	const endDate = dayKeyOf(endTs);
	if (endDate > startDate) out.endDate = endDate;

	return out;
}
