import { describe, it, expect } from 'vitest';
import { clampLaneHeight, laneMaxPx, LANE_MIN_PX, LANE_MAX_FRACTION } from '../src/core/lane';

const PANE = 800;
const maxFor = (pane: number) => Math.floor(pane * LANE_MAX_FRACTION);

describe('laneMaxPx — the lane answers to the PANE, not the window', () => {
	it('THE RULE: a short pane gets a short lane, with no interaction at all', () => {
		// The bug this replaces: `max-height: 33vh` is a share of the WINDOW, so
		// splitting a pane left the lane at full height and squeezed the grid to
		// nothing. Every one of these used to be the same number.
		expect(laneMaxPx(800)).toBe(maxFor(800));
		expect(laneMaxPx(400)).toBe(maxFor(400));
		expect(laneMaxPx(200)).toBe(maxFor(200));
	});

	it('gives the minimum even to a pane too short to afford it', () => {
		// Otherwise all-day items would vanish with no way to bring them back.
		expect(laneMaxPx(20)).toBe(LANE_MIN_PX);
		expect(laneMaxPx(0)).toBe(LANE_MIN_PX);
	});

	it('survives a pane that has not been measured yet', () => {
		expect(laneMaxPx(Number.NaN)).toBe(LANE_MIN_PX);
	});
});

describe('clampLaneHeight — only ever answers for a height the user asked for', () => {
	it('honours a dragged height', () => {
		expect(clampLaneHeight(250, PANE)).toBe(250);
	});

	it('caps a drag at the pane share, so the grid always keeps half', () => {
		expect(clampLaneHeight(10_000, PANE)).toBe(maxFor(PANE));
	});

	it('never collapses the lane out of existence', () => {
		expect(clampLaneHeight(0, PANE)).toBe(LANE_MIN_PX);
		expect(clampLaneHeight(-500, PANE)).toBe(LANE_MIN_PX);
	});

	it('always returns a whole number of pixels', () => {
		expect(clampLaneHeight(123.4, PANE)).toBe(123);
		expect(Number.isInteger(clampLaneHeight(99.7, PANE))).toBe(true);
	});

	it('falls back to a sane default for a nonsense request', () => {
		expect(clampLaneHeight(Number.NaN, PANE)).toBeGreaterThanOrEqual(LANE_MIN_PX);
		expect(clampLaneHeight(Number.NaN, PANE)).toBeLessThanOrEqual(maxFor(PANE));
	});

	it('THE RATCHET: clamping a clamped height changes nothing', () => {
		// This is exactly the property the old signature violated. It took a
		// `contentPx`, and the caller measured `scrollHeight` of the element it had
		// just sized — so every drag raised the floor, "fit to its items" became a
		// no-op, and the button that would have undone it hid itself.
		for (const pane of [0, 120, 200, 800, 2000]) {
			for (const requested of [-100, 0, 10, 28, 99.7, 240, 1000, 10_000]) {
				const once = clampLaneHeight(requested, pane);
				expect(clampLaneHeight(once, pane)).toBe(once);
			}
		}
	});

	it('a dragged height never depends on what the lane is currently showing', () => {
		// There is deliberately no way to pass content in, so this cannot regress.
		expect(clampLaneHeight.length).toBe(2);
	});
});
