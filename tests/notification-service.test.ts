// The first tests this service has ever had. Everything downstream of
// `dueReminders()` returning a list was unverified — the suite would have passed
// identically if `notify()` were a no-op, which is very close to what the bug
// below actually was.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Notice, Platform } from './mocks/obsidian';
import { NotificationService } from '../src/services/notification-service';
import { localEventsStore, remoteEventsStore, hiddenRemoteStore } from '../src/state/stores';
import { DEFAULT_SETTINGS, type TaskNotesSettings } from '../src/settings/settings';
import type { LocalEvent, RemoteEvent } from '../src/types';

/** What the last constructed Notification did, and whether it reported a show. */
interface FakeNotification {
	title: string;
	body?: string;
	onshow: (() => void) | null;
	onerror: (() => void) | null;
	onclick: (() => void) | null;
	closed: boolean;
}

let built: FakeNotification[] = [];
let permission: NotificationPermission = 'granted';
/** When false, `new Notification()` throws — the "API present but refuses" case. */
let constructible = true;

function installNotificationStub(): void {
	class Stub {
		static get permission(): NotificationPermission {
			return permission;
		}
		onshow: (() => void) | null = null;
		onerror: (() => void) | null = null;
		onclick: (() => void) | null = null;
		closed = false;
		constructor(
			public title: string,
			options?: { body?: string },
		) {
			if (!constructible) throw new Error('refused');
			this.body = options?.body;
			built.push(this as unknown as FakeNotification);
		}
		body?: string;
		close(): void {
			this.closed = true;
		}
	}
	(globalThis as Record<string, unknown>).Notification = Stub;
}

const settings = (over: Partial<TaskNotesSettings> = {}): TaskNotesSettings => ({
	...DEFAULT_SETTINGS,
	notificationsEnabled: true,
	preferSystemNotifications: true,
	...over,
});

