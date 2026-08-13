import { describe, it, expect } from 'vitest';
import { scanDayLines } from '../src/core/planner-section';
import { parseListLine, parsePlannerLine, serializePlannerLine } from '../src/core/planner-line';
import { isBareDailyNote } from '../src/core/bare-note';
import { findPlacementLine } from '../src/core/placement';
import { USER_NOTE } from './fixtures/user-note';

const HEADING = '## Day planner';

const NOTE = [
	'---',
	'created: 2026-07-27',
	'---',
	'# Monday, July 27, 2026',
	'',
	'## Day planner',
	'- [ ] 10:00 - 11:00 [[📅 By 2026-07-27 at 10.00h, plan - 1 - sprint]]',
	'- [ ] Water the plants',
	'',
	'## Notes',
	'- Bob mentioned the Q3 numbers',
	'- 42 things left to do',
	'',
	'## Meetings',
	'- 14:30 - 15:00 Sync with [[📅 By 2026-07-27 at 10.00h, plan - 1 - sprint]]',
	'',
	'## Log',
	'- 16:00 Reviewed the deck',
	'- [x] 17:00 Gym',
	'\t- 18:30 Nested note',
].join('\n');

describe('scanDayLines — what shows on the timeline', () => {
	const scan = scanDayLines(NOTE, HEADING);

	it('keeps the planner section exactly as before', () => {
		expect(scan.plannerLines.map((l) => l.text)).toEqual([
			'[[📅 By 2026-07-27 at 10.00h, plan - 1 - sprint]]',
			'Water the plants',
		]);
	});

	it('picks up timed lines under any other heading', () => {
		expect(scan.extraLines.map((l) => l.text)).toEqual([
			'Sync with [[📅 By 2026-07-27 at 10.00h, plan - 1 - sprint]]',
			'Reviewed the deck',
			'Gym',
			'Nested note',
		]);
		expect(scan.extraLines.map((l) => l.startMinutes)).toEqual([870, 960, 1020, 1110]);
	});

	it('leaves untimed prose bullets alone — the flood this scan could have caused', () => {
		const texts = scan.extraLines.map((l) => l.text);
		expect(texts).not.toContain('Bob mentioned the Q3 numbers');
		expect(texts).not.toContain('42 things left to do');
	});

	it('records whether each line had a checkbox, and its indent', () => {
		const byText = new Map(scan.extraLines.map((l) => [l.text, l]));
		expect(byText.get('Reviewed the deck')!.hasCheckbox).toBe(false);
		expect(byText.get('Gym')!.hasCheckbox).toBe(true);
		expect(byText.get('Nested note')!.indent).toBe('\t');
	});

	it('STRUCTURAL: nothing outside the section can be auto-renamed', () => {
		// reconcile() only ever sees `plannerLines`. The `## Meetings` line links the
		// same note as a planner line, and must not appear here — otherwise it would
		// claim the file, count as a duplicate, and fight over its name.
		const linked = scan.plannerLines.filter((l) => l.linkTarget != null);
		expect(linked).toHaveLength(1);
		expect(scan.extraLines.every((l) => !scan.plannerLines.includes(l))).toBe(true);
	});

	it('shows a timed bullet that sits inside the section but has no checkbox', () => {
		const s = scanDayLines(`${HEADING}\n- 09:00 Standup\n- [ ] 10:00 Review`, HEADING);
		expect(s.plannerLines.map((l) => l.text)).toEqual(['Review']);
		expect(s.extraLines.map((l) => l.text)).toEqual(['Standup']);
	});

	it('ignores YAML frontmatter, whose list items are data, not tasks', () => {
		const s = scanDayLines(
			['---', 'tags:', '  - 09:00 not-a-task', '---', '## Log', '- 10:00 Real'].join('\n'),
			HEADING,
		);
		expect(s.extraLines.map((l) => l.text)).toEqual(['Real']);
	});

	it('treats an unterminated --- as body rather than hiding the note', () => {
		const s = scanDayLines(['---', '- 09:00 Standup'].join('\n'), HEADING);
		expect(s.extraLines.map((l) => l.text)).toEqual(['Standup']);
	});

	it('scans the whole note when there is no planner section at all', () => {
		const s = scanDayLines('# Day\n- 08:00 Wake up\n- just a note', HEADING);
		expect(s.plannerLines).toEqual([]);
		expect(s.extraLines.map((l) => l.text)).toEqual(['Wake up']);
	});
});

describe('rewriting a scanned line never changes what it was', () => {
	it('a checkbox-free bullet stays checkbox-free when dragged', () => {
		const line = parseListLine('- 16:00 Reviewed the deck', 0)!;
		expect(serializePlannerLine({ ...line, startMinutes: 17 * 60, endMinutes: 18 * 60 })).toBe(
			'- 17:00 - 18:00 Reviewed the deck',
		);
	});

	it('a nested bullet keeps its indent', () => {
		const line = parseListLine('\t- 18:30 Nested note', 0)!;
		expect(serializePlannerLine({ ...line, startMinutes: 19 * 60, endMinutes: null })).toBe(
			'\t- 19:00 Nested note',
		);
	});

	it('a checkbox line keeps its status and marker', () => {
		const line = parseListLine('  * [x] 17:00 Gym', 0)!;
		expect(serializePlannerLine({ ...line, startMinutes: 18 * 60, endMinutes: null })).toBe(
			'  * [x] 18:00 Gym',
		);
	});

	it('round-trips every line of the note it came from', () => {
		const scan = scanDayLines(NOTE, HEADING);
		for (const line of [...scan.plannerLines, ...scan.extraLines]) {
			expect(serializePlannerLine(line)).toBe(line.raw);
		}
	});
});

