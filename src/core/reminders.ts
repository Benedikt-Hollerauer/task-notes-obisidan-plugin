// Which reminders are due, and when. Pure (no Obsidian imports, no clock).
//
// This used to live inside NotificationService, reading Date.now() itself, so
// none of it could be tested — including the window arithmetic that decides
// whether a reminder fires at all.

import type { TaskEvent } from '../types';
import { timeOnDayTs } from './date-key';

export type ReminderKind = 'start' | 'lead' | 'allday';

export interface Reminder {
	eventId: string;
	kind: ReminderKind;
	title: string;
	/** When the occurrence starts. Identifies the occurrence across ticks. */
	startTs: number;
	/** When this reminder should fire. */
	fireAt: number;
	/** What the notification should say under the title. */
	body: string;
}

/** The settings this module reads. */
export interface ReminderSettings {
	notifyAtStart: boolean;
	notifyLeadMinutes: number;
	notifyForRemoteEvents: boolean;
	notifyAllDayAtHour: number;
	/** -1 disables the all-day reminder entirely. */
}

/**
 * A stable identity for one reminder.
 *
 * Callers keep `fireAt` alongside it rather than parsing it back out of the
 * string — the previous codec recovered the timestamp with `lastIndexOf('::')`,
 * which quietly broke for any event id containing a colon pair.
 */
export function reminderKey(r: Pick<Reminder, 'eventId' | 'kind' | 'startTs'>): string {
	return `${r.kind}\0${r.startTs}\0${r.eventId}`;
}

/** When an event begins, or null if it has no time of its own. */
export function eventStartTs(ev: TaskEvent): number | null {
	if (ev.kind === 'remote') return ev.allDay ? null : ev.startTs;
	if (ev.startMinutes == null) return null;
	// Wall clock, not elapsed time: `timeOnDayTs` sets the hour and minute rather
	// than adding a duration, so a 09:00 reminder fires at 09:00 even on the two
	// days a year that are 23 or 25 hours long. It used to fire an hour early.
	return timeOnDayTs(ev.date, ev.startMinutes);
}

/** The day key an event belongs to, for its all-day reminder. */
function allDayKey(ev: TaskEvent): string | null {
	if (ev.kind === 'local') return ev.startMinutes == null ? ev.date : null;
	return null;
}

const formatTime = (ts: number): string => {
	const d = new Date(ts);
	return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
};

/** Every reminder one event would produce, whether or not it is due yet. */
export function remindersFor(ev: TaskEvent, settings: ReminderSettings): Reminder[] {
	const out: Reminder[] = [];
	const base = { eventId: ev.id, title: ev.title };

	const startTs = eventStartTs(ev);
	if (startTs != null) {
		if (settings.notifyAtStart) {
			out.push({ ...base, kind: 'start', startTs, fireAt: startTs, body: `Now: ${formatTime(startTs)}` });
		}
		if (settings.notifyLeadMinutes > 0) {
			out.push({
				...base,
				kind: 'lead',
				startTs,
				fireAt: startTs - settings.notifyLeadMinutes * 60_000,
				body: `Starts at ${formatTime(startTs)}`,
			});
		}
		return out;
	}

	// An all-day item has no time to fire at, so it never notified at all. A
	// morning-of reminder is the only honest option: -1 turns it off.
	const day = allDayKey(ev);
	if (day && settings.notifyAllDayAtHour >= 0) {
		const fireAt = timeOnDayTs(day, settings.notifyAllDayAtHour * 60);
		out.push({ ...base, kind: 'allday', startTs: fireAt, fireAt, body: 'All day today' });
	}
	return out;
}

/**
 * The reminders whose moment fell in `(since, now]`.
 *
 * The window is "everything since the last tick", not a fixed minute: a tick
 * delayed by a busy main thread or a sleeping laptop used to drop the
 * notification entirely, because its one-minute window had already passed.
 *
 * `maxLookbackMs` bounds it, so waking a machine after a week does not fire a
 * week of stale reminders at once.
 */
export function dueReminders(
	reminders: readonly Reminder[],
	since: number,
	now: number,
	maxLookbackMs: number,
): Reminder[] {
	const from = Math.max(since, now - maxLookbackMs);
	return reminders.filter((r) => r.fireAt > from && r.fireAt <= now);
}

/**
 * Where the NEXT tick's window should start.
 *
 * A tick that had nothing to consider — the vault index is still being built at
 * startup — must not consume its window. It used to advance unconditionally, so
 * a 09:00 reminder whose events had not been indexed by the 09:00:00 tick fell
 * before the next window's open edge and could never fire at all.
 *
 * Bounded by `maxLookbackMs` so a long quiet spell cannot leave the boundary
 * creeping arbitrarily far behind.
 */
export function nextTickBoundary(
	since: number,
	now: number,
	considered: number,
	maxLookbackMs: number,
): number {
	return considered > 0 ? now : Math.max(since, now - maxLookbackMs);
}

/** Forget reminders that can never fire again, so the fired set stays bounded. */
export function pruneFired(fired: Map<string, number>, before: number): void {
	for (const [key, fireAt] of fired) {
		if (fireAt < before) fired.delete(key);
	}
}

/**
 * Reminders that are due but would fall OUTSIDE the tick window, because the
 * index only just produced them.
 *
 * THE GAP THIS CLOSES. `nextTickBoundary` declines to advance the window only
 * when nothing at all was considered — the startup case. But create an event a
 * minute before it starts and the tick that should have delivered its reminder
 * runs before the index has the event; meanwhile every OTHER event in the vault
 * keeps `considered > 0`, so the window advances straight over the new one and
 * the reminder can never fire. Reported simply as "the notification didn't come".
 *
 * `seen` is what the previous tick knew about, so a key absent from it is new
 * information rather than an old reminder being reconsidered.
 *
 * An EMPTY `seen` is the first tick after load, when everything is new — that is
 * population, not a late index, so nothing fires from it. Without that, reloading
 * Obsidian within the grace window would replay reminders that had already
 * arrived (`fired` does not survive a reload).
 */
export function firstSeenDue(
	reminders: readonly Reminder[],
	seen: ReadonlySet<string>,
	now: number,
	graceMs: number,
): Reminder[] {
	if (seen.size === 0) return [];
	return reminders.filter(
		(r) => !seen.has(reminderKey(r)) && r.fireAt <= now && r.fireAt > now - graceMs,
	);
}
