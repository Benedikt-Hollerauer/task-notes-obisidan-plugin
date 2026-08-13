import { Plugin, Notice, Platform } from 'obsidian';
import { get } from 'svelte/store';
import { notifyError, structuredNotice } from '../lib/obsidian-utils';
import type { TaskEvent } from '../types';
import type { TaskNotesSettings } from '../settings/settings';
import { localEventsStore, remoteEventsStore, hiddenRemoteStore } from '../state/stores';
import {
	dueReminders,
	firstSeenDue,
	nextTickBoundary,
	pruneFired,
	remindersFor,
	reminderKey,
	type Reminder,
} from '../core/reminders';

const TICK_MS = 60_000;
/**
 * How far back a reminder may be and still fire when the index produced it late.
 *
 * Two ticks' worth. Long enough to cover an event created seconds before it was
 * due and indexed just after the tick that should have delivered it; short
 * enough that nothing stale can arrive this way.
 */
const LATE_INDEX_GRACE_MS = 2 * TICK_MS;
/**
 * How far back a delayed tick may reach. A laptop that slept for a week must
 * not wake up and fire a week of reminders; ten minutes covers a busy main
 * thread, a brief sleep and a slow vault scan.
 */
const MAX_LOOKBACK_MS = 10 * 60_000;
/**
 * How long to wait for a posted OS notification to say it was actually shown
 * before assuming it was swallowed and putting an in-app notice up as well.
 */
const SHOW_GRACE_MS = 1_200;

/**
 * Watches upcoming events and fires a notification at event start, a lead time
 * before, and/or the morning of an all-day item.
 *
 * WHAT THIS CAN AND CANNOT DO, on purpose:
 *  - On desktop it fires a real OS notification, which arrives even when
 *    Obsidian is not the focused window.
 *  - On mobile no community plugin can post an OS notification, and the timer
 *    below is suspended the moment the app is backgrounded — so there it is an
 *    in-app notice, delivered while you are looking at Obsidian. The settings
 *    copy says exactly that rather than implying more.
 *  - Nothing fires while Obsidian is not running, on any platform.
 */
export class NotificationService {
	/** Reminder key → when it fired, so pruning never has to parse the key. */
	private fired = new Map<string, number>();
	/**
	 * The reminder keys the PREVIOUS tick knew about.
	 *
	 * Separate from `fired`: a key in here has merely been CONSIDERED, which is
	 * what lets a just-indexed reminder be told apart from an old one.
	 */
	private seen = new Set<string>();
	/** The end of the last window examined; the next one starts here. */
	private lastTick = Date.now();
	private permissionAsked = false;

	constructor(
		private getSettings: () => TaskNotesSettings,
		/** Open the event a notification is about. */
		private openEvent: (event: TaskEvent) => void,
	) {}

	register(plugin: Plugin): void {
		// Aligned to the minute. Anchored to plugin-load time instead, a reminder for
		// an event "starting now" arrived anywhere from 0 to 59 seconds late.
		const toNextMinute = TICK_MS - (Date.now() % TICK_MS);
		const first = window.setTimeout(() => {
			this.tick();
			plugin.registerInterval(window.setInterval(() => this.tick(), TICK_MS));
		}, toNextMinute);
		plugin.register(() => window.clearTimeout(first));

		// Ask NOW, not only when the toggle is flipped. A data.json synced from
		// another machine already says notifications are on, so nothing ever asked
		// this machine — and every reminder silently became an in-app notice.
		// requestPermission() returns early unless permission is still 'default'.
		if (this.getSettings().notificationsEnabled) void NotificationService.requestPermission();
	}

	/** What the OS currently allows, for the settings tab to show. */
	static permissionState(): NotificationPermission | 'unavailable' {
		return NotificationService.canUseSystemNotifications() ? Notification.permission : 'unavailable';
	}

	/**
	 * Deliver a sample reminder right now.
	 *
	 * Backs the "Send a test notification" command. Until this existed there was no
	 * way to answer "do notifications work on this machine?" short of creating an
	 * event and waiting for it.
	 */
	sendTest(): void {
		const now = Date.now();
		this.notify({
			eventId: '',
			kind: 'start',
			title: 'Task Notes',
			startTs: now,
			fireAt: now,
			body: 'If you can see this, reminders are working.',
		});
		// …and say what is actually ARMED. Delivery working tells you nothing about
		// whether any reminder exists to deliver, which is the other half of
		// "notifications don't work" and was previously invisible.
		new Notice(`${this.describeChannel()}\n\n${this.describeArmed(now)}`, 10_000);
	}

