import { describe, it, expect } from 'vitest';
import { decideReconcile } from '../src/core/sync-decisions';
import { hasScheduledDatePart, expectedEventBasename, parseEventBasename } from '../src/core/event-filename';
import { DEFAULT_SETTINGS } from '../src/settings/settings';

const FORMAT = DEFAULT_SETTINGS.scheduledTaskFormat;

/** The literal filename linked from the real daily-note template. */
const FREE_NAME = '📅 Attend - 1h - monthly planning at Logisitsy - First mon at 08.00h ✍️';
const GRAMMAR_NAME = '📅 By 2026-09-07 at 09.00h, prepare - 1 - deck';

describe('hasScheduledDatePart', () => {
	it('is false for a 📅 note that never used the date grammar', () => {
		expect(hasScheduledDatePart(FREE_NAME, FORMAT)).toBe(false);
		expect(hasScheduledDatePart('📅 Schedule & document - 1 meetup - with a friend 🏃‍♂️', FORMAT)).toBe(false);
	});

	it('is true for every shape of the grammar', () => {
		expect(hasScheduledDatePart(GRAMMAR_NAME, FORMAT)).toBe(true);
		expect(hasScheduledDatePart('📅 By 2026-07-23, review - 1 - budget', FORMAT)).toBe(true);
		expect(hasScheduledDatePart('📅 By 2026-07-28 at 07.15h - 2026-07-29, attend - 1 - conference', FORMAT)).toBe(true);
		expect(hasScheduledDatePart('🅰️ 📅 By 2026-07-27 at 15.00h, focus - 1 - deepwork', FORMAT)).toBe(true);
	});
});

describe('decideReconcile never imposes the grammar', () => {
	it('THE BUG: leaves a freely-named 📅 note alone', () => {
		// Before the guard this returned a rename to
		// "📅 By 2026-09-07, attend - 1h - monthly planning at Logisitsy …",
		// and Obsidian would then rewrite the link inside the user's template.
		const decisions = decideReconcile(
			'2026-09-07',
			[{ lineNo: 11, startMinutes: null, targetBasename: FREE_NAME }],
			FORMAT,
		);
		expect(decisions).toEqual([]);
	});

	it('leaves it alone even when the line carries a time', () => {
		expect(
			decideReconcile('2026-09-07', [{ lineNo: 11, startMinutes: 480, targetBasename: FREE_NAME }], FORMAT),
		).toEqual([]);
	});

	it('still keeps a grammared note truthful — the guard does not disable reconcile', () => {
		const decisions = decideReconcile(
			'2026-09-08',
			[{ lineNo: 3, startMinutes: 10 * 60, targetBasename: GRAMMAR_NAME }],
			FORMAT,
		);
		expect(decisions).toEqual([
			{
				lineNo: 3,
				fromBasename: GRAMMAR_NAME,
				toBasename: '📅 By 2026-09-08 at 10.00h, prepare - 1 - deck',
			},
		]);
	});

	it('is still a fixpoint: applying a decision twice changes nothing', () => {
		const first = decideReconcile(
			'2026-09-08',
			[{ lineNo: 3, startMinutes: 600, targetBasename: GRAMMAR_NAME }],
			FORMAT,
		);
		const second = decideReconcile(
			'2026-09-08',
			[{ lineNo: 3, startMinutes: 600, targetBasename: first[0].toBasename }],
			FORMAT,
		);
		expect(second).toEqual([]);
	});

	it('the two guards agree: a name reconcile skips is one expectedEventBasename would change', () => {
		// Proof the guard is load-bearing rather than cosmetic.
		const expected = expectedEventBasename(parseEventBasename(FREE_NAME, FORMAT), '2026-09-07', null, FORMAT);
		expect(expected).not.toBe(FREE_NAME);
		expect(decideReconcile('2026-09-07', [{ lineNo: 0, startMinutes: null, targetBasename: FREE_NAME }], FORMAT)).toEqual([]);
	});
});
