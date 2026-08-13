import { describe, it, expect } from 'vitest';
import { findTimedInsertPoint, insertTimedLine, insertBlockResult } from '../src/core/planner-section';
import { buildLineTree } from '../src/core/line-tree';
import { USER_NOTE, LINE } from './fixtures/user-note';

const HEADING = '## Day planner';
const put = (text: string, line: string, start: number | null) =>
	insertTimedLine(text, HEADING, line, start);

/** Start minutes of every timed root line, in document order. */
function timedRoots(text: string): number[] {
	const tree = buildLineTree(text);
	return tree.roots
		.map((i) => tree.nodes[i].line.startMinutes)
		.filter((m): m is number => m != null);
}

describe('placing a new line in the real note', () => {
	it('THE RULE: 12:00 lands after the 10:00 row and before 13:00', () => {
		const out = put(USER_NOTE, '- [ ] 12:00 - 13:00 [[📅 By 2026-08-08 at 12.00h, call - 1 - Acme]]', 12 * 60);
		const lines = out.split('\n');
		const at = lines.findIndex((l) => l.includes('call - 1 - Acme'));
		expect(lines[at - 1]).toBe('- [ ] 10:00 - 11:00 [[🔁 Do - 1 workout - with non-visual media 🏥]]');
		expect(lines[at + 1]).toBe('- [ ] 13:00 - 14:00 ');
	});

	it('is not fooled by the stray 04:00 row at the end of the note', () => {
		// Anchoring on "the last qualifying line in document order" would send every
		// new block to the bottom, because the note ends with an out-of-order row.
		const out = put(USER_NOTE, '- [ ] 12:00 New', 12 * 60);
		expect(out.trimEnd().split('\n').pop()).toBe(
			'\t- [ ] [[🔁 Try to breath for - 1 long breath - through my closed nose 💭]]',
		);
	});

	it('clears a block entirely: 07:30 goes after the 07:00 row AND its children', () => {
		const out = put(USER_NOTE, '- [ ] 07:30 New', 7 * 60 + 30);
		const lines = out.split('\n');
		const at = lines.findIndex((l) => l === '- [ ] 07:30 New');
		expect(lines[at - 1]).toBe('\t- [x] [[🔁 Apply - 5 men or 10 women pumps - of minoxidil 👱‍♂️]]');
		expect(lines[at + 1]).toBe('- [ ] 08:00 - 09:00');
	});

	it('never re-parents an existing child', () => {
		const before = buildLineTree(USER_NOTE);
		const after = buildLineTree(put(USER_NOTE, '- [ ] 07:30 New', 7 * 60 + 30));
		const depthOf = (t: ReturnType<typeof buildLineTree>, text: string) =>
			t.nodes.find((n) => n.line.text === text)?.depth;
		const dream = '[[🔁 Document - 1 dream - of the night as exact as possible 📝]]';
		expect(depthOf(after, dream)).toBe(depthOf(before, dream));
		expect(after.nodes.find((n) => n.line.text === 'New')?.depth).toBe(0);
	});

	it('places an equal time after the existing row with that time', () => {
		const out = put(USER_NOTE, '- [ ] 07:00 Second', 7 * 60);
		const lines = out.split('\n');
		expect(lines.findIndex((l) => l === '- [ ] 07:00 Second')).toBeGreaterThan(LINE.minoxidil);
		expect(lines[lines.findIndex((l) => l === '- [ ] 07:00 Second') + 1]).toBe('- [ ] 08:00 - 09:00');
	});

	it('places a time earlier than everything in front of the first timed row', () => {
		const out = put(USER_NOTE, '- [ ] 03:00 Early', 3 * 60);
		const lines = out.split('\n');
		const at = lines.findIndex((l) => l === '- [ ] 03:00 Early');
		expect(lines[at + 1]).toBe('- [ ] 07:00 - 08:00');
	});

	it('keeps the timed rows in time order for any time of day', () => {
		for (const minutes of [0, 5, 419, 420, 421, 780, 1439]) {
			const out = put(USER_NOTE, `- [ ] ${String(Math.floor(minutes / 60)).padStart(2, '0')}:00 X`, minutes);
			expect(out.split('\n').filter((l) => l.endsWith(' X'))).toHaveLength(1);
		}
	});

	it('does not add a heading the note never had', () => {
		expect(put(USER_NOTE, '- [ ] 12:00 New', 12 * 60)).not.toContain(HEADING);
	});
});

