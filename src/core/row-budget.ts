// How many body rows a block draws when there is not room for all of them. Pure.
//
// A block used to clip its last row instead of counting it, so it silently
// showed fewer rows than its "+N more" claimed.

/**
 * Body rows a collapsed block may draw.
 *
 * When anything is hidden, one row of space is reserved for the "+N more" line —
 * otherwise the counter itself is what gets clipped, and the block silently
 * shows fewer rows than it claims.
 */
export function visibleRowCount(total: number, fits: number, max: number): number {
	const room = Math.max(0, Math.min(fits, max));
	if (total <= room) return Math.min(total, max);
	return Math.max(0, room - 1);
}

/**
 * The drawn height of one body row, and of a block's head, in pixels.
 *
 * These are hand-derived from styles.css and are the reason a type change is not
 * a cosmetic change: they decide how many rows every block builds, so a 1px
 * error silently clips or hides a row in every block on screen.
 *
 *   ROW_PX  = `--tn-font-xs` (0.72rem ≈ 11.5px) × `.tn-body-row` line-height 1.3
 *   HEAD_PX = the same, plus `.tn-block-head`'s vertical padding
 *
 * Both are rounded UP: over-estimating hides a row, under-estimating clips one.
 * tests/row-budget.test.ts pins the three CSS values they were measured from, so
 * changing one of those fails here rather than in the user's timeline.
 *
 * Reading the heights back from the DOM was the alternative, and was rejected:
 * `visibleRowCount` is pure and unit-tested without a DOM, and a measure-then-
 * render pass in TimeGrid's hot path costs far more than a pinned test.
 */
export const ROW_PX = 16;
export const HEAD_PX = 20;

/**
 * The drawn height of one month-cell chip, and of the day-number button above it.
 *
 * Same kind of welded constant as ROW_PX above, for the same reason: the month
 * grid has to decide how many chips fit BEFORE it draws them, and a cell is
 * `overflow: hidden`. Get these wrong and chips are silently clipped — which is
 * exactly what happened while the count was a fixed 4 regardless of cell height.
 *
 *   CAL_CHIP_PX   = `--tn-font-s` × line-height (~17px)
 *                   + .tn-cal-chip's 1px padding above and below   (2px)
 *                   + its 1px border above and below               (2px)
 *                   + the list's --tn-space-1 gap                  (2px)
 *   CAL_DAYNUM_PX = the .tn-cal-daynum button above the list
 *
 * Two corrections live in that sum. It used to name `--tn-font-xs`, a token that
 * no longer exists — it was collapsed into `--tn-font-s`, one step LARGER than
 * this budget assumed. And the chip had `border: none` when the number was first
 * written; it now carries the same hairline a block does, which is another 2px.
 *
 * Rounded UP, so a miscalculation hides a chip behind an honest "+N more" rather
 * than clipping one with no counter at all.
 */
export const CAL_CHIP_PX = 24;
/**
 * The same chip on a touch device, where `@media (pointer: coarse)` adds
 * `padding-block: var(--tn-space-2)` — 4px top and bottom.
 *
 * The third correction to this sum, and the first that is not a constant: the
 * budget over-counted by ~20% on a phone, so a month cell drew more chips than
 * fit and clipped one with NO counter — exactly the failure CAL_CHIP_PX is
 * rounded up to avoid.
 */
export const CAL_CHIP_COARSE_PX = CAL_CHIP_PX + 8;
export const CAL_DAYNUM_PX = 22;

/**
 * The shortest block that still has room for its `10:00–11:00` label.
 *
 * Two lines of head: the time and the title cannot share one line on a narrow
 * column without the title being clipped to nothing, and a block this short has
 * exactly one line to spend.
 */
const TIME_LABEL_MIN_PX = HEAD_PX * 2;

/**
 * Should a block of this pixel height draw its time label?
 *
 * The label is the least informative thing in the head — the block's POSITION
 * and HEIGHT already state its range, and so do the tooltip and the aria-label.
 * On a short block it was competing with the one thing that is not redundant,
 * the title, so below the threshold the title takes the space.
 *
 * A pure predicate rather than a CSS container query because a block would have
 * to become a size container to be queried, which forces layout containment on
 * every block in the grid.
 */
export function showsTimeLabel(blockPx: number): boolean {
	return blockPx >= TIME_LABEL_MIN_PX;
}
