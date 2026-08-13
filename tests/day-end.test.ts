// THE BLOCK THAT SHRANK EVERY TIME YOU DRAGGED IT.
//
// The day window's `endMin` is exactly 1440 (MINUTES_PER_DAY), so a block dragged
// to the bottom of the day is DRAWN ending at 1440. `minutesToColon` clamped to
// 1439 and wrote "23:59" — one minute short of what was on screen.
//
// That mismatch ratchets. The line is re-read, so 23:59 becomes the block's real
// end; the next drag carries a 59-minute duration and writes 23:58; the next 23:57.
// A linked 📅 note has this fed into its filename sync too.
//
// End-of-day already had a representation the parser round-trips — `00:00`, which
// reads back as end 0 — so the fix is to write that instead of inventing 23:59.

import { describe, it, expect } from 'vitest';
import { minutesToColon, MINUTES_PER_DAY } from '../src/core/timestamps';
import { parsePlannerLine, serializePlannerLine } from '../src/core/planner-line';
import { fitBlockInWindow } from '../src/core/day-window';

describe('midnight is 00:00, not 23:59', () => {
	it('THE BUG: the end of the day no longer serializes one minute short', () => {
		expect(minutesToColon(MINUTES_PER_DAY)).toBe('00:00');
	});

	it('23:59 is still 23:59 — only the 1440 boundary moved', () => {
		expect(minutesToColon(MINUTES_PER_DAY - 1)).toBe('23:59');
		expect(minutesToColon(0)).toBe('00:00');
		expect(minutesToColon(540)).toBe('09:00');
	});

	it('out-of-range values are still clamped rather than wrapping wildly', () => {
		expect(minutesToColon(MINUTES_PER_DAY + 60)).toBe('23:59');
		expect(minutesToColon(-30)).toBe('00:00');
	});
});

describe('a block dragged to the bottom of the day keeps its length', () => {
	/** One drag: fit the block in the window, write it, read it back. */
	function dragToBottom(startMin: number, durationMin: number) {
		const win = { startMin: 0, endMin: MINUTES_PER_DAY };
		const fitted = fitBlockInWindow(win, startMin, durationMin);
		const line = serializePlannerLine({
			indent: '',
			checkbox: ' ',
			startMinutes: fitted.start,
			endMinutes: fitted.end,
			text: 'Wind down',
			lineNo: 0,
		} as never);
		const back = parsePlannerLine(line, 0)!;
		const end = back.endMinutes === 0 ? MINUTES_PER_DAY : back.endMinutes!;
		return { line, start: back.startMinutes!, end, length: end - back.startMinutes! };
	}

	it('THE RATCHET: dragging repeatedly does not shave a minute each time', () => {
		let d = dragToBottom(1400, 60); // start beyond the last slot -> pinned to the bottom
		expect(d.length).toBe(60);
		// Drag it to the bottom again, carrying whatever length survived.
		for (let i = 0; i < 5; i++) {
			d = dragToBottom(1400, d.length);
			expect(d.length, `after ${i + 2} drags`).toBe(60);
		}
	});

	it('and it writes the readable end-of-day form', () => {
		expect(dragToBottom(1400, 60).line).toContain('23:00 - 00:00');
	});

	it('a block that does not reach the bottom is untouched', () => {
		const d = dragToBottom(540, 60);
		expect(d.line).toContain('09:00 - 10:00');
		expect(d.length).toBe(60);
	});
});
