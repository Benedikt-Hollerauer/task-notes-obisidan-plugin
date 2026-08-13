// THE CLICK THAT STRIPPED A TIME.
//
// Starting a move drag MOUNTS the all-day lane, because the lane is the drop
// target (`laneVisible = hasAllDay || drag?.mode === 'move'`). On a day with no
// all-day items that lane appears out of nothing and pushes the whole grid down
// by its height — about 30px — while the pointer has not moved at all.
//
// A press on a block near the top of the scroller was therefore INSIDE the lane
// by the time the first pointermove ran, and the release took the lane branch,
// which sits before the "did it actually move?" check. Clicking a 09:00 block
// rewrote its planner line to have no time.
//
// The fix is the slop test that already guards every other click. This pins the
// arithmetic it depends on: the slop must stay far below the lane's height, or
// the guard silently stops guarding.

import { describe, it, expect } from 'vitest';
import { isClickGesture, slopFor } from '../src/core/chip-drag';

/**
 * `.tn-allday-row` min-height (28px) plus its padding and bottom border. The
 * smallest vertical shift the lane can cause when it mounts.
 */
const LANE_SHIFT_PX = 28;

describe('click slop vs the lane that appears under the pointer', () => {
	it('a motionless press is a click for every pointer type', () => {
		const at = { x: 400, y: 120 };
		for (const type of ['mouse', 'touch', 'pen', undefined]) {
			expect(isClickGesture(at, at, type), String(type)).toBe(true);
		}
	});

	it('THE ARITHMETIC: slop is far below the shift the lane causes', () => {
		// If slop ever grew past the lane's height, a genuine short drag into the
		// lane would be dismissed as a click — and worse, the guard would start
		// depending on which of the two numbers moved last.
		for (const type of ['mouse', 'touch', 'pen']) {
			expect(slopFor(type), type).toBeLessThan(LANE_SHIFT_PX);
		}
	});

	it('a deliberate drag into the lane is still a drag', () => {
		const from = { x: 400, y: 120 };
		for (const type of ['mouse', 'touch', 'pen']) {
			const to = { x: 400, y: from.y - LANE_SHIFT_PX };
			expect(isClickGesture(from, to, type), type).toBe(false);
		}
	});

	it('is symmetric — the direction of travel cannot matter', () => {
		// The lane sits ABOVE the grid, so the shift is upward; a rule that only
		// measured downward travel would miss exactly this bug.
		const from = { x: 400, y: 120 };
		expect(isClickGesture(from, { x: 400, y: 120 - LANE_SHIFT_PX }, 'mouse')).toBe(false);
		expect(isClickGesture(from, { x: 400, y: 120 + LANE_SHIFT_PX }, 'mouse')).toBe(false);
	});

	it('touch is looser than mouse, because a finger is', () => {
		expect(slopFor('touch')).toBeGreaterThan(slopFor('mouse'));
		expect(slopFor('pen')).toBe(slopFor('touch'));
	});
});