	/**
	 * Where a reminder would arrive from, said out loud.
	 *
	 * "Notifications don't work" has four unrelated causes — the feature is off,
	 * nothing is armed, the OS never granted permission, or the OS accepted one
	 * and never drew it — and until this sentence existed the only way to tell
	 * them apart was to read the source.
	 */
	private describeChannel(): string {
		const s = this.getSettings();
		if (!s.preferSystemNotifications) return 'Reminders are set to appear in Obsidian.';
		if (Platform.isMobileApp) return 'On mobile, reminders always appear in Obsidian.';
		if (typeof Notification === 'undefined') {
			return 'This build has no system notifications, so reminders appear in Obsidian.';
		}
		if (Notification.permission === 'granted') {
			return 'Reminders come from your system. If one never appears, Obsidian shows it instead.';
		}
		return Notification.permission === 'denied'
			? 'Your system is blocking notifications for Obsidian, so reminders appear in Obsidian.'
			: 'Your system has not been asked for permission yet, so reminders appear in Obsidian.';
	}

	/** A one-line summary of the reminders currently waiting, for the test command. */
	private describeArmed(now: number): string {
		const s = this.getSettings();
		if (!s.notificationsEnabled) return 'Reminders are turned off in settings.';
		const upcoming = this.collect(s)
			.filter((r) => r.fireAt > now)
			.sort((a, b) => a.fireAt - b.fireAt);
		if (upcoming.length === 0) {
			return (
				'No reminders are armed. Timed items get one at their start time; ' +
				'an item with no time gets one in the morning instead.'
			);
		}
		const next = upcoming[0];
		const when = new Date(next.fireAt).toLocaleString();
		return `${upcoming.length} reminder(s) armed. Next: “${next.title}” at ${when}.`;
	}

	/** True when this platform can post a notification outside Obsidian's window. */
	static canUseSystemNotifications(): boolean {
		return !Platform.isMobileApp && typeof Notification !== 'undefined';
	}

	/**
	 * Ask the OS for permission, returning what it decided.
	 *
	 * Called from the settings toggle: enabling notifications and then silently
	 * getting in-app notices — because permission was never granted — is the
	 * failure this exists to prevent.
	 */
	static async requestPermission(): Promise<NotificationPermission | 'unavailable'> {
		if (!NotificationService.canUseSystemNotifications()) return 'unavailable';
		if (Notification.permission !== 'default') return Notification.permission;
		try {
			return await Notification.requestPermission();
		} catch {
			return 'denied';
		}
	}

	private tick(): void {
		const now = Date.now();
		const since = this.lastTick;

		const s = this.getSettings();
		if (!s.notificationsEnabled) {
			// Nothing is armed while the feature is off, so the window may close.
			this.lastTick = now;
			return;
		}
		pruneFired(this.fired, now - MAX_LOOKBACK_MS);

		const reminders = this.collect(s);
		// Only close the window if there was something in it to consider. At
		// startup the index is still building, and a reminder due in that first
		// minute used to fall through the gap and never fire.
		this.lastTick = nextTickBoundary(since, now, reminders.length, MAX_LOOKBACK_MS);

		// A reminder the index only just produced can be due against a window that
		// already closed — you create an event a minute before it starts, and the
		// tick that would have delivered it ran before the index had it. The
		// startup guard above does not cover that: your OTHER hundred events keep
		// `considered > 0`, so the window advances right over the new one.
		const fresh = firstSeenDue(reminders, this.seen, now, LATE_INDEX_GRACE_MS);
		// Replaced, not added to: `seen` is exactly "what the previous tick knew
		// about", so it stays the size of the vault instead of growing forever.
		this.seen = new Set(reminders.map(reminderKey));

		const due = [...dueReminders(reminders, since, now, MAX_LOOKBACK_MS), ...fresh];
		for (const r of due) {
			const key = reminderKey(r);
			if (this.fired.has(key)) continue;
			// DELIVER FIRST. `fired` used to be stamped before the attempt and the
			// window closed above it, so one throw consumed that reminder AND every
			// later one in the same tick — permanently, and in silence.
			try {
				this.notify(r);
				this.fired.set(key, r.fireAt);
			} catch (err) {
				notifyError(`Failed to deliver the reminder for “${r.title}”`, err);
			}
		}
	}

	/**
	 * Every reminder the vault's events would produce.
	 *
	 * Not "the events on screen", which is what this comment used to claim: both
	 * stores hold everything the index knows, independently of the timeline's range
	 * or whether any view is open at all.
	 */
	private collect(s: TaskNotesSettings): Reminder[] {
		const hidden = get(hiddenRemoteStore);
		const events: TaskEvent[] = [...get(localEventsStore).events, ...get(remoteEventsStore).events];
		const out: Reminder[] = [];
		for (const ev of events) {
			if (ev.kind === 'remote') {
				if (!s.notifyForRemoteEvents) continue;
				// A remote occurrence you ticked off is done as far as this side is
				// concerned — it must not still buzz you.
				if (hidden.has(ev.id)) continue;
			} else if (ev.checked) {
				continue;
			}
			out.push(...remindersFor(ev, s));
		}
		return out;
	}

	private notify(r: Reminder): void {
		const s = this.getSettings();
		if (this.trySystemNotification(r, s)) return;
		// Also the mobile path, and the path when permission was never granted.
		this.noticeFor(r);
		if (s.preferSystemNotifications && !this.permissionAsked) {
			this.permissionAsked = true;
			this.warnIfSystemUnavailable();
		}
	}

