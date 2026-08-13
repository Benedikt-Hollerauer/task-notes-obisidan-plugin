import { describe, it, expect } from 'vitest';
import { scanDayLines } from '../src/core/planner-section';
import { bodyOf, isBodyRow, bodyProgress } from '../src/core/line-tree';
import { lineTitle } from '../src/core/line-title';
import type { PlannerLine } from '../src/types';
import { USER_NOTE, LINE } from './fixtures/user-note';

/**
 * The rule `EventIndex.rebuild` applies: a line indented under a timed line is
 * the BODY of that block, not an event beside it — with a time or without.
 *
 * Calls the SAME `isBodyRow` the index and reconcile call, rather than restating
 * it: a copy here could go on passing while production drifted away from it.
 */
function standaloneEvents(text: string, heading: string): PlannerLine[] {
	const { plannerLines, extraLines, tree } = scanDayLines(text, heading);
	return [...plannerLines, ...extraLines].filter((l) => !isBodyRow(tree, l.lineNo));
}

const timed = (lines: PlannerLine[]) => lines.filter((l) => l.startMinutes != null);
const untimed = (lines: PlannerLine[]) => lines.filter((l) => l.startMinutes == null);

describe('the real note, with the planner heading pointed at the Schedule', () => {
	// `## ⏰ Schedule` puts EVERYTHING in the planner section: the 13 Daily
	// routines and every tab-indented child. This is the configuration that used
	// to bury the grid under a chip per child.
	const HEADING = '## ⏰ Schedule';
	const events = standaloneEvents(USER_NOTE, HEADING);

	it('THE FIX: the nested children are no longer events of their own', () => {
		const scan = scanDayLines(USER_NOTE, HEADING);
		// The scan itself still sees them — the arrays are unchanged, which is what
		// keeps claims and renames working exactly as before …
		expect(scan.plannerLines.map((l) => l.lineNo)).toContain(LINE.dream);
		expect(scan.plannerLines.map((l) => l.lineNo)).toContain(LINE.monthlyChild);
		// … but they are not events.
		expect(events.map((l) => l.lineNo)).not.toContain(LINE.dream);
		expect(events.map((l) => l.lineNo)).not.toContain(LINE.minoxidil);
		expect(events.map((l) => l.lineNo)).not.toContain(LINE.monthlyChild);
		expect(events.map((l) => l.lineNo)).not.toContain(LINE.posture);
		expect(events.map((l) => l.lineNo)).not.toContain(LINE.breath);
	});

	it('leaves exactly one untimed chip: the Daily routine, which is nested under nothing', () => {
		expect(untimed(events).map((l) => l.lineNo)).toEqual([LINE.dailyRoutine]);
	});

	it('keeps every hour row as its own block', () => {
		expect(timed(events).map((l) => l.lineNo)).toEqual([
			LINE.row0700,
			LINE.row0800,
			LINE.row1000,
			LINE.row1300,
			LINE.row2300,
			LINE.row0400,
		]);
	});

	it('is a real reduction, not a rounding error', () => {
		const scan = scanDayLines(USER_NOTE, HEADING);
		const before = [...scan.plannerLines, ...scan.extraLines].length;
		expect(before - events.length).toBe(5); // the 5 nested lines of this fixture
		expect(events).toHaveLength(7);
	});
});

describe('the real note, with the default planner heading (absent from it)', () => {
	// The user's own configuration: no `## Day planner` anywhere, so nothing is in
	// a planner section and only timed lines are seen at all.
	const events = standaloneEvents(USER_NOTE, '## Day planner');

	it('shows the hour rows and nothing else', () => {
		expect(untimed(events)).toEqual([]);
		expect(events).toHaveLength(6);
	});
});

describe('what a block shows instead of a name', () => {
	const { tree } = scanDayLines(USER_NOTE, '## Day planner');

	it('an hour row with no text of its own has a body and a tick count', () => {
		const rows = bodyOf(tree, LINE.row0700);
		expect(lineTitle('')).toBe(''); // the row's own text
		expect(rows).toHaveLength(2);
		expect(bodyProgress(rows)).toEqual({ done: 1, total: 2 });
	});

	it('a row WITH text keeps it exactly as written, brackets included', () => {
		const row = tree.nodes[tree.byLineNo.get(LINE.row1000)!].line;
		expect(lineTitle(row.text)).toBe('[[🔁 Do - 1 workout - with non-visual media 🏥]]');
		expect(bodyOf(tree, LINE.row1000)).toEqual([]);
	});

	it('the counter describes the whole subtree, whatever the view later hides', () => {
		// showCheckedBlocks filters ROWS at render; it must never change the count,
		// or a block would read 1/1 while eleven done items sit hidden inside it.
		const rows = bodyOf(tree, LINE.row0700);
		const visible = rows.filter((r) => r.line.status.trim().toLowerCase() !== 'x');
		expect(visible).toHaveLength(1);
		expect(bodyProgress(rows).total).toBe(2);
	});
});

describe('a timed line nested under another block', () => {
	const NOTE = [
		'## Day planner',
		'- [ ] 09:00 - 11:00 Parent',
		'\t- [ ] 09:30 - 10:00 Child',
		'\t- [ ] untimed step',
		'- [ ] 13:00 Sibling',
	].join('\n');

	it('is part of that block, not a second block beside it', () => {
		// Two events competing for the same column, one of them drawn twice (as a
		// block AND as a row of its parent), is not what "nested" means.
		const events = standaloneEvents(NOTE, '## Day planner');
		expect(events.map((l) => l.text)).toEqual(['Parent', 'Sibling']);
	});

	it('still appears inside the parent, with its own time and checkbox', () => {
		const { tree } = scanDayLines(NOTE, '## Day planner');
		const rows = bodyOf(tree, 1);
		expect(rows.map((r) => r.line.text)).toEqual(['Child', 'untimed step']);
		expect(rows[0].line.startMinutes).toBe(9 * 60 + 30);
		expect(bodyProgress(rows)).toEqual({ done: 0, total: 2 });
	});

	it('does NOT absorb a timed line nested under an UNTIMED one', () => {
		// Nothing owns those lines, so a real event must not disappear into a
		// bullet that merely happens to sit above it.
		const loose = ['## Day planner', '- [ ] Groceries', '\t- [ ] 17:00 - 18:00 Aldi'].join('\n');
		expect(standaloneEvents(loose, '## Day planner').map((l) => l.text)).toEqual([
			'Groceries',
			'Aldi',
		]);
	});
});