describe('isBareDailyNote — the template merge must never eat a real note', () => {
	it('is bare for a plugin-created note', () => {
		expect(isBareDailyNote(`${HEADING}\n- [ ] 09:00 [[A]]\n`, HEADING)).toBe(true);
	});

	it('is bare for a checkbox-free bullet too, so such a day can still get its template', () => {
		// This deliberately changed: the plugin itself writes checkbox-free lines
		// when you drag `- 16:00 Reviewed the deck` onto a future day, and requiring
		// a checkbox meant that day's template could never be merged, ever.
		expect(isBareDailyNote(`${HEADING}\n- 09:00 Standup\n`, HEADING)).toBe(true);
		expect(isBareDailyNote(`${HEADING}\n- [ ] 09:00 A\n\t- [ ] nested\n`, HEADING)).toBe(true);
		expect(isBareDailyNote(`${HEADING}\n- ==a label==\n`, HEADING)).toBe(true);
	});

	it('is NOT bare for prose, other headings, or frontmatter — the real guarantee', () => {
		expect(isBareDailyNote(`${HEADING}\n- [ ] 09:00 [[A]]\n\n## Notes\n- hi\n`, HEADING)).toBe(false);
		expect(isBareDailyNote(`---\ncreated: 2026-07-27\n---\n${HEADING}\n`, HEADING)).toBe(false);
		expect(isBareDailyNote(`${HEADING}\nSome prose\n`, HEADING)).toBe(false);
		expect(isBareDailyNote(`# Monday\n${HEADING}\n- [ ] 09:00 A\n`, HEADING)).toBe(false);
	});

	it('is NOT bare for the real daily note, which is what matters', () => {
		expect(isBareDailyNote(USER_NOTE, HEADING)).toBe(false);
		expect(isBareDailyNote(USER_NOTE, '## ⏰ Schedule')).toBe(false);
	});
});

describe('findPlacementLine picks the nearest identical line', () => {
	const doc = ['- 09:00 Standup', 'x', '- 09:00 Standup', 'y', '- 09:00 Standup'].join('\n');

	it('prefers the remembered index when it still matches', () => {
		expect(findPlacementLine(doc, { lineNo: 2, raw: '- 09:00 Standup' })).toBe(2);
	});

	it('falls back to the nearest occurrence, not the first in the file', () => {
		// The line moved by one; the block the user dragged is the third, not the first.
		expect(findPlacementLine(doc, { lineNo: 5, raw: '- 09:00 Standup' })).toBe(4);
		expect(findPlacementLine(doc, { lineNo: 1, raw: '- 09:00 Standup' })).toBe(0);
	});

	it('still refuses to guess when the text is gone', () => {
		expect(findPlacementLine(doc, { lineNo: 2, raw: '- 09:00 Gone' })).toBe(-1);
	});
});

describe('the strict grammar is unchanged', () => {
	it('parsePlannerLine still rejects a bullet without a checkbox', () => {
		expect(parsePlannerLine('- 16:00 Reviewed the deck', 0)).toBeNull();
		expect(parsePlannerLine('- [ ] 16:00 Reviewed the deck', 0)).not.toBeNull();
	});

	it('a wikilink at the start is not mistaken for a checkbox', () => {
		const line = parseListLine('- [[Note]] and more', 0)!;
		expect(line.hasCheckbox).toBe(false);
		expect(line.text).toBe('[[Note]] and more');
		expect(line.linkTarget).toBe('Note');
	});
});

describe('a note saved with Windows line endings', () => {
	// JavaScript's `.` does not match `\r`, so the line regex failed on every line
	// of a CRLF note: the whole day was invisible on the timeline.
	const CRLF = ['## Day planner\r', '- [ ] 09:00 - 10:00 [[A]]\r', '\t- [ ] child\r', ''].join('\n');

	it('parses, nests and counts exactly as the LF version does', () => {
		const scan = scanDayLines(CRLF, HEADING);
		expect(scan.plannerLines.map((l) => l.text)).toEqual(['[[A]]', 'child']);
		expect(scan.plannerLines[0].startMinutes).toBe(540);
		expect(scan.tree.byLineNo.size).toBe(2);
	});

	it('keeps the carriage return when it rewrites a line', () => {
		const line = parseListLine('- [ ] 09:00 - 10:00 [[A]]\r', 0)!;
		expect(line.raw.endsWith('\r')).toBe(true);
		expect(serializePlannerLine(line)).toBe('- [ ] 09:00 - 10:00 [[A]]\r');
		expect(serializePlannerLine({ ...line, startMinutes: 600, endMinutes: null })).toBe('- [ ] 10:00 [[A]]\r');
	});
})
