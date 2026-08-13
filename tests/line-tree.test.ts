import { describe, it, expect } from 'vitest';
import { buildLineTree, bodyOf, bodyOwnerOf, bodyProgress, indentWidth } from '../src/core/line-tree';
import { USER_NOTE, LINE } from './fixtures/user-note';

const tree = buildLineTree(USER_NOTE);
const nodeAt = (lineNo: number) => tree.nodes[tree.byLineNo.get(lineNo)!];
const textsOf = (lineNo: number) => bodyOf(tree, lineNo).map((r) => r.line.text);
const depthsOf = (lineNo: number) => bodyOf(tree, lineNo).map((r) => r.depth);

describe('indentWidth — one rule for tabs and spaces', () => {
	it('expands a tab to the next tab stop', () => {
		expect(indentWidth('\t')).toBe(4);
		expect(indentWidth('    ')).toBe(4);
		expect(indentWidth('\t\t')).toBe(8);
		expect(indentWidth('  \t')).toBe(4); // two spaces then a tab still lands on 4
		expect(indentWidth('')).toBe(0);
	});
});

describe('the real note', () => {
	it('nests the tab-indented children under their hour row', () => {
		expect(textsOf(LINE.row0700)).toEqual([
			'[[🔁 Document - 1 dream - of the night as exact as possible 📝]]',
			'[[🔁 Apply - 5 men or 10 women pumps - of minoxidil 👱‍♂️]]',
		]);
		expect(depthsOf(LINE.row0700)).toEqual([1, 1]);
	});

	it('carries a group label AND its grandchildren into the body, in document order', () => {
		expect(depthsOf(LINE.row0800)).toEqual([1, 2, 1]);
		expect(textsOf(LINE.row0800)).toEqual([
			'==📅 Monthly - First Mon - 2026-09-07==',
			'[[📅 Attend - 1h - monthly planning at Logisitsy - First mon at 08.00h ✍️]]',
			'[[🔁 Do - 5m - of exercises for improving my posture 🧘‍♂️]]',
		]);
	});

	it('says which block owns each line — and which lines belong to nobody', () => {
		expect(bodyOwnerOf(tree, LINE.dream)).toBe(tree.byLineNo.get(LINE.row0700));
		expect(bodyOwnerOf(tree, LINE.monthlyChild)).toBe(tree.byLineNo.get(LINE.row0800));
		expect(bodyOwnerOf(tree, LINE.monthlyLabel)).toBe(tree.byLineNo.get(LINE.row0800));
		// The Daily routine and the preamble are their own thing.
		expect(bodyOwnerOf(tree, LINE.dailyRoutine)).toBe(-1);
		expect(bodyOwnerOf(tree, LINE.preamble)).toBe(-1);
		expect(bodyOwnerOf(tree, LINE.row0700)).toBe(-1);
	});

	it('counts only checkbox rows towards progress', () => {
		// The 08:00 body is label + child + sibling: the label is not a task.
		expect(bodyProgress(bodyOf(tree, LINE.row0800))).toEqual({ done: 0, total: 2 });
		expect(bodyProgress(bodyOf(tree, LINE.row0700))).toEqual({ done: 1, total: 2 });
		expect(bodyProgress(bodyOf(tree, LINE.row1000))).toEqual({ done: 0, total: 0 });
	});

	it('leaves an hour row with nothing under it empty', () => {
		expect(bodyOf(tree, LINE.row1300)).toEqual([]);
		expect(bodyOf(tree, LINE.row2300)).toEqual([]);
		expect(bodyOf(tree, LINE.row1000)).toEqual([]);
	});

	it('closes a subtree at the next heading', () => {
		// `### 🎯 Timeboxing` sits at column 0, so the Daily routine above it cannot
		// swallow the hour rows below it.
		expect(nodeAt(LINE.dailyRoutine).subtreeEndLine).toBe(LINE.timeboxingHeading);
		expect(nodeAt(LINE.dailyRoutine).children).toEqual([]);
	});

	it("ends an hour row's subtree just past its last child", () => {
		expect(nodeAt(LINE.row0700).subtreeEndLine).toBe(LINE.row0800);
		expect(nodeAt(LINE.row0800).subtreeEndLine).toBe(LINE.row1000);
		expect(nodeAt(LINE.row1000).subtreeEndLine).toBe(LINE.row1300);
	});

	it('ends the last row at the last non-blank line, not at the trailing newline', () => {
		// The fixture ends with '\n', so split('\n') leaves a final ''.
		expect(nodeAt(LINE.row0400).subtreeEndLine).toBe(LINE.breath + 1);
		expect(USER_NOTE.split('\n').length).toBe(LINE.breath + 2);
	});

	it('has the timed rows as roots', () => {
		const roots = tree.roots.map((i) => tree.nodes[i].line.lineNo);
		expect(roots).toContain(LINE.row0700);
		expect(roots).toContain(LINE.row0400);
		expect(roots).not.toContain(LINE.dream);
	});
});