describe('falling back to the heading', () => {
	it('behaves exactly like a plain insert when the note has no timed line', () => {
		const bare = `${HEADING}\n`;
		const line = '- [ ] 09:00 - 10:00 [[X]]';
		expect(insertTimedLine(bare, HEADING, line, 9 * 60)).toBe(insertBlockResult(bare, HEADING, [line]).text);
		expect(insertTimedLine('# Day\n', HEADING, line, 9 * 60)).toBe(insertBlockResult('# Day\n', HEADING, [line]).text);
	});

	it('is a plain insert for an untimed line', () => {
		const doc = `${HEADING}\n- [ ] 09:00 A\n`;
		expect(insertTimedLine(doc, HEADING, '- [ ] Water the plants', null)).toBe(
			insertBlockResult(doc, HEADING, ['- [ ] Water the plants']).text,
		);
	});

	it('does not treat a time inside a code fence as an anchor', () => {
		const doc = ['# Day', '```md', '- [ ] 09:00 example', '```'].join('\n');
		const out = put(doc, '- [ ] 10:00 Real', 10 * 60);
		// Fell back to the heading rather than splicing into the user's code block.
		expect(out).toContain(`${HEADING}\n- [ ] 10:00 Real`);
		expect(out.split('\n').slice(1, 4)).toEqual(['```md', '- [ ] 09:00 example', '```']);
	});

	it('does not treat frontmatter as an anchor', () => {
		const doc = ['---', 'times:', '  - 09:00', '---', '# Day'].join('\n');
		expect(put(doc, '- [ ] 10:00 Real', 10 * 60)).toContain(`${HEADING}\n- [ ] 10:00 Real`);
	});
});

describe('byte-level care', () => {
	const doc = ['- [ ] 09:00 A', '- [ ] 11:00 B', ''].join('\n');

	it('keeps a trailing newline, and does not invent one', () => {
		expect(put(doc, '- [ ] 10:00 New', 10 * 60).endsWith('\n')).toBe(true);
		const noTrailing = '- [ ] 09:00 A';
		expect(put(noTrailing, '- [ ] 10:00 New', 10 * 60).endsWith('\n')).toBe(false);
	});

	it('matches CRLF line endings', () => {
		// `.` does not match `\r` in JavaScript, so a CRLF note used to parse as no
		// lines at all — nothing from it ever reached the timeline.
		const crlf = ['- [ ] 09:00 A\r', '- [ ] 11:00 B\r', ''].join('\n');
		const out = put(crlf, '- [ ] 10:00 New', 10 * 60);
		expect(out.split('\n').filter((l) => l.length > 0)).toEqual([
			'- [ ] 09:00 A\r',
			'- [ ] 10:00 New\r',
			'- [ ] 11:00 B\r',
		]);
	});

	it('refuses to insert a line the note already has', () => {
		expect(put(doc, '- [ ] 09:00 A', 9 * 60)).toBe(doc);
	});

	it('is not blocked by identical UNTIMED children elsewhere', () => {
		// The real note repeats the same routine under several hours; that must not
		// stop a genuinely new row from being written.
		const out = put(USER_NOTE, '- [ ] 12:00 New', 12 * 60);
		expect(out).toContain('- [ ] 12:00 New');
	});

	it('leaves every other line byte-identical', () => {
		const out = put(USER_NOTE, '- [ ] 12:00 New', 12 * 60);
		const before = USER_NOTE.split('\n');
		const after = out.split('\n').filter((l) => l !== '- [ ] 12:00 New');
		expect(after).toEqual(before);
	});
});

describe('findTimedInsertPoint', () => {
	it('reports the anchor indent so the new row is a peer, never a child', () => {
		const doc = ['- [ ] 09:00 A', '\t- [ ] 09:30 nested but timed'].join('\n');
		const point = findTimedInsertPoint(doc, 9 * 60 + 45);
		expect(point.indent).toBe(''); // climbed out to the 09:00 row
		expect(point.at).toBe(2);
		expect(point.fallback).toBe(false);
	});

	it('says so when there is nothing to anchor on', () => {
		expect(findTimedInsertPoint('# Day\n- [ ] no time here\n', 600)).toEqual({
			at: -1,
			indent: '',
			fallback: true,
		});
	});

	it('keeps the note sorted where it already was', () => {
		const doc = ['- [ ] 07:00 A', '- [ ] 09:00 B', '- [ ] 13:00 C'].join('\n');
		for (const m of [360, 480, 600, 900]) {
			const out = insertTimedLine(doc, HEADING, `- [ ] ${Math.floor(m / 60)}:00 X`, m);
			const order = timedRoots(out);
			expect([...order].sort((a, b) => a - b)).toEqual(order);
		}
	});
});
