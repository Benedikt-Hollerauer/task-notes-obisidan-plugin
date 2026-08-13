// Thin Svelte-store layer between services and UI components.
import { writable, derived, get, type Readable, type Writable } from 'svelte/store';
import type { IcsStatus, LocalEvent, RemoteEvent } from '../types';
import type { TaskNotesSettings } from '../settings/settings';
import { DEFAULT_SETTINGS } from '../settings/settings';
import { initialFocus, nextFocus, type DayFocus, type FocusSource } from '../core/focus';
import { todayKey } from '../core/date-key';

/** Current plugin settings (mirrored from plugin.settings on load/save). */
export const settingsStore: Writable<TaskNotesSettings> = writable(DEFAULT_SETTINGS);

/** All local events derived from 📅 files + daily-note planner sections. */
export const localEventsStore: Writable<{ version: number; events: LocalEvent[] }> = writable({
	version: 0,
	events: [],
});

/** All remote (ICS) events, already expanded over a broad window. */
export const remoteEventsStore: Writable<{ version: number; events: RemoteEvent[] }> = writable({
	version: 0,
	events: [],
});

/**
 * Per-calendar refresh outcome, keyed by calendar id. Settings reads this so a
 * typo'd URL shows its error instead of an unexplained empty calendar.
 */
export const icsStatusStore: Writable<Record<string, IcsStatus>> = writable({});

/**
 * Remote occurrences the user has ticked off, as a flat membership set. Always
 * REPLACED, never mutated — a mutated Set would not re-run the view filters.
 */
export const hiddenRemoteStore: Writable<ReadonlySet<string>> = writable(new Set<string>());

/** Current time, ticked periodically for the now-needle and today highlight. */
export const nowStore: Writable<number> = writable(Date.now());

/**
 * The day every view is looking at. Written through focusDay() only, so the
 * publish policy (and its loop guard) lives in one pure place.
 */
export const focusedDayStore: Writable<DayFocus> = writable(initialFocus(todayKey()));

/** Loop guard #4: a consumer reacting to a focus cannot re-enter the publisher. */
let applyingFocus = false;

/** Publish a new focused day. No-ops when nothing would change. */
export function focusDay(key: string, source: FocusSource, force = false): void {
	if (applyingFocus) return;
	const next = nextFocus(get(focusedDayStore), key, source, force);
	if (!next) return;
	applyingFocus = true;
	try {
		focusedDayStore.set(next);
	} finally {
		applyingFocus = false;
	}
}

/**
 * Today's date key, recomputed from the clock tick so the "today" highlight
 * follows midnight instead of freezing at mount time.
 */
export const todayKeyStore: Readable<string> = derived(
	nowStore,
	($now, set: (value: string) => void) => {
		void $now;
		const key = todayKey();
		set(key);
	},
	todayKey(),
);
