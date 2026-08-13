// One rule for what a click on a day means. Pure (no Obsidian imports).
//
// The same day cell appears in the month grid, the sidebar and the embedded
// rail; without a shared rule each host would invent its own modifier
// conventions and the "one system" would feel like three.

export type DayIntent = 'focus' | 'open' | 'open-new-leaf' | 'timeline';

export interface Modifiers {
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}

/**
 * plain      → focus the day (zoom the body to it)
 * Ctrl/Cmd   → open its daily note
 * Ctrl+Shift → open its daily note in a new tab
 * Alt        → open the timeline at that day
 */
export function dayIntent(m: Modifiers): DayIntent {
	if (m.altKey) return 'timeline';
	if (m.ctrlKey || m.metaKey) return m.shiftKey ? 'open-new-leaf' : 'open';
	return 'focus';
}

/**
 * A `data-column` attribute as a usable day index, or null.
 *
 * Never falls back to 0. A gesture that starts on a column it was never over
 * reports "moved" the moment the pointer finds a real column, and a motionless
 * click then performs a cross-day write.
 */
export function columnIndex(raw: string | null, dayCount: number): number | null {
	// `Number('')` is 0, so an empty attribute would become day 0 — the exact
	// bug this function exists to prevent.
	if (raw == null || raw.trim() === '') return null;
	const index = Number(raw);
	if (!Number.isInteger(index) || index < 0 || index >= dayCount) return null;
	return index;
}

/**
 * True when `event` belongs to `gesture`.
 *
 * Two fingers produce two pointer streams through the SAME handlers. Without
 * this, lifting the finger resting on the all-day lane's divider ran the CHIP's
 * pointerup with that finger's coordinates and dropped the chip wherever the
 * divider happened to be — a file write and a rename nobody asked for.
 */
export function ownsPointer<T extends { pointerId: number }>(
	gesture: T | null | undefined,
	event: { pointerId: number },
): gesture is T {
	return gesture != null && gesture.pointerId === event.pointerId;
}

/**
 * The day a `data-column` attribute names, or null.
 *
 * THE ONLY route from a column attribute to a date. The grid used to hit-test
 * with its own `Number(el.getAttribute('data-column'))` three lines from this
 * guard, so the guard protected one of the two paths that write to a note.
 */
export function dayAt(raw: string | null, days: readonly string[]): { index: number; key: string } | null {
	const index = columnIndex(raw, days.length);
	if (index === null) return null;
	const key = days[index];
	// The timeline can change under a drag; a stale index must refuse, not guess.
	return key == null ? null : { index, key };
}
