// Remote calendar occurrences the user has ticked off. Pure (no Obsidian).
//
// A remote event is read-only — the plugin can never write to somebody's Google
// or iCloud calendar. So "ticking" one is a purely local act: the occurrence is
// remembered here and filtered out of the views, and the "show completed"
// control brings it back. Nothing leaves this machine.
//
// Ids are grouped by calendar, because that is how they are forgotten: when a
// subscription is deleted its whole bucket goes with it.

import { ICS_WINDOW_BACK_DAYS } from './ics-expand';

/** calendarId → the occurrence ids ticked off in it. */
export type HiddenRemoteMap = Record<string, string[]>;

const DAY_MS = 86_400_000;

/** Read whatever was in data.json without trusting any of it. */
export function normalizeHidden(raw: unknown): HiddenRemoteMap {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: HiddenRemoteMap = {};
	for (const [calendarId, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!calendarId || !Array.isArray(value)) continue;
		const ids = [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0))];
		if (ids.length > 0) out[calendarId] = ids;
	}
	return out;
}

/** Flat membership set — what the views filter against. */
export function flattenHidden(map: HiddenRemoteMap): Set<string> {
	const out = new Set<string>();
	for (const ids of Object.values(map)) for (const id of ids) out.add(id);
	return out;
}

/**
 * Hide or show one occurrence. `changed` is false when the map already said
 * that — which is what stops an idempotent click from rewriting data.json.
 */
export function toggleHidden(
	map: HiddenRemoteMap,
	calendarId: string,
	id: string,
	hidden: boolean,
): { map: HiddenRemoteMap; changed: boolean } {
	const current = map[calendarId] ?? [];
	const has = current.includes(id);
	if (has === hidden) return { map, changed: false };

	const next: HiddenRemoteMap = { ...map };
	if (hidden) {
		next[calendarId] = [...current, id];
	} else {
		const rest = current.filter((x) => x !== id);
		// An empty bucket is deleted rather than left behind as `[]`.
		if (rest.length > 0) next[calendarId] = rest;
		else delete next[calendarId];
	}
	return { map: next, changed: true };
}

/** The trailing `::<startTs>` of an occurrence id, or null when it isn't one. */
export function occurrenceStart(id: string): number | null {
	const at = id.lastIndexOf('::');
	if (at < 0) return null;
	const ts = Number(id.slice(at + 2));
	return Number.isFinite(ts) ? ts : null;
}

/**
 * Forget marks that can never match an event again:
 *
 *  - the calendar itself is gone from settings (keyed on the FULL list, so a
 *    merely disabled calendar keeps its marks, exactly like the ICS cache);
 *  - the occurrence is older than the expansion window reaches back, so no
 *    refresh can ever re-emit that id.
 *
 * An id whose trailing segment is not a timestamp is KEPT — a prune must never
 * quietly eat data it doesn't understand.
 */
export function pruneHidden(
	map: HiddenRemoteMap,
	liveCalendarIds: ReadonlySet<string>,
	now: number,
): { map: HiddenRemoteMap; changed: boolean } {
	const cutoff = now - ICS_WINDOW_BACK_DAYS * DAY_MS;
	const next: HiddenRemoteMap = {};
	let changed = false;

	for (const [calendarId, ids] of Object.entries(map)) {
		if (!liveCalendarIds.has(calendarId)) {
			changed = true;
			continue;
		}
		const kept = ids.filter((id) => {
			const start = occurrenceStart(id);
			return start == null || start >= cutoff;
		});
		if (kept.length !== ids.length) changed = true;
		if (kept.length > 0) next[calendarId] = kept;
		else if (ids.length > 0) changed = true;
	}

	return changed ? { map: next, changed } : { map, changed: false };
}
