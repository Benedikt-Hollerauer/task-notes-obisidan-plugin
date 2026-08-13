import { describe, it, expect } from 'vitest';
import { mergeViewState } from '../src/ui/views/context';
import type { TimelineViewState } from '../src/ui/views/context';

const LIVE: TimelineViewState = {
	range: 'week',
	anchor: '2026-08-11',
	calendarOpen: true,
	laneHeight: 240,
};

describe('mergeViewState — absent is not the same as null', () => {
	it('keeps the live value for a key the payload does not mention', () => {
		expect(mergeViewState(LIVE, { range: 'day' })).toEqual({ ...LIVE, range: 'day' });
	});

	it('THE BUG: an explicit null hands the lane back to automatic', () => {
		// Keying on `typeof === 'number'` meant that once the lane had been dragged
		// to 240, no restore could ever put it back to "size yourself to your items".
		expect(mergeViewState(LIVE, { laneHeight: null }).laneHeight).toBeNull();
	});

	it('applies an explicit number', () => {
		expect(mergeViewState(LIVE, { laneHeight: 96 }).laneHeight).toBe(96);
	});

	it('never treats calendarOpen: false as absent', () => {
		expect(mergeViewState(LIVE, { calendarOpen: false }).calendarOpen).toBe(false);
		expect(mergeViewState({ ...LIVE, calendarOpen: false }, {}).calendarOpen).toBe(false);
	});

	it('survives the empty, null and undefined payloads Obsidian can hand back', () => {
		for (const payload of [{}, null, undefined]) {
			expect(mergeViewState(LIVE, payload)).toEqual(LIVE);
		}
	});

	it('round-trips its own output, so a restore is stable', () => {
		const once = mergeViewState(LIVE, { laneHeight: null, range: 'day' });
		expect(mergeViewState(once, once)).toEqual(once);
	});

	it('ignores an empty anchor or range rather than blanking the view', () => {
		expect(mergeViewState(LIVE, { anchor: '' }).anchor).toBe(LIVE.anchor);
	});
});
