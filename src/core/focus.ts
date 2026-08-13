// The rule for "which day is the user looking at". Pure (no Obsidian imports).
//
// Views used to be islands: the sidebar had its own month, the timeline its own
// anchor, and neither knew about the other. One shared focus makes them one
// system — but a shared value that every view both reads and writes is a
// feedback loop waiting to happen, so the policy lives here as a pure reducer
// that can be reasoned about and tested on its own.

/** Who moved the focus. The source decides how far the change propagates. */
export type FocusSource = 'timeline' | 'sidebar' | 'file-open' | 'command';

export interface DayFocus {
	/** YYYY-MM-DD */
	key: string;
	source: FocusSource;
	/** Monotonic; lets consumers ignore a focus they already applied. */
	seq: number;
}

export function initialFocus(key: string): DayFocus {
	return { key, source: 'command', seq: 0 };
}

/**
 * The next focus, or null when nothing should be published.
 *
 * Loop guard #1: re-focusing the day that is already focused publishes nothing,
 * so a view echoing back what it just received cannot start a cycle.
 */
export function nextFocus(
	current: DayFocus,
	key: string,
	source: FocusSource,
	force = false,
): DayFocus | null {
	if (key === current.key && !force) return null;
	return { key, source, seq: current.seq + 1 };
}

/**
 * Should the timeline move its anchor to this focus?
 *
 * - Opening a note never yanks the timeline: it highlights, so browsing notes
 *   doesn't fight the position the user scrolled to.
 * - A click in the sidebar only moves the timeline when the day isn't already
 *   on screen — clicking Thursday of the visible week shouldn't re-anchor it.
 * - The timeline itself is the origin of its own moves, so it never re-applies.
 */
export function shouldMoveAnchor(focus: DayFocus, bounds: { from: string; to: string }): boolean {
	switch (focus.source) {
		case 'file-open':
		case 'timeline':
			return false;
		case 'command':
			return true;
		case 'sidebar':
			return focus.key < bounds.from || focus.key > bounds.to;
	}
}

/** Should a month calendar page to the focused day's month? */
export function shouldPageMonth(focus: DayFocus, visibleMonthKey: string): boolean {
	return focus.key.slice(0, 7) !== visibleMonthKey.slice(0, 7);
}
