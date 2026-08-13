import { describe, it, expect } from 'vitest';
import { parsePlannerLine, serializePlannerLine, buildLinkLine, isChecked } from '../src/core/planner-line';
import {
	getPlannerSection,
	scanDayLines,
	replaceLine,
	insertBlockResult,
	removeLines,
	matchesConfiguredHeading,
} from '../src/core/planner-section';
import {
	colonToMinutes,
	dotToMinutes,
	minutesToColon,
	minutesToDot,
	snap,
} from '../src/core/timestamps';

describe('timestamps', () => {
	it('parses and formats colon/dot times', () => {
		expect(colonToMinutes('14:30')).toBe(870);
		expect(colonToMinutes('9:05')).toBe(545);
		expect(dotToMinutes('14.30h')).toBe(870);
		expect(dotToMinutes('14.30')).toBe(870);
		expect(minutesToColon(870)).toBe('14:30');
		expect(minutesToDot(870)).toBe('14.30h');
	});
	it('rejects invalid times', () => {
		expect(colonToMinutes('25:00')).toBeNull();
		expect(colonToMinutes('12:99')).toBeNull();
		expect(dotToMinutes('nope')).toBeNull();
	});
	it('snaps to a step', () => {
		expect(snap(872, 15)).toBe(870);
		expect(snap(878, 15)).toBe(885);
	});
});

describe('planner-line parsing', () => {
	it('parses a timed wikilink line', () => {
		const line = parsePlannerLine('- [ ] 14:00 - 15:00 [[📅 By 2026-07-24 at 14.00h, prepare - 1 - deck]]', 3);
		expect(line).not.toBeNull();
		expect(line!.startMinutes).toBe(840);
		expect(line!.endMinutes).toBe(900);
		expect(line!.linkTarget).toBe('📅 By 2026-07-24 at 14.00h, prepare - 1 - deck');
		expect(line!.status).toBe(' ');
	});
	it('parses a plain-text timed line with only a start', () => {
		const line = parsePlannerLine('- [ ] 13:00 Lunch', 0);
		expect(line!.startMinutes).toBe(780);
		expect(line!.endMinutes).toBeNull();
		expect(line!.text).toBe('Lunch');
		expect(line!.linkTarget).toBeNull();
	});
	it('parses a checked line with no time', () => {
		const line = parsePlannerLine('- [x] Some done task', 0);
		expect(line!.startMinutes).toBeNull();
		expect(isChecked(line!)).toBe(true);
	});
	it('parses aliased links and preserves indent/marker', () => {
		const line = parsePlannerLine('  * [ ] 09:00 [[note|Alias]]', 0);
		expect(line!.indent).toBe('  ');
		expect(line!.marker).toBe('*');
		expect(line!.linkTarget).toBe('note');
		expect(line!.linkAlias).toBe('Alias');
	});
	it('rejects non-list lines', () => {
		expect(parsePlannerLine('## Heading', 0)).toBeNull();
		expect(parsePlannerLine('plain paragraph', 0)).toBeNull();
	});
	it('round-trips through serialize', () => {
		const raw = '- [ ] 14:00 - 15:00 [[event]]';
		const line = parsePlannerLine(raw, 0)!;
		expect(serializePlannerLine(line)).toBe(raw);
	});
	it('builds a link line', () => {
		expect(buildLinkLine('📅 By 2026-07-24 at 09.00h, a - 1 - b', 540, 600)).toBe(
			'- [ ] 09:00 - 10:00 [[📅 By 2026-07-24 at 09.00h, a - 1 - b]]',
		);
	});
});

describe('planner-section', () => {
	const heading = '## Day planner';
	const doc = [
		'---',
		'tags: daily',
		'---',
		'# 2026-07-24',
		'',
		'## Day planner',
		'- [ ] 09:00 - 10:00 [[A]]',
		'- [ ] 11:00 [[B]]',
		'',
		'## Notes',
		'some notes',
	].join('\n');

	it('finds the section bounds', () => {
		const s = getPlannerSection(doc, heading);
		expect(s.found).toBe(true);
		expect(s.headingLineNo).toBe(5);
		expect(s.start).toBe(6);
		expect(s.end).toBe(9); // stops at the "## Notes" heading
	});
	it('lists planner lines in the section', () => {
		const lines = scanDayLines(doc, heading).plannerLines;
		expect(lines.map((l) => l.linkTarget)).toEqual(['A', 'B']);
	});
	it('matches the configured heading', () => {
		expect(matchesConfiguredHeading('## Day planner', heading)).toBe(true);
		expect(matchesConfiguredHeading('## day PLANNER', heading)).toBe(true);
		expect(matchesConfiguredHeading('### Day planner', heading)).toBe(false);
	});
	it('replaces one line, leaving others byte-identical', () => {
		const next = replaceLine(doc, 6, '- [ ] 09:30 - 10:30 [[A]]');
		const before = doc.split('\n');
		const after = next.split('\n');
		expect(after[6]).toBe('- [ ] 09:30 - 10:30 [[A]]');
		before.forEach((l, i) => {
			if (i !== 6) expect(after[i]).toBe(l);
		});
	});
	it('removes one line', () => {
		const next = removeLines(doc, 7, 8);
		expect(next.split('\n')).not.toContain('- [ ] 11:00 [[B]]');
		expect(scanDayLines(next, heading).plannerLines.map((l) => l.linkTarget)).toEqual(['A']);
	});
	it('inserts sorted by start time', () => {
		const next = insertBlockResult(doc, heading, ['- [ ] 10:00 [[C]]'], { sorted: true, startMinutes: 600 }).text;
		expect(scanDayLines(next, heading).plannerLines.map((l) => l.linkTarget)).toEqual(['A', 'C', 'B']);
	});
	it('does not insert a duplicate identical line', () => {
		const next = insertBlockResult(doc, heading, ['- [ ] 11:00 [[B]]']).text;
		expect(next).toBe(doc);
	});
	it('creates the heading when absent', () => {
		const bare = '# 2026-07-24\n\nsome text\n';
		const next = insertBlockResult(bare, heading, ['- [ ] 08:00 [[X]]']).text;
		expect(next).toContain('## Day planner\n- [ ] 08:00 [[X]]');
	});
	it('preserves a trailing newline exactly', () => {
		const withTrailing = doc + '\n';
		expect(replaceLine(withTrailing, 6, doc.split('\n')[6]).endsWith('\n')).toBe(true);
	});
});
