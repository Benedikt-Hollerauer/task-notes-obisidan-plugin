// CODE BLOCKS ARE NOT PLANNER LINES.
//
// `buildLineTree` has always skipped fenced content (line-tree.ts, pinned by
// tests/line-tree.test.ts and tests/timed-insert.test.ts). The scanners in
// planner-section.ts did not: they walked the raw line array with no fence state.
//
// So a note documenting its own format —
//
//     ```
//     - [ ] 09:00 - 10:00 standup
//     ```
//
// drew a real block on the timeline. Worse, the block was DRAGGABLE, and dragging
// it ran `SyncEngine.editLineInPlace` → `replaceLine`, rewriting a line inside the
// user's code block. A `## Day planner` written inside a fence was also matched as
// the real heading, which made the fenced examples the writable planner section
// and hid the actual one.
//
// Anyone who documents this plugin's own syntax in their vault hits this.

import { describe, it, expect } from 'vitest';
import { fencedLines } from '../src/core/line-tree';
import { scanDayLines, getPlannerSection } from '../src/core/planner-section';

const HEADING = '## Day planner';

describe('fencedLines', () => {
	it('marks the fences and everything between them', () => {
		const lines = ['a', '```', 'b', 'c', '```', 'd'];
		expect([...fencedLines(lines)].sort((x, y) => x - y)).toEqual([1, 2, 3, 4]);
	});

	it('handles ~~~ as well as ```', () => {
		expect([...fencedLines(['~~~', 'x', '~~~'])].sort((a, b) => a - b)).toEqual([0, 1, 2]);
	});

	it('treats an unclosed fence as running to the end of the note', () => {
		expect([...fencedLines(['a', '```', 'b', 'c'])].sort((x, y) => x - y)).toEqual([1, 2, 3]);
	});

	it('leaves an ordinary note untouched', () => {
		expect(fencedLines(['- [ ] 09:00 x', 'prose']).size).toBe(0);
	});

	it('skips frontmatter, which is not fenced content', () => {
		// `---` delimiters are not ``` fences; the body starts after them.
		const lines = ['---', 'tags: x', '---', '- [ ] 09:00 y'];
		expect(fencedLines(lines).size).toBe(0);
	});
});

describe('a fenced example is not a timeline block', () => {
	const note = [
		HEADING,
		'- [ ] 09:00 - 10:00 real standup',
		'',
		'Here is how the syntax works:',
		'```markdown',
		'- [ ] 07:00 - 08:00 fenced example',
		'\t- [ ] a fenced sub-item',
		'```',
		'',
	].join('\n');

	it('THE BUG: the fenced row does not become a planner line', () => {
		const scan = scanDayLines(note, HEADING);
		const all = [...scan.plannerLines, ...scan.extraLines].map((l) => l.lineNo);
		// Line 5 is the fenced example.
		expect(all).not.toContain(5);
	});

	it('the real line beside it still works', () => {
		const scan = scanDayLines(note, HEADING);
		expect(scan.plannerLines.map((l) => l.lineNo)).toContain(1);
	});

	it('a timed bullet in a fence outside the section is not an extra line either', () => {
		const doc = [HEADING, '- [ ] 09:00 real', '## Log', '```', '- 16:00 fenced log line', '```'].join(
			'\n',
		);
		const scan = scanDayLines(doc, HEADING);
		expect(scan.extraLines.map((l) => l.lineNo)).not.toContain(4);
	});

	it('an UNfenced timed bullet outside the section still shows — the feature is intact', () => {
		const doc = [HEADING, '- [ ] 09:00 real', '## Log', '- 16:00 Reviewed the deck'].join('\n');
		const scan = scanDayLines(doc, HEADING);
		expect(scan.extraLines.map((l) => l.lineNo)).toContain(3);
	});
});

describe('a fenced heading is not the planner heading', () => {
	it('THE BUG: the fenced example does not win over the real heading', () => {
		const note = [
			'Documentation of the format:',
			'```',
			'## Day planner',
			'- [ ] 09:00 example',
			'```',
			'',
			'## Day planner',
			'- [ ] 10:00 the real one',
			'',
		].join('\n');
		const section = getPlannerSection(note, HEADING);
		expect(section.found).toBe(true);
		expect(section.headingLineNo).toBe(6);
	});

	it('a note whose ONLY heading is fenced has no planner section', () => {
		const note = ['```', '## Day planner', '```', ''].join('\n');
		expect(getPlannerSection(note, HEADING).found).toBe(false);
	});

	it('an ordinary note is unaffected', () => {
		const note = [HEADING, '- [ ] 09:00 x', ''].join('\n');
		expect(getPlannerSection(note, HEADING).headingLineNo).toBe(0);
	});
});
