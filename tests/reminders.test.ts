import { describe, it, expect } from 'vitest';
import {
	remindersFor,
	dueReminders,
	firstSeenDue,
	pruneFired,
	nextTickBoundary,
	reminderKey,
	eventStartTs,
	type Reminder,
	type ReminderSettings,
} from '../src/core/reminders';
import type { LocalEvent, RemoteEvent } from '../src/types';

const SETTINGS: ReminderSettings = {
	notifyAtStart: true,
	notifyLeadMinutes: 10,
	notifyForRemoteEvents: true,
	notifyAllDayAtHour: 8,
};

const ts = (iso: string) => new Date(iso).getTime();

const timed: LocalEvent = {
	kind: 'local',
	id: 'standup',
	title: 'Standup',
	date: '2026-08-11',
	startMinutes: 9 * 60,
	endMinutes: 10 * 60,
	checked: false,
	linked: true,
};

const untimed: LocalEvent = { ...timed, id: 'water', title: 'Water the plants', startMinutes: null, endMinutes: null };

describe('remindersFor', () => {
	it('produces a start and a lead reminder for a timed event', () => {
		const out = remindersFor(timed, SETTINGS);
		expect(out.map((r) => r.kind).sort()).toEqual(['lead', 'start']);
		const start = out.find((r) => r.kind === 'start')!;
		const lead = out.find((r) => r.kind === 'lead')!;
		expect(start.fireAt).toBe(ts('2026-08-11T09:00:00'));
		expect(lead.fireAt).toBe(ts('2026-08-11T08:50:00'));
		expect(lead.body).toBe('Starts at 09:00');
	});

	it('honours each switch independently', () => {
		expect(remindersFor(timed, { ...SETTINGS, notifyAtStart: false }).map((r) => r.kind)).toEqual(['lead']);
		expect(remindersFor(timed, { ...SETTINGS, notifyLeadMinutes: 0 }).map((r) => r.kind)).toEqual(['start']);
		expect(remindersFor(timed, { ...SETTINGS, notifyAtStart: false, notifyLeadMinutes: 0 })).toEqual([]);
	});

	it('THE GAP: an all-day item finally notifies, in the morning', () => {
		// Before this it produced nothing at all — it has no start time to fire at.
		const out = remindersFor(untimed, SETTINGS);
		expect(out).toHaveLength(1);
		expect(out[0].kind).toBe('allday');
		expect(out[0].fireAt).toBe(ts('2026-08-11T08:00:00'));
	});

	it('lets the all-day reminder be turned off entirely', () => {
		expect(remindersFor(untimed, { ...SETTINGS, notifyAllDayAtHour: -1 })).toEqual([]);
	});

	it('never gives an all-day reminder to a timed event, or vice versa', () => {
		expect(remindersFor(timed, SETTINGS).some((r) => r.kind === 'allday')).toBe(false);
		expect(remindersFor(untimed, SETTINGS).some((r) => r.kind !== 'allday')).toBe(false);
	});

	// REVERSED DELIBERATELY in v4.4. This used to assert that a remote all-day
	// event produced NO reminders — "no local day key to announce it on" — which
	// made a subscribed birthday or holiday feed announce nothing at all, while two
	// settings ("Notify for remote events", "Announce all-day items at (hour)")
	// promised coverage with no carve-out. "Send a test notification" reported zero
	// reminders armed while the calendar plainly showed them.
	//
	// The occurrence's start day IS a usable key; it just was not being taken.
	it('handles a remote event, and announces an all-day remote one', () => {
		const remote: RemoteEvent = {
			kind: 'remote',
			id: 'r1',
			calendarId: 'c1',
			calendarName: 'Work',
			title: 'Design review',
			startTs: ts('2026-08-11T14:00:00'),
			endTs: ts('2026-08-11T15:00:00'),
			allDay: false,
			color: '#123456',
		};
		expect(remindersFor(remote, SETTINGS)).toHaveLength(2);

		// It still has no START time — that part was always right.
		expect(eventStartTs({ ...remote, allDay: true })).toBeNull();

		// …but it does get the morning-of announcement, on its own start day, at
		// the configured hour. Exactly one, and never a 'start'/'lead' pair.
		const allDay = remindersFor({ ...remote, allDay: true }, SETTINGS);
		expect(allDay).toHaveLength(1);
		expect(allDay[0].kind).toBe('allday');
		expect(allDay[0].fireAt).toBe(ts('2026-08-11T08:00:00'));

		// And the existing off switch still silences it.
		expect(remindersFor({ ...remote, allDay: true }, { ...SETTINGS, notifyAllDayAtHour: -1 })).toEqual(
			[],
		);
	});
});

