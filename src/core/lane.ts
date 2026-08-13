// How tall the all-day lane may be. Pure (no Obsidian imports).
//
// Its cap used to be `33vh` — a share of the WINDOW. Splitting a pane, or
// docking the timeline under something, could not shrink it: the lane kept its
// full height and squeezed the grid below it toward nothing.

/** Never smaller than this, or the lane stops being a lane. */
export const LANE_MIN_PX = 28;
/** Never more of the pane than this, so the grid always keeps most of it. */
export const LANE_MAX_FRACTION = 0.5;
/** What a drag starts from when the lane has never been measured. */
export const LANE_DEFAULT_PX = 96;

/**
 * The tallest the lane may be in a pane of `panePx`.
 *
 * Also published to CSS as `--tn-lane-max`, because the AUTOMATIC lane is sized
 * by CSS (`height: auto` under this cap) rather than by a measurement — see
 * `clampLaneHeight`.
 */
export function laneMaxPx(panePx: number): number {
	// A pane too short for even the minimum still gets the minimum: a lane that
	// collapsed to nothing would hide all-day items with no way to get them back.
	if (!Number.isFinite(panePx)) return LANE_MIN_PX;
	return Math.max(LANE_MIN_PX, Math.floor(panePx * LANE_MAX_FRACTION));
}

/**
 * The height a DRAGGED lane gets.
 *
 * There is deliberately no `contentPx` parameter. It used to take one, and the
 * caller measured `scrollHeight` of the very element it had just given a height
 * to — and `scrollHeight >= clientHeight` always, so after a drag the "content"
 * became the dragged height and "fit to its items" was a no-op that then hid its
 * own button. The automatic lane is CSS's job; this function only ever answers
 * for a height the user asked for, which makes it idempotent by construction.
 */
export function clampLaneHeight(requested: number, panePx: number): number {
	const max = laneMaxPx(panePx);
	if (!Number.isFinite(requested)) return Math.min(LANE_DEFAULT_PX, max);
	return Math.min(Math.max(Math.round(requested), LANE_MIN_PX), max);
}
