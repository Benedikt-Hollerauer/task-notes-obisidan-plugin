// THE PROMISE: the plugin never mangles the text of a line.
//
// Every write goes through parse → serialize, or through a whole-line splice.
// This pins the property directly, over the weirdest lines a real vault has
// actually contained — including a hand-written doubled `- [ ] - [ ]` prefix
// and a line whose link brackets are unbalanced.

import { describe, it, expect } from 'vitest';
import { parsePlannerLine, parseListLine, serializePlannerLine, setCheckboxStatus } from '../src/core/planner-line';
import { insertBlockResult, removeLines, replaceLine, scanDayLines } from '../src/core/planner-section';

const HEADING = '## Day planner';

/** Real and pathological lines, several taken verbatim from the test vault. */
const LINES = [
	'- [x] 09:00 - 09:45 [[◻️ Test - test - test]]',
	'- [ ] - [ ] [[◻️ Test - test - test]]',
	'\t- [ ] - [ ] [[◻️ Test - test - test]]',
	'- [ ] 01:15 - 02:15 - [ ] [[◻️ Test - test - test]]',
	'\t- [ ] test]]',
	'\t- [ ] test]]test]]test]]',
	'- [ ] [[unclosed',
	'- [ ] 13:00 - 14:00 [[🔁 Consume - 0mg - of caffeine after 14.00h - per day ☕]]',
	'- ==📅 Monthly - First Mon - 2026-09-07==',
	'- [ ] 07:00 - 08:00',
	'* [ ] 08:00 different marker',
	'\t\t- [ ] deeply nested',
];

describe('parse → serialize is a fixpoint', () => {
	it.each(LINES)('leaves %j byte-identical', (raw) => {
		const parsed = parsePlannerLine(raw, 0);
		if (!parsed) return; // not a planner line at all; nothing rewrites it
		expect(serializePlannerLine(parsed)).toBe(raw);
	});

	it('is still a fixpoint on a SECOND pass', () => {
		// A rewrite that drifted by one character per pass would pass the test
		// above and still destroy a note over a week of edits.
		for (const raw of LINES) {
			const once = parsePlannerLine(raw, 0);
			if (!once) continue;
			const twice = parsePlannerLine(serializePlannerLine(once), 0)!;
			expect(serializePlannerLine(twice)).toBe(serializePlannerLine(once));
		}
	});
});

describe('ticking a box changes exactly one character', () => {
	it.each(LINES.filter((l) => /\[[ xX]\]/.test(l)))('on %j', (raw) => {
		const on = setCheckboxStatus(raw, 'x');
		const off = setCheckboxStatus(on, ' ');
		expect(off).toBe(setCheckboxStatus(raw, ' '));
		// Same length, and exactly one character differs — the status itself.
		// Indexed by code UNIT on both sides: spreading one and indexing the other
		// misaligns the moment an astral emoji appears in the title.
		expect(on.length).toBe(raw.length);
		let diffs = 0;
		for (let i = 0; i < raw.length; i++) if (raw[i] !== on[i]) diffs++;
		expect(diffs).toBeLessThanOrEqual(1);
	});
});

describe('whole-note operations never touch a line they were not aimed at', () => {
	const NOTE = [HEADING, ...LINES, ''].join('\n');

	it('inserting keeps every existing line verbatim', () => {
		const out = insertBlockResult(NOTE, HEADING, ['- [ ] 05:00 - 06:00 New']).text;
		for (const line of LINES) expect(out).toContain(line);
	});

	it('removing one block leaves the rest verbatim', () => {
		const out = removeLines(NOTE, 1, 2);
		for (const line of LINES.slice(1)) expect(out).toContain(line);
	});

	it('replacing one line leaves the rest verbatim', () => {
		const out = replaceLine(NOTE, 2, '- [ ] replaced');
		const kept = [...LINES.slice(0, 1), ...LINES.slice(2)];
		for (const line of kept) expect(out).toContain(line);
	});

	it('THE REGRESSION: a doubled `- [ ] - [ ]` prefix is read, never repaired', () => {
		// The timeline shows it verbatim because that is what the note says. The
		// plugin has no business silently rewriting a line the user typed.
		const doubled = '- [ ] - [ ] [[◻️ Test - test - test]]';
		const parsed = parseListLine(doubled, 0)!;
		expect(parsed.text).toBe('- [ ] [[◻️ Test - test - test]]');
		expect(serializePlannerLine(parsed)).toBe(doubled);
	});

	it('scanning the note never loses or rewrites a line', () => {
		const { plannerLines } = scanDayLines(NOTE, HEADING);
		for (const line of plannerLines) {
			expect(NOTE.split('\n')[line.lineNo]).toBe(serializePlannerLine(line));
		}
	});
});
