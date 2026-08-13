import { describe, it, expect } from 'vitest';
import { decideReconcile, renameableLines } from '../src/core/sync-decisions';
import { scanDayLines } from '../src/core/planner-section';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { renameTimeIntent } from '../src/core/event-filename';

const HEADING = '## Day planner';
const FORMAT = DEFAULT_SETTINGS.scheduledTaskFormat;
const DECK = '📅 By 2026-07-24 at 10.00h, prepare - 1 - deck';

/** A block whose only claim on the 📅 file is a row nested inside it. */
const NESTED_ONLY = [
	HEADING,
	'- [ ] 08:00 - 09:00 Morning',
	`\t- [ ] 10:00 [[${DECK}]]`,
	'',
].join('\n');

/** The same file claimed by a top-level line as well. */
const ALSO_VISIBLE = [
	HEADING,
	`- [ ] 09:00 - 10:00 [[${DECK}]]`,
	'- [ ] 11:00 - 12:00 Afternoon',
	`\t- [ ] 11:30 [[${DECK}]]`,
	'',
].join('\n');

const planOf = (text: string) => {
	const { plannerLines, tree } = scanDayLines(text, HEADING);
	return { lines: plannerLines, tree };
};

describe('renameableLines — you cannot see it, so it does not rename anything', () => {
	it('keeps the block, drops the row nested inside it', () => {
		const plan = planOf(NESTED_ONLY);
		expect(plan.lines).toHaveLength(2);
		expect(renameableLines(plan).map((l) => l.text)).toEqual(['Morning']);
	});

	it('keeps a top-level claim even when another claim is nested', () => {
		expect(renameableLines(planOf(ALSO_VISIBLE)).map((l) => l.text)).toEqual([
			`[[${DECK}]]`,
			'Afternoon',
		]);
	});

	it('does not turn reconcile off wholesale', () => {
		const plan = planOf(`${HEADING}\n- [ ] 09:00 - 10:00 A\n- [ ] 11:00 - 12:00 B\n`);
		expect(renameableLines(plan)).toHaveLength(2);
	});
});

describe('THE BUG: a nested claim used to rename an invisible file', () => {
	const nestedLine = planOf(NESTED_ONLY).lines.find((l) => l.text.includes(DECK))!;

	it('feeding every planner line renames it to the day plan date — what used to happen', () => {
		const decisions = decideReconcile(
			'2026-08-01',
			[{ lineNo: nestedLine.lineNo, startMinutes: 600, targetBasename: DECK, duplicate: false }],
			FORMAT,
		);
		// The file is drawn nowhere as a block of its own, yet its name changes.
		expect(decisions).toHaveLength(1);
		expect(decisions[0].toBasename).toContain('By 2026-08-01');
	});

	it('feeding only renameable lines leaves it alone', () => {
		const plan = planOf(NESTED_ONLY);
		const allowed = renameableLines(plan).filter((l) => l.text.includes(DECK));
		expect(allowed).toEqual([]);
		expect(decideReconcile('2026-08-01', [], FORMAT)).toEqual([]);
	});
});

describe('ownership still counts every claimant', () => {
	it('one visible + one nested claim is still a duplicate', () => {
		// This is the test that fails if somebody "simplifies" claimCounts to count
		// only visible claimants: the file would lose its duplicate flag and the two
		// lines would rename it back and forth until the circuit breaker fired.
		const plan = planOf(ALSO_VISIBLE);
		const claimants = plan.lines.filter((l) => l.text.includes(DECK));
		expect(claimants).toHaveLength(2);

		const visible = renameableLines(plan).find((l) => l.text.includes(DECK))!;
		const decisions = decideReconcile(
			'2026-08-01',
			[
				{
					lineNo: visible.lineNo,
					startMinutes: visible.startMinutes,
					targetBasename: DECK,
					// claimCounts counted BOTH claims, so this is true.
					duplicate: claimants.length > 1,
				},
			],
			FORMAT,
		);
		expect(decisions).toEqual([]);
	});
});

describe('renameTimeIntent — editing the NAME is how you change the line', () => {
	// Reported: "when renaming the note by removing the `at 08.00` it automatically
	// appears again". It did: the line kept its time, reconcile rebuilt the name
	// from that line, and the deleted time came back within a second. There was no
	// way to say "this has no time any more" by editing the filename.
	const FMT = DEFAULT_SETTINGS.scheduledTaskFormat;
	const TIMED = '📅 By 2026-09-03 at 08.00h, test - test - tset';
	const UNTIMED = '📅 By 2026-09-03, test - test - tset';

	it('THE BUG: deleting the time clears the line, instead of being undone', () => {
		expect(renameTimeIntent(TIMED, UNTIMED, FMT)).toEqual({ action: 'clear' });
	});

	it('a new time is written onto the line', () => {
		expect(renameTimeIntent(TIMED, '📅 By 2026-09-03 at 14.15h, test - test - tset', FMT)).toEqual({
			action: 'set',
			minutes: 855,
		});
	});

	it('adding a time to a note that had none also sets it', () => {
		expect(renameTimeIntent(UNTIMED, TIMED, FMT)).toEqual({ action: 'set', minutes: 480 });
	});

	it('THE GUARD THIS MUST NOT BREAK: a note that never had a time changes nothing', () => {
		// The line may be untimed BECAUSE the user dragged the block into the
		// all-day lane. Renaming such a note (a properties Apply, a status change)
		// must not be read as an instruction about its time — clearing here would
		// be a no-op, but "none" is what stops the reverse push that used to snap
		// the block back into the grid.
		expect(renameTimeIntent(UNTIMED, '📅 By 2026-09-03, other - 1 - thing', FMT)).toEqual({
			action: 'none',
		});
	});

	it('a name outside the grammar is not an instruction either', () => {
		expect(renameTimeIntent('Meeting notes', 'Meeting notes v2', FMT)).toEqual({ action: 'none' });
	});
});
