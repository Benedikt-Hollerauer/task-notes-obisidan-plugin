// The single "what time slot does this event occupy" fallback. Pure.

import type { TaskEvent } from '../types';
import { MINUTES_PER_DAY } from './timestamps';
import { eventSpan } from './event-range';
import { dayStartTs, timeOnDayTs } from './date-key';
import { minutesOfDay } from './now';

/** Settings fields the slot fallback depends on. */
export interface SlotSettings {
	dayStartHour: number;
	defaultEventDurationMinutes: number;
}

export interface Slot {
	start: number;
	end: number;
}

/**
 * Resolve an event's concrete slot for WRITING: an untimed event starts at the
 * configured day start, and a missing end uses the default duration.
 */
export function resolveSlot(
	ev: { startMinutes: number | null; endMinutes: number | null },
	settings: SlotSettings,
): Slot {
	const start = ev.startMinutes ?? settings.dayStartHour * 60;
	const end = ev.endMinutes ?? start + settings.defaultEventDurationMinutes;
	return { start, end: Math.max(end, start + 1) };
}

export interface DaySlot extends Slot {
	/** The line's end time is earlier than its start, i.e. it runs past midnight. */
	crossesMidnight: boolean;
}

/**
 * Resolve the slot a block occupies for DRAWING on its day.
 *
 * A line like `23:00 - 01:00` runs into the next day. Clamping it to
 * `start + 1` (as the write-slot does) would render a 1-minute sliver whose
 * geometry then feeds the drag code — silently rewriting the user's end time to
 * 23:01. Such blocks are drawn to the end of the day and flagged so the UI can
 * refuse to drag them.
 */
export function daySlot(
	ev: { startMinutes: number | null; endMinutes: number | null },
	settings: SlotSettings,
): DaySlot {
	const start = ev.startMinutes ?? settings.dayStartHour * 60;
	const rawEnd = ev.endMinutes ?? start + settings.defaultEventDurationMinutes;
	if (rawEnd <= start) {
		// end === start is a zero-length block, not a wrap; only a strictly earlier
		// end means the line continues past midnight.
		const crossesMidnight = rawEnd < start;
		return {
			start,
			end: crossesMidnight ? MINUTES_PER_DAY : start + 1,
			crossesMidnight,
		};
	}
	return { start, end: Math.min(rawEnd, MINUTES_PER_DAY), crossesMidnight: false };
}

export interface SpanSlot extends DaySlot {
	/** The event began before this day, so its top edge is a continuation. */
	continuesBefore: boolean;
	/** The event runs past this day, so its bottom edge is a continuation. */
	continuesAfter: boolean;
}

/**
 * The slot an event occupies ON ONE DAY of however many it spans — the single
 * rule for drawing, for both local and remote events.
 *
 * A multi-day event is drawn CONTINUOUSLY: it starts at its time on the first
 * day and runs to midnight, fills every day in between, and finishes on the
 * last. It used to be shunted into the all-day lane the moment it had an end
 * date, which threw away a perfectly good start time — an event scheduled for
 * 20:00 was drawn as a chip with no time at all.
 *
 * Local and remote differ only in where the end comes from, and only on the
 * LAST day: a remote event carries real timestamps, while the filename grammar
 * carries exactly one time, on the start day. There is no honest end time to
 * draw for a local event's final day, so it is drawn full rather than invented.
 *
 * Returns null when the event does not touch `dayKey`.
 */
export function spanSlot(ev: TaskEvent, dayKey: string, settings: SlotSettings): SpanSlot | null {
	const { from, to } = eventSpan(ev);
	if (dayKey < from || dayKey > to) return null;
	const continuesBefore = dayKey > from;
	const continuesAfter = dayKey < to;

	if (ev.kind === 'remote') {
		const dayStart = dayStartTs(dayKey);
		const dayEnd = timeOnDayTs(dayKey, MINUTES_PER_DAY);
		if (ev.endTs <= dayStart || ev.startTs >= dayEnd) return null;
		// Positions are WALL CLOCK, read off the event's own timestamp. Converting
		// the elapsed milliseconds since midnight instead drew every event an hour
		// late on a 25-hour day — and, because `dayEnd` resolved to 23:00, made
		// anything after 23:00 fall outside the day and vanish entirely.
		const start = ev.startTs <= dayStart ? 0 : minutesOfDay(ev.startTs);
		const end = ev.endTs >= dayEnd ? MINUTES_PER_DAY : minutesOfDay(ev.endTs);
		return { start, end: Math.max(end, start + 1), crossesMidnight: false, continuesBefore, continuesAfter };
	}

	// One day: exactly what it has always drawn, wrap handling included.
	if (!continuesBefore && !continuesAfter) {
		return { ...daySlot(ev, settings), continuesBefore: false, continuesAfter: false };
	}

	return {
		start: continuesBefore ? 0 : (ev.startMinutes ?? settings.dayStartHour * 60),
		end: MINUTES_PER_DAY,
		// A wrap is "this line's end is before its start". A span already knows it
		// continues; saying both would refuse the drag twice for different reasons.
		crossesMidnight: false,
		continuesBefore,
		continuesAfter,
	};
}