describe('indentation shapes', () => {
	it('handles 2-, 3- and 4-space nesting without dividing by a step', () => {
		const t = buildLineTree(['- [ ] 09:00 A', '   - [ ] B', '      - [ ] C', '   - [ ] D'].join('\n'));
		expect(bodyOf(t, 0).map((r) => [r.line.text, r.depth])).toEqual([
			['B', 1],
			['C', 2],
			['D', 1],
		]);
	});

	it('treats a tab and four spaces as the same level', () => {
		const t = buildLineTree(['- [ ] 09:00 A', '\t- [ ] tabbed', '    - [ ] spaced'].join('\n'));
		expect(bodyOf(t, 0).map((r) => r.depth)).toEqual([1, 1]);
	});

	it('re-attaches ragged indentation instead of throwing', () => {
		const t = buildLineTree(
			['- [ ] 09:00 A', '\t\t\t- [ ] deep', '\t\t- [ ] less', '\t- [ ] least'].join('\n'),
		);
		expect(bodyOf(t, 0).map((r) => r.depth)).toEqual([1, 1, 1]);
		expect(t.nodes.every((n) => n.depth >= 0)).toBe(true);
	});

	it('does not orphan a note whose first line is indented', () => {
		const t = buildLineTree('\t- [ ] 09:00 lonely');
		expect(t.roots).toHaveLength(1);
		expect(t.nodes[0].depth).toBe(0);
		expect(t.nodes[0].parent).toBe(-1);
	});

	it('keeps a list open across blank lines but not across a column-0 paragraph', () => {
		const withBlank = buildLineTree(['- [ ] 09:00 A', '', '\t- [ ] still mine'].join('\n'));
		expect(bodyOf(withBlank, 0)).toHaveLength(1);

		const withProse = buildLineTree(['- [ ] 09:00 A', 'Some prose.', '\t- [ ] not mine'].join('\n'));
		expect(bodyOf(withProse, 0)).toHaveLength(0);
	});

	it('treats an indented paragraph as a continuation, not a terminator', () => {
		const t = buildLineTree(['- [ ] 09:00 A', '\tcontinued text', '\t- [ ] still mine'].join('\n'));
		expect(bodyOf(t, 0).map((r) => r.line.text)).toEqual(['still mine']);
	});
});

describe('things that are not lines', () => {
	it('ignores frontmatter, whose list items are data', () => {
		const t = buildLineTree(['---', 'tags:', '  - 09:00 nope', '---', '- [ ] 09:00 real'].join('\n'));
		expect(t.nodes).toHaveLength(1);
		expect(t.nodes[0].line.text).toBe('real');
		expect(t.bodyStart).toBe(4);
	});

	it('ignores everything inside a code fence', () => {
		const t = buildLineTree(
			['- [ ] 09:00 A', '```', '- [ ] 10:00 not a task', '```', '- [ ] 11:00 B'].join('\n'),
		);
		expect(t.nodes.map((n) => n.line.text)).toEqual(['A', 'B']);
	});

	it('ignores a fence nested inside an item, keeping the item open', () => {
		const t = buildLineTree(
			['- [ ] 09:00 A', '\t```', '\t- [ ] 10:00 sample', '\t```', '\t- [ ] real child'].join('\n'),
		);
		expect(bodyOf(t, 0).map((r) => r.line.text)).toEqual(['real child']);
	});

	it('handles an empty note and a note with no list at all', () => {
		expect(buildLineTree('').nodes).toEqual([]);
		expect(buildLineTree('# Title\n\nSome prose.\n').nodes).toEqual([]);
	});
});

describe('a timed line nested under a timed line', () => {
	const t = buildLineTree(['- [ ] 09:00 - 10:00 Standup', '\t- [ ] 09:15 Demo', '\t- [ ] note'].join('\n'));

	it("appears in its parent's body", () => {
		expect(bodyOf(t, 0).map((r) => r.line.text)).toEqual(['Demo', 'note']);
	});

	it('is still recognisable as timed, so it can keep its own block', () => {
		const demo = t.nodes[t.byLineNo.get(1)!];
		expect(demo.line.startMinutes).toBe(9 * 60 + 15);
		expect(demo.timedAncestor).toBe(0);
		// The suppression rule is "has a timed ancestor", so BOTH are rows of the
		// 09:00 block; `timedAncestor` is what says so, and the row keeps its time.
		expect(t.nodes[t.byLineNo.get(2)!].line.startMinutes).toBeNull();
	});
});
