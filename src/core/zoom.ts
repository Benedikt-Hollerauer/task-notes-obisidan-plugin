// Time-grid zoom: how tall an hour is drawn. Pure (no Obsidian imports).
//
// Zooming is the one gesture that changes the mapping between minutes and
// pixels while the user is looking at it. Doing that without moving the
// scrollTop makes the grid appear to jump to a different time BECAUSE nothing
// scrolled — so every zoom step comes with the correction that holds whatever
// the pointer was over exactly where it was.

/** The same bounds the settings slider offers, so the two can never disagree. */
export const HOUR_HEIGHT_MIN = 30;
export const HOUR_HEIGHT_MAX = 800;
/** The slider's granularity. One wheel notch moves by a PROPORTION, not this. */
export const HOUR_HEIGHT_STEP = 5;

/**
 * One zoom step, clamped.
 *
 * Proportional, not a fixed number of pixels: over a 30→800 range a flat step
 * is either imperceptible at the top or violent at the bottom. 25% per notch
 * takes about ten notches to cross the whole range at either end.
 */
export function nextHourHeight(current: number, direction: 1 | -1): number {
	const from = Number.isFinite(current) ? current : 60;
	const scaled = direction > 0 ? from * 1.25 : from / 1.25;
	// Round to the slider's grid so the two controls always agree on a value,
	// and away from `from` so a small height can never round back onto itself.
	const stepped =
		direction > 0
			? Math.ceil(scaled / HOUR_HEIGHT_STEP) * HOUR_HEIGHT_STEP
			: Math.floor(scaled / HOUR_HEIGHT_STEP) * HOUR_HEIGHT_STEP;
	return Math.min(Math.max(stepped, HOUR_HEIGHT_MIN), HOUR_HEIGHT_MAX);
}

/**
 * Where to scroll after the hour height changes, so the point `anchorOffsetPx`
 * below the top of the viewport keeps showing the same time.
 *
 * `anchorOffsetPx` is the pointer's offset inside the viewport for a wheel
 * zoom; pass half the viewport for a button, which holds the middle of the
 * screen still instead of the top edge.
 */
export function scrollTopAfterZoom(
	scrollTop: number,
	anchorOffsetPx: number,
	prevHourHeightPx: number,
	nextHourHeightPx: number,
	viewportPx: number,
	nextContentPx: number,
): number {
	if (prevHourHeightPx <= 0) return scrollTop;
	const ratio = nextHourHeightPx / prevHourHeightPx;
	// The anchor's distance from the top of the CONTENT scales with the zoom;
	// its distance from the top of the VIEWPORT must not change at all.
	const anchored = (scrollTop + anchorOffsetPx) * ratio - anchorOffsetPx;
	const max = Math.max(0, nextContentPx - viewportPx);
	return Math.min(Math.max(anchored, 0), max);
}