/** A timed local event whose start is exactly `at`. */
const localAt = (at: Date, over: Partial<LocalEvent> = {}): LocalEvent => ({
	kind: 'local',
	id: 'standup',
	title: 'Standup',
	date: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`,
	startMinutes: at.getHours() * 60 + at.getMinutes(),
	endMinutes: at.getHours() * 60 + at.getMinutes() + 30,
	checked: false,
	linked: true,
	...over,
});

const remoteAt = (at: Date, over: Partial<RemoteEvent> = {}): RemoteEvent => ({
	kind: 'remote',
	id: 'r1',
	calendarId: 'c1',
	calendarName: 'Work',
	title: 'Design review',
	startTs: at.getTime(),
	endTs: at.getTime() + 3_600_000,
	allDay: false,
	color: '#123456',
	...over,
});

/** Run the private tick by advancing the clock past one interval. */
function tick(service: NotificationService): void {
	(service as unknown as { tick(): void }).tick();
}

/** Put `service.lastTick` just before `now` so a reminder at `now` is in-window. */
function windowStartsAt(service: NotificationService, ms: number): void {
	(service as unknown as { lastTick: number }).lastTick = ms;
}

describe('NotificationService', () => {
	let service: NotificationService;
	let opened: string[];
	let current: TaskNotesSettings;

	beforeEach(() => {
		vi.useFakeTimers();
		built = [];
		permission = 'granted';
		constructible = true;
		Platform.isMobileApp = false;
		Notice.reset();
		installNotificationStub();
		localEventsStore.set({ version: 1, events: [] });
		remoteEventsStore.set({ version: 1, events: [] });
		hiddenRemoteStore.set(new Set());
		opened = [];
		current = settings();
		service = new NotificationService(
			() => current,
			(e) => opened.push(e.id),
		);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/** Arm one timed event due right now and run a tick over it. */
	function fireOne(over: Partial<TaskNotesSettings> = {}): void {
		const now = new Date('2026-08-11T09:00:00');
		vi.setSystemTime(now);
		current = settings({ notifyLeadMinutes: 0, ...over });
		localEventsStore.set({ version: 2, events: [localAt(now)] });
		windowStartsAt(service, now.getTime() - 60_000);
		tick(service);
	}

	describe('THE BUG: a system notification that is never displayed', () => {
		it('falls back to an in-app notice when the OS never reports a show', () => {
			// Electron on Linux reports permission 'granted' without prompting, and
			// `new Notification()` resolves without throwing even when nothing is
			// drawn. The old code returned there, skipping the notice AND the warning,
			// so the reminder vanished with nothing in the console.
			fireOne();
			expect(built).toHaveLength(1);
			expect(Notice.shown).toEqual([]); // nothing yet — we are waiting for `show`

			vi.advanceTimersByTime(2_000);
			expect(Notice.shown).toHaveLength(1);
			expect(Notice.shown[0]).toContain('Standup');
		});

		it('stays quiet in-app when the OS confirms it displayed the notification', () => {
			fireOne();
			built[0].onshow?.();
			vi.advanceTimersByTime(5_000);
			expect(Notice.shown).toEqual([]);
		});

		it('falls back immediately on an error, and does not then double up', () => {
			fireOne();
			built[0].onerror?.();
			expect(Notice.shown).toHaveLength(1);
			vi.advanceTimersByTime(5_000);
			expect(Notice.shown).toHaveLength(1);
		});

		it('falls back when the Notification constructor throws outright', () => {
			constructible = false;
			fireOne();
			expect(built).toHaveLength(0);
			expect(Notice.shown.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe('delivery routing', () => {
		it('uses the in-app notice when permission was never granted', () => {
			permission = 'default';
			fireOne();
			expect(built).toHaveLength(0);
			// The reminder itself, plus the once-per-session explanation.
			expect(Notice.shown.some((m) => m.includes('Standup'))).toBe(true);
			expect(Notice.shown.some((m) => m.includes('not been allowed yet'))).toBe(true);
		});

		it('uses the in-app notice on mobile, with no complaint about permission', () => {
			Platform.isMobileApp = true;
			fireOne();
			expect(built).toHaveLength(0);
			expect(Notice.shown.some((m) => m.includes('Standup'))).toBe(true);
			// Mobile cannot post OS notifications at all; warning about it is noise.
			expect(Notice.shown.some((m) => m.includes('blocked'))).toBe(false);
		});

		it('respects preferSystemNotifications being off', () => {
			fireOne({ preferSystemNotifications: false });
			expect(built).toHaveLength(0);
			expect(Notice.shown.some((m) => m.includes('Standup'))).toBe(true);
		});
	});

	describe('the tick gate and the fired-once rule', () => {
		it('does nothing at all while notifications are disabled', () => {
			fireOne({ notificationsEnabled: false });
			expect(built).toHaveLength(0);
			expect(Notice.shown).toEqual([]);
		});

		it('never delivers the same reminder twice', () => {
			const now = new Date('2026-08-11T09:00:00');
			vi.setSystemTime(now);
			current = settings({ notifyLeadMinutes: 0 });
			localEventsStore.set({ version: 2, events: [localAt(now)] });

			windowStartsAt(service, now.getTime() - 60_000);
			tick(service);
			expect(built).toHaveLength(1);

			// A second tick a moment later must not re-fire what already went out.
			vi.setSystemTime(now.getTime() + 30_000);
			windowStartsAt(service, now.getTime() - 60_000);
			tick(service);
			expect(built).toHaveLength(1);
		});
	});

	describe('collect() — which events are even considered', () => {
		const armWith = (events: (LocalEvent | RemoteEvent)[], over: Partial<TaskNotesSettings> = {}) => {
			const now = new Date('2026-08-11T09:00:00');
			vi.setSystemTime(now);
			current = settings({ notifyLeadMinutes: 0, ...over });
			localEventsStore.set({
				version: 2,
				events: events.filter((e): e is LocalEvent => e.kind === 'local'),
			});
			remoteEventsStore.set({
				version: 2,
				events: events.filter((e): e is RemoteEvent => e.kind === 'remote'),
			});
			windowStartsAt(service, now.getTime() - 60_000);
			tick(service);
		};

		it('skips a local event that is already ticked off', () => {
			armWith([localAt(new Date('2026-08-11T09:00:00'), { checked: true })]);
			expect(built).toHaveLength(0);
		});

		it('honours notifyForRemoteEvents', () => {
			const at = new Date('2026-08-11T09:00:00');
			armWith([remoteAt(at)], { notifyForRemoteEvents: false });
			expect(built).toHaveLength(0);

			built = [];
			armWith([remoteAt(at)], { notifyForRemoteEvents: true });
			expect(built).toHaveLength(1);
		});

		it('skips a remote occurrence hidden locally', () => {
			const at = new Date('2026-08-11T09:00:00');
			hiddenRemoteStore.set(new Set(['r1']));
			armWith([remoteAt(at)]);
			expect(built).toHaveLength(0);
		});
	});

	describe('the reminder notice is drawn like a block', () => {
		/**
		 * The element of the REMINDER notice, chosen by message — a denied
		 * permission also puts up a "reminders appear in-app" warning after it,
		 * so "the last notice" is the wrong one.
		 */
		const el = () => {
			const found = Notice.instances.find((n) => n.message.includes('Standup'));
			if (!found) throw new Error(`no reminder notice among: ${Notice.shown.join(' | ')}`);
			return found.messageEl;
		};

		beforeEach(() => {
			permission = 'denied'; // force the in-app path
			fireOne();
		});

		it('splits into a quiet "when" line and the title', () => {
			expect(el().children).toEqual([
				// MESSAGE first and larger, the note it concerns underneath.
				{ text: 'Now: 09:00', cls: 'task-notes-notice-message' },
				{ text: 'Standup', cls: 'task-notes-notice-note' },
			]);
			// …and the flat string is still what was ANNOUNCED, in the SAME order a
			// sighted user reads: message, then the note. A screen reader gets the
			// message, not the element, so the two must not disagree.
			expect(Notice.shown).toContain('Now: 09:00 — Standup');
		});

		it('takes the NOW colour, because the thing is starting this minute', () => {
			expect(el().classes).toContain('task-notes-notice-now');
		});

		it('is in the token scope, or every --tn-* inside it resolves to nothing', () => {
			// A Notice mounts in Obsidian's own container at the app root, which is
			// inside NONE of the other roots the token block names.
			expect(el().classes).toContain('task-notes-notice');
			const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
			const scope = css.slice(0, css.indexOf('--tn-radius-s'));
			expect(scope).toContain('.task-notes-notice,');
		});
	});

	describe('sendTest', () => {
		it('delivers immediately without needing an event to exist', () => {
			// This is the whole point: answering "do notifications work here?"
			// previously required creating an event and waiting for it.
			service.sendTest();
			expect(built).toHaveLength(1);
			// The MESSAGE is the OS notification's title, matching the in-app shape:
			// a system notification shows its title large and its body small, so the
			// sentence goes in the title and what it is about underneath.
			expect(built[0].title).toBe('If you can see this, reminders are working.');
			expect(built[0].body).toBe('Task Notes');
		});

		it('still falls back in-app when the OS swallows it', () => {
			service.sendTest();
			vi.advanceTimersByTime(2_000);
			expect(Notice.shown.some((m) => m.includes('reminders are working'))).toBe(true);
		});

		it('also says what is armed — delivery working is only half the question', () => {
			// "The test notification arrived but my blocks never notify" is a real and
			// different failure: nothing was armed. That used to be invisible.
			service.sendTest();
			expect(Notice.shown.some((m) => m.includes('No reminders are armed'))).toBe(true);

			Notice.reset();
			const soon = new Date('2026-08-11T09:00:00');
			vi.setSystemTime(soon.getTime() - 60 * 60_000);
			current = settings({ notifyLeadMinutes: 0 });
			localEventsStore.set({ version: 3, events: [localAt(soon)] });
			service.sendTest();
			expect(Notice.shown.some((m) => m.includes('1 reminder(s) armed'))).toBe(true);
			expect(Notice.shown.some((m) => m.includes('Standup'))).toBe(true);
		});
	});

	describe('permissionState', () => {
		it('reports what the OS allows, and "unavailable" where there is no OS channel', () => {
			expect(NotificationService.permissionState()).toBe('granted');
			permission = 'denied';
			expect(NotificationService.permissionState()).toBe('denied');
			Platform.isMobileApp = true;
			expect(NotificationService.permissionState()).toBe('unavailable');
		});
	});
});
