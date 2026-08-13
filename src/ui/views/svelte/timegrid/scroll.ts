// Where the time grid should scroll to. Pure, so the arithmetic is testable.

/** Fraction of the viewport the target time sits below the top edge. */
const TARGET_OFFSET = 1 / 3;

/**
 * Scroll offset that brings `minutes` into view, placed a third of the way down
 * so there is context above and room below, clamped to the scrollable range.
 */
export function scrollTopFor(
	minutes: number,
	hourHeightPx: number,
	viewportPx: number,
	contentPx: number,
): number {
	const y = (minutes / 60) * hourHeightPx;
	const target = y - viewportPx * TARGET_OFFSET;
	const max = Math.max(0, contentPx - viewportPx);
	return Math.min(Math.max(target, 0), max);
}

/**
 * The scrollTop that keeps the same MINUTE under the top edge when the drawn
 * window's first minute changes.
 *
 * Not a scroll request: the grid deliberately never re-targets the viewport on a
 * data rebuild. This is the opposite — a flush that widens the window shifts
 * every block by hundreds of pixels while scrollTop stays put, so the user ends
 * up looking at a different time BECAUSE nothing scrolled. This is the
 * correction that makes the rebuild invisible.
 */
export function scrollTopAfterWindowShift(
	scrollTop: number,
	prevStartMin: number,
	nextStartMin: number,
	hourHeightPx: number,
	viewportPx: number,
	contentPx: number,
): number {
	const delta = ((prevStartMin - nextStartMin) / 60) * hourHeightPx;
	const max = Math.max(0, contentPx - viewportPx);
	return Math.min(Math.max(scrollTop + delta, 0), max);
}
