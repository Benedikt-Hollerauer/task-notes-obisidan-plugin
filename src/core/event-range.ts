// The single predicate for "does this event touch this day / range". Pure.
//
// Local events carry inclusive YYYY-MM-DD keys; remote events carry epoch millis
// whose day keys are always derived in LOCAL time (never toISOString) so blocks
// land on the day the user sees on the grid.

import type { TaskEvent } from '../types';
import { tsToLocalKey, addDays } from './date-key';

/** Inclusive [from, to] day keys an event spans. */
export function eventSpan(ev: TaskEvent): { from: string; to: string } {
	if (ev.kind === 'local') {
		// A filename can encode an end date BEFORE its start (hand-edited, or an
		// old range left behind by a reschedule). Never return an inverted span —
		// that would make the event invisible in every view.
		const end = ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date;
		return { from: ev.date, to: end };
	}
	// endTs is exclusive: an all-day event ending at next midnight covers only the
	// previous day, so step back one millisecond before taking the key.
	return { from: tsToLocalKey(ev.startTs), to: tsToLocalKey(Math.max(ev.startTs, ev.endTs - 1)) };
}

/** True if the event covers `dayKey`. */
export function eventTouchesDay(ev: TaskEvent, dayKey: string): boolean {
	const { from, to } = eventSpan(ev);
	return from <= dayKey && dayKey <= to;
}

/** True if the event overlaps the inclusive [from, to] range. */
export function eventTouchesRange(ev: TaskEvent, from: string, to: string): boolean {
	const span = eventSpan(ev);
	return span.from <= to && span.to >= from;
}

/**
 * Every day key the event covers, clamped to [clampFrom, clampTo]. The clamp is
 * mandatory: a malformed filename range (e.g. `- 9999-12-31`) would otherwise
 * enumerate millions of days and freeze the UI.
 */
export function eventDayKeys(ev: TaskEvent, clampFrom: string, clampTo: string): string[] {
	const span = eventSpan(ev);
	const start = span.from > clampFrom ? span.from : clampFrom;
	const end = span.to < clampTo ? span.to : clampTo;
	if (start > end) return [];

	const keys: string[] = [];
	for (let day = start; day <= end; day = addDays(day, 1)) keys.push(day);
	return keys;
}