describe('dueReminders — a delayed tick must not drop a reminder', () => {
	const at = (fireAt: number): Reminder => ({
		eventId: 'e',
		kind: 'start',
		title: 'T',
		startTs: fireAt,
		fireAt,
		body: '',
	});
	const NOW = ts('2026-08-11T09:00:00');
	const MINUTE = 60_000;

	it('fires what fell in the window', () => {
		expect(dueReminders([at(NOW - 30_000)], NOW - MINUTE, NOW, 10 * MINUTE)).toHaveLength(1);
		expect(dueReminders([at(NOW)], NOW - MINUTE, NOW, 10 * MINUTE)).toHaveLength(1);
	});

	it('THE RULE: a tick that arrives late still catches what it slept through', () => {
		// The window is "since the last tick", not a fixed minute. A busy main
		// thread or a brief sleep used to lose the notification outright.
		const missed = [at(NOW - 4 * MINUTE), at(NOW - 2 * MINUTE)];
		expect(dueReminders(missed, NOW - 5 * MINUTE, NOW, 10 * MINUTE)).toHaveLength(2);
	});

	it('but a week-long sleep does not fire a week of stale reminders', () => {
		const old = at(NOW - 24 * 60 * MINUTE);
		expect(dueReminders([old], NOW - 7 * 24 * 60 * MINUTE, NOW, 10 * MINUTE)).toEqual([]);
	});

	it('never fires the future, or the same instant twice', () => {
		expect(dueReminders([at(NOW + MINUTE)], NOW - MINUTE, NOW, 10 * MINUTE)).toEqual([]);
		// The window is half-open, so a reminder exactly on the previous boundary
		// belongs to the previous tick and cannot fire again.
		expect(dueReminders([at(NOW - MINUTE)], NOW - MINUTE, NOW, 10 * MINUTE)).toEqual([]);
	});
});

describe('reminderKey — identity that does not need parsing back apart', () => {
	it('separates kind, occurrence and event', () => {
		const base = { eventId: 'a', startTs: 100 };
		expect(reminderKey({ ...base, kind: 'start' })).not.toBe(reminderKey({ ...base, kind: 'lead' }));
		expect(reminderKey({ ...base, kind: 'start' })).not.toBe(
			reminderKey({ eventId: 'a', startTs: 200, kind: 'start' }),
		);
	});

	it('survives an id containing the old separator', () => {
		// The previous codec recovered the timestamp with lastIndexOf('::'), which
		// silently broke for a path like `Areas/A::B.md`.
		const weird = reminderKey({ eventId: 'Areas/A::B.md', startTs: 100, kind: 'start' });
		const other = reminderKey({ eventId: 'Areas/A::B.md', startTs: 200, kind: 'start' });
		expect(weird).not.toBe(other);
	});
});

describe('pruneFired', () => {
	it('drops only what can never fire again', () => {
		const fired = new Map([
			['old', 1_000],
			['recent', 5_000],
		]);
		pruneFired(fired, 3_000);
		expect([...fired.keys()]).toEqual(['recent']);
	});
});

