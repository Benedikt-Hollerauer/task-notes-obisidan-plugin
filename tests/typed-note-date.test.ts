// THE UNDATED 📅 NOTE.
//
// `📅 Rrwar - rwar - arw` turned up in the test vault: a scheduled note whose
// name carries no date. The scheduled format is
//
//     By {date} (at {time} - {range}), {action} - {amount} - {outcome}
//
// and `generateTaskName` drops the whole "By …," clause when `startDate` is
// empty — so a caller that forgot the date wrote a 📅 note whose name says
// nothing about when it happens. It is still recognised AS a 📅 note (that check
// reads the emoji alone), but `hasScheduledDatePart` is false, so the filename
// carries no schedule for the planner line to agree or disagree with.
//
// `createTypedNoteBlock` resolved the date TWICE and differently — the name came
// from the properties as given, the planner line fell back to the dragged day —
// so the note could be named undated and linked dated. These pin the arithmetic
// that fix depends on.

import { describe, it, expect } from 'vitest';
import { generateTaskName } from '../src/core/task-name';
import { isScheduledBasename, hasScheduledDatePart } from '../src/core/event-filename';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { TASK_EMOJIS } from '../src/constants';

const FORMAT = DEFAULT_SETTINGS.scheduledTaskFormat;
const BASE = { actionWords: 'rrwar', amount: 'rwar', amountOutcome: 'arw' };

describe('a 📅 name without a date', () => {
	it('THE BUG: an empty startDate silently drops the date clause', () => {
		expect(generateTaskName({ ...BASE }, FORMAT)).toBe('rrwar - rwar - arw');
		expect(generateTaskName({ ...BASE, startDate: '' }, FORMAT)).toBe('rrwar - rwar - arw');
	});

	it('…and the result is a 📅 note that carries no date at all', () => {
		const orphan = `${TASK_EMOJIS.SCHEDULED} ${generateTaskName({ ...BASE }, FORMAT)}`;
		// Still a scheduled note — that predicate reads the emoji, nothing more.
		expect(isScheduledBasename(orphan)).toBe(true);
		// But the part that matters is gone: nothing in the name says when.
		expect(hasScheduledDatePart(orphan, FORMAT)).toBe(false);
	});

	it('with a date it round-trips and IS recognised', () => {
		const name = generateTaskName({ ...BASE, startDate: '2026-08-12', time: '10.30h' }, FORMAT);
		expect(name).toBe('By 2026-08-12 at 10.30h, rrwar - rwar - arw');
		expect(hasScheduledDatePart(`${TASK_EMOJIS.SCHEDULED} ${name}`, FORMAT)).toBe(true);
	});

	it('THE FIX, as arithmetic: `startDate || fallback` covers both empty forms', () => {
		// `??` is not enough — the form hands back `''`, not undefined, for a date
		// input the user cleared, and `'' ?? x` is `''`.
		const dragged = '2026-08-12';
		for (const given of [undefined, '']) {
			const resolved = given || dragged;
			expect(resolved).toBe(dragged);
			const name = generateTaskName({ ...BASE, startDate: resolved }, FORMAT);
			expect(hasScheduledDatePart(`${TASK_EMOJIS.SCHEDULED} ${name}`, FORMAT), String(given)).toBe(
				true,
			);
		}
		// …and a real date is never overwritten by the fallback.
		const given: string | undefined = '2026-01-01';
		expect(given || dragged).toBe('2026-01-01');
	});
});
