// THE SETTING THAT ONLY WORKED ON AN EMPTY DAY.
//
// "Insert new event lines in start-time order" (`sortPlannerLinesOnInsert`)
// reaches `insertTimedBlockResult` as `options.sorted`. It was forwarded ONLY on
// the `point.fallback` branch — i.e. when no timed line existed to anchor
// against. So the toggle governed exactly the case with nothing to sort, and the
// moment a note held one timed row it was ignored: a 10:00 block still slotted
// itself between the 09:00 and 13:00 lines however the switch was set.
//
// Switching it off now appends within the planner section, which is what the
// setting's name has always said.

import { describe, it, expect } from 'vitest';
import { insertTimedBlockResult } from '../src/core/planner-section';

const HEADING = '## Day planner';
const NOTE = [HEADING, '- [ ] 09:00 - 10:00 standup', '- [ ] 13:00 - 14:00 review', ''].join('\n');

const lineIndex = (text: string, needle: string) =>
	text.split('\n').findIndex((l) => l.includes(needle));

describe('sorted: true — time-ordered placement (the default)', () => {
	it('slots a 10:00 block between the 09:00 and 13:00 rows', () => {
		const r = insertTimedBlockResult(NOTE, HEADING, ['- [ ] 10:00 - 11:00 new'], 600, {
			sorted: true,
			startMinutes: 600,
		});
		expect(r.inserted).toBe(true);
		expect(lineIndex(r.text, 'new')).toBeGreaterThan(lineIndex(r.text, 'standup'));
		expect(lineIndex(r.text, 'new')).toBeLessThan(lineIndex(r.text, 'review'));
	});
});

describe('sorted: false — THE FIX: the toggle is honoured', () => {
	it('appends after the existing rows instead of slotting by time', () => {
		const r = insertTimedBlockResult(NOTE, HEADING, ['- [ ] 10:00 - 11:00 new'], 600, {
			sorted: false,
			startMinutes: 600,
		});
		expect(r.inserted).toBe(true);
		// The whole point: it lands AFTER 13:00, not between 09:00 and 13:00.
		expect(lineIndex(r.text, 'new')).toBeGreaterThan(lineIndex(r.text, 'review'));
	});

	it('still refuses to duplicate a line the note already has', () => {
		const r = insertTimedBlockResult(NOTE, HEADING, ['- [ ] 09:00 - 10:00 standup'], 540, {
			sorted: false,
			startMinutes: 540,
		});
		expect(r.inserted).toBe(false);
		expect(r.reason).toBe('duplicate');
		expect(r.text).toBe(NOTE);
	});

	it('still carries a block’s sub-items with it', () => {
		const r = insertTimedBlockResult(
			NOTE,
			HEADING,
			['- [ ] 10:00 - 11:00 new', '\t- [ ] a sub-item'],
			600,
			{ sorted: false, startMinutes: 600 },
		);
		expect(r.inserted).toBe(true);
		expect(lineIndex(r.text, 'a sub-item')).toBe(lineIndex(r.text, '10:00 - 11:00 new') + 1);
	});

	it('an empty day behaves the same either way — nothing to sort', () => {
		const empty = `${HEADING}\n`;
		const on = insertTimedBlockResult(empty, HEADING, ['- [ ] 10:00 x'], 600, { sorted: true });
		const off = insertTimedBlockResult(empty, HEADING, ['- [ ] 10:00 x'], 600, { sorted: false });
		expect(off.text).toBe(on.text);
	});

	it('omitting the option keeps the old, time-ordered behaviour', () => {
		const r = insertTimedBlockResult(NOTE, HEADING, ['- [ ] 10:00 - 11:00 new'], 600, {
			startMinutes: 600,
		});
		expect(lineIndex(r.text, 'new')).toBeLessThan(lineIndex(r.text, 'review'));
	});
});