describe('nextTickBoundary — a tick with nothing to see must not consume its window', () => {
	const MINUTE = 60_000;
	const LOOKBACK = 10 * MINUTE;

	it('closes the window when there was something to consider', () => {
		expect(nextTickBoundary(1_000, 61_000, 3, LOOKBACK)).toBe(61_000);
	});

	it('THE BUG: holds it open when there was nothing', () => {
		// At startup the vault index is still building, so the 09:00:00 tick sees
		// no events. Advancing anyway put the 09:00 reminder before the next
		// window's open edge, and it could never fire.
		expect(nextTickBoundary(1_000, 61_000, 0, LOOKBACK)).toBe(1_000);
	});

	it('but the boundary can never creep further back than the lookback', () => {
		expect(nextTickBoundary(0, 3_600_000, 0, LOOKBACK)).toBe(3_600_000 - LOOKBACK);
	});

	it('THE SCENARIO: the reminder fires on the next tick, exactly once', () => {
		const nine = new Date('2026-08-11T09:00:00').getTime();
		const reminder = {
			eventId: 'standup',
			kind: 'start' as const,
			title: 'Standup',
			startTs: nine,
			fireAt: nine,
			body: '',
		};

		// 09:00:00 — the index has not published yet, so nothing is considered.
		let since = nine - MINUTE;
		expect(dueReminders([], since, nine, LOOKBACK)).toEqual([]);
		since = nextTickBoundary(since, nine, 0, LOOKBACK);

		// 09:01:00 — the events are in, and the window still reaches back to 09:00.
		const later = nine + MINUTE;
		expect(dueReminders([reminder], since, later, LOOKBACK)).toHaveLength(1);
		since = nextTickBoundary(since, later, 1, LOOKBACK);

		// 09:02:00 — and it does not fire a second time.
		expect(dueReminders([reminder], since, later + MINUTE, LOOKBACK)).toEqual([]);
	});
});

describe('firstSeenDue — the reminder that arrived after its own window closed', () => {
	// You create an event a minute before it starts. The tick that should deliver
	// its reminder runs before the index has the event; meanwhile your other
	// hundred events keep `considered > 0`, so `nextTickBoundary` advances the
	// window straight over the new one and it can never fire. Reported as "the
	// notification didn't come".
	const GRACE = 120_000;
	const NOW = 1_800_000_000_000;

	const r = (id: string, fireAt: number): Reminder => ({
		eventId: id,
		kind: 'start',
		title: id,
		startTs: fireAt,
		fireAt,
		body: 'Now',
	});

	it('fires a reminder the previous tick had never seen', () => {
		const fresh = r('new', NOW - 30_000);
		const seen = new Set([reminderKey(r('old', NOW - 30_000))]);
		expect(firstSeenDue([fresh], seen, NOW, GRACE)).toEqual([fresh]);
	});

	it('leaves anything the previous tick already knew about alone', () => {
		// That one is the ordinary window's job; delivering it here would double up.
		const known = r('known', NOW - 30_000);
		expect(firstSeenDue([known], new Set([reminderKey(known)]), NOW, GRACE)).toEqual([]);
	});

	it('THE REPLAY GUARD: an empty seen set is the first tick, and fires nothing', () => {
		// `fired` does not survive a reload, so without this, reloading Obsidian
		// within the grace window would re-deliver reminders that already arrived.
		const fresh = r('new', NOW - 30_000);
		expect(firstSeenDue([fresh], new Set(), NOW, GRACE)).toEqual([]);
	});

	it('will not reach back further than the grace window', () => {
		const seen = new Set(['something']);
		expect(firstSeenDue([r('old', NOW - GRACE - 1)], seen, NOW, GRACE)).toEqual([]);
		expect(firstSeenDue([r('edge', NOW - GRACE + 1)], seen, NOW, GRACE)).toHaveLength(1);
	});

	it('never fires something that has not happened yet', () => {
		const seen = new Set(['something']);
		expect(firstSeenDue([r('future', NOW + 1)], seen, NOW, GRACE)).toEqual([]);
		// Exactly now is due — the ordinary window uses the same closed edge.
		expect(firstSeenDue([r('exactly', NOW)], seen, NOW, GRACE)).toHaveLength(1);
	});
});