	/**
	 * Post an OS notification, returning whether the in-app notice can be skipped.
	 *
	 * THE BUG THIS FIXES — a reminder that vanished with no error anywhere. On
	 * Linux, Electron commonly reports `Notification.permission === 'granted'`
	 * without ever having prompted, and `new Notification(...)` then resolves
	 * without throwing even when nothing is displayed: no notification daemon, an
	 * unregistered .desktop entry, or Do Not Disturb. The old code returned at that
	 * point, so the fallback notice AND the explanatory warning were both skipped
	 * and the user got absolute silence with nothing in the console.
	 *
	 * A notification that is really shown fires `show`. If that has not happened
	 * shortly after, assume it was swallowed and put a Notice up too. Being told
	 * twice is a far smaller failure than not being told, and it makes a broken OS
	 * channel visible instead of silent.
	 */
	private trySystemNotification(r: Reminder, s: TaskNotesSettings): boolean {
		if (!s.preferSystemNotifications) return false;
		if (!NotificationService.canUseSystemNotifications()) return false;
		if (Notification.permission !== 'granted') return false;
		// ONLY the construction is guarded. Wrapping the wiring below in the same
		// `try` meant any error in it — including a plain TypeError — was read as
		// "the OS refused" and silently degraded the whole path.
		let n: Notification;
		try {
			// MESSAGE as the title, note underneath — the same order the in-app
			// notice uses, so a reminder reads identically whether your system drew
			// it or Obsidian did. It was the other way round: the note's name was
			// the headline and "Starts at 10:00" the small print, which is the
			// inversion this round fixes everywhere.
			//
			// `tag` collapses repeats of the same reminder in the OS's own centre;
			// `requireInteraction` is deliberately NOT set — a reminder you have to
			// dismiss by hand is a chore, not a notification.
			n = new Notification(r.body, { body: r.title, tag: reminderKey(r) });
		} catch {
			return false;
		}

		let settled = false;
		const fallBack = (): void => {
			if (settled) return;
			settled = true;
			this.noticeFor(r);
		};
		n.onshow = () => {
			settled = true;
		};
		n.onerror = fallBack;
		// Clicking a reminder should take you to the thing it is about.
		n.onclick = () => {
			globalThis.window?.focus();
			const event = this.eventById(r.eventId);
			if (event) this.openEvent(event);
			n.close();
		};
		// Bare setTimeout, not window.setTimeout: this path has to be reachable
		// wherever the class runs, and `window` is not a given.
		setTimeout(fallBack, SHOW_GRACE_MS);
		return true;
	}

	/**
	 * The in-app reminder, drawn in the timeline's own visual language.
	 *
	 * The MESSAGE stays a plain string — it is what a screen reader announces,
	 * what Obsidian falls back to, and what the tests read — and the element is
	 * then rebuilt as two lines with a coloured left edge, exactly like a block:
	 *
	 *     ┃ Starts at 10:00        ← when, quiet and tabular
	 *     ┃ prepare - 1 - deck     ← what
	 *
	 * The edge follows the same hue budget the grid does: red when the thing is
	 * starting NOW, the calendar's own colour for a subscribed event, and the
	 * softened accent otherwise. A reminder that says "now" should look like the
	 * block that says "now".
	 */
	private noticeFor(r: Reminder): void {
		// The same two-line component every other message uses; only the edge
		// colour and the click differ. `r.body` is the message ("Starts at 10:00")
		// and `r.title` the note it is about — message first, per the shape.
		const notice = structuredNotice(r.body, r.title);
		const event = this.eventById(r.eventId);
		const el = notice.messageEl;

		// 'start' means it is beginning this minute; 'lead' and 'allday' are
		// look-aheads, and a look-ahead has not earned the now colour.
		if (r.kind === 'start') el.addClass('task-notes-notice-now');
		if (event?.kind === 'remote' && event.color) {
			el.style.setProperty('--tn-block-color', event.color);
			el.addClass('task-notes-notice-remote');
		}

		if (!event) return;
		el.addClass('task-notes-notice-clickable');
		el.addEventListener('click', () => {
			this.openEvent(event);
			notice.hide();
		});
	}

	/** Say once why a reminder arrived in-app rather than from the OS. */
	private warnIfSystemUnavailable(): void {
		if (!NotificationService.canUseSystemNotifications()) return; // mobile: expected
		if (Notification.permission === 'granted') return;
		new Notice(
			Notification.permission === 'denied'
				? 'System notifications are blocked for Obsidian, so reminders appear in-app.'
				: 'System notifications have not been allowed yet — turn the setting off and on again to ask.',
			10_000,
		);
	}

	private eventById(id: string): TaskEvent | null {
		const all: TaskEvent[] = [...get(localEventsStore).events, ...get(remoteEventsStore).events];
		return all.find((e) => e.id === id) ?? null;
	}
}
