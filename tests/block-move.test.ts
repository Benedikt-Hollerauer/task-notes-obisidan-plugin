import { describe, it, expect } from 'vitest';
import { buildLineTree } from '../src/core/line-tree';
import {
	insertBlockResult,
	insertTimedBlock,
	insertTimedBlockResult,
	removeLines,
} from '../src/core/planner-section';
import { parseListLine, serializePlannerLine } from '../src/core/planner-line';
import { USER_NOTE, LINE } from './fixtures/user-note';

const HEADING = '## Day planner';

/**
 * Exactly what `SyncEngine.moveLineAcrossDays` does to the two documents, minus
 * Obsidian: read the block, insert it whole, and remove it from the source ONLY
 * if the destination took it.
 *
 * The gate is the point. Calling a `.text`-only insert here and removing
 * unconditionally is precisely the shape of the bug that deleted a block from
 * both notes, and a helper that skips it cannot catch a regression.
 */
function moveBlock(source: string, target: string, lineNo: number, newStart: number | null) {
	const lines = source.split('\n');
	const tree = buildLineTree(source);
	const node = tree.nodes[tree.byLineNo.get(lineNo)!];
	const parsed = parseListLine(lines[lineNo], lineNo)!;
	const moved = serializePlannerLine({ ...parsed, startMinutes: newStart, endMinutes: null });
	const block = [moved, ...lines.slice(lineNo + 1, node.subtreeEndLine)];
	const outcome = insertTimedBlockResult(target, HEADING, block, newStart, {
		sorted: true,
		startMinutes: newStart,
	});
	return {
		source: outcome.inserted ? removeLines(source, lineNo, node.subtreeEndLine) : source,
		target: outcome.text,
		inserted: outcome.inserted,
		block,
	};
}

describe('dragging a block to another day takes its body with it', () => {
	const empty = `${HEADING}\n`;

	it('THE BUG: the children travel instead of being left behind', () => {
		// Before this, the move took one line: the 07:00 row arrived at tomorrow
		// empty and its two sub-items stayed orphaned in yesterday's note.
		const { source, target, block } = moveBlock(USER_NOTE, empty, LINE.row0700, 9 * 60);

		expect(block).toEqual([
			'- [ ] 09:00',
			'\t- [ ] [[🔁 Document - 1 dream - of the night as exact as possible 📝]]',
			'\t- [x] [[🔁 Apply - 5 men or 10 women pumps - of minoxidil 👱‍♂️]]',
		]);
		expect(target).toContain('\t- [ ] [[🔁 Document - 1 dream');
		expect(source).not.toContain('Document - 1 dream');
		expect(source).not.toContain('minoxidil');
	});

	it('arrives contiguous — the parent immediately followed by its own rows', () => {
		const { target } = moveBlock(USER_NOTE, empty, LINE.row0800, 15 * 60);
		expect(target.split('\n').slice(1, 5)).toEqual([
			'- [ ] 15:00',
			'\t- ==📅 Monthly - First Mon - 2026-09-07==',
			'\t\t- [ ] [[📅 Attend - 1h - monthly planning at Logisitsy - First mon at 08.00h ✍️]]',
			'\t- [ ] [[🔁 Do - 5m - of exercises for improving my posture 🧘‍♂️]]',
		]);
	});

	it('takes nothing extra: the source keeps every line that was not part of the block', () => {
		const { source } = moveBlock(USER_NOTE, empty, LINE.row0700, 9 * 60);
		const before = USER_NOTE.split('\n');
		const after = source.split('\n');
		expect(before.length - after.length).toBe(3); // the row and its two children
		// Its neighbours are untouched, above and below.
		expect(after).toContain('- [ ] 08:00 - 09:00');
		expect(after).toContain("- ==[[All tasks & to do's are in a particular order. Second task starts only after first completes]]==");
	});

	it('moves a childless row as a single line, exactly as before', () => {
		const { block, source } = moveBlock(USER_NOTE, empty, LINE.row1300, 6 * 60);
		expect(block).toEqual(['- [ ] 06:00']);
		expect(USER_NOTE.split('\n').length - source.split('\n').length).toBe(1);
	});

	it('keeps the last row of a note from eating the trailing newline', () => {
		const { source } = moveBlock(USER_NOTE, empty, LINE.row0400, 5 * 60);
		expect(source.endsWith('\n')).toBe(true);
		expect(source).not.toContain('Try to breath');
	});
});

describe('insertBlockResult', () => {
	it('creates the heading with the whole block when the section is missing', () => {
		const out = insertBlockResult('# Day\n', HEADING, ['- [ ] 09:00 A', '\t- [ ] child']);
		expect(out.text).toBe(`# Day\n${HEADING}\n- [ ] 09:00 A\n\t- [ ] child\n`);
		expect(out.inserted).toBe(true);
	});

	it('still refuses to duplicate a block whose first line is already there', () => {
		const doc = `${HEADING}\n- [ ] 09:00 A\n\t- [ ] child\n`;
		const out = insertBlockResult(doc, HEADING, ['- [ ] 09:00 A', '\t- [ ] child']);
		expect(out.text).toBe(doc);
		expect(out.inserted).toBe(false);
	});
});

describe('removeLines', () => {
	const doc = 'a\nb\nc\nd';

	it('removes a range', () => {
		expect(removeLines(doc, 1, 3)).toBe('a\nd');
	});

	it('ignores an empty, negative or out-of-range span', () => {
		expect(removeLines(doc, 2, 2)).toBe(doc);
		expect(removeLines(doc, -1, 2)).toBe(doc);
		expect(removeLines(doc, 9, 12)).toBe(doc);
	});

	it('clamps a range that runs past the end', () => {
		expect(removeLines(doc, 2, 99)).toBe('a\nb');
	});
});

describe('a moved block lands in time order in its new day', () => {
	const target = ['- [ ] 06:00 Wake', '- [ ] 12:00 Lunch', ''].join('\n');

	it('slots between the destination rows, whole', () => {
		const lines = USER_NOTE.split('\n');
		const tree = buildLineTree(USER_NOTE);
		const node = tree.nodes[tree.byLineNo.get(LINE.row0700)!];
		const block = ['- [ ] 09:00', ...lines.slice(LINE.row0700 + 1, node.subtreeEndLine)];
		const out = insertTimedBlock(target, HEADING, block, 9 * 60);

		expect(out.split('\n')).toEqual([
			'- [ ] 06:00 Wake',
			'- [ ] 09:00',
			'\t- [ ] [[🔁 Document - 1 dream - of the night as exact as possible 📝]]',
			'\t- [x] [[🔁 Apply - 5 men or 10 women pumps - of minoxidil 👱‍♂️]]',
			'- [ ] 12:00 Lunch',
			'',
		]);
	});

	it("keeps the block's shape when the anchor sits at a different indent", () => {
		const nested = ['- [ ] 06:00 Wake', '\t- [ ] 08:00 Nested anchor', ''].join('\n');
		const out = insertTimedBlock(nested, HEADING, ['- [ ] 09:00 Root', '\t- [ ] child'], 9 * 60);
		// The anchor climbs out to the 06:00 row, so the block stays at top level.
		expect(out.split('\n')).toEqual([
			'- [ ] 06:00 Wake',
			'\t- [ ] 08:00 Nested anchor',
			'- [ ] 09:00 Root',
			'\t- [ ] child',
			'',
		]);
	});
});

describe('a destination that already has the line refuses the move', () => {
	// THE DATA LOSS. moveLineAcrossDays used to insert, get a silent no-op, and
	// then remove the source anyway — deleting the block AND its sub-items from
	// both notes. The insert now reports, and the removal is gated on it.
	const HAS_IT = ['- [ ] 06:00 Wake', '- [ ] 09:00', '- [ ] 12:00 Lunch', ''].join('\n');

	it('reports that it did not insert, and returns the text untouched', () => {
		const out = insertTimedBlockResult(HAS_IT, HEADING, ['- [ ] 09:00', '\t- [ ] child'], 9 * 60);
		expect(out.inserted).toBe(false);
		expect(out.reason).toBe('duplicate');
		expect(out.text).toBe(HAS_IT);
	});

	it('reports the same for an untimed block, which takes the other path', () => {
		const doc = `${HEADING}\n- [ ] Water the plants\n`;
		const out = insertBlockResult(doc, HEADING, ['- [ ] Water the plants']);
		expect(out.inserted).toBe(false);
		expect(out.text).toBe(doc);
	});

	it('THE PROOF: with the removal gated, the source keeps the block and its children', () => {
		const lines = USER_NOTE.split('\n');
		const tree = buildLineTree(USER_NOTE);
		const node = tree.nodes[tree.byLineNo.get(LINE.row0700)!];
		const block = ['- [ ] 09:00', ...lines.slice(LINE.row0700 + 1, node.subtreeEndLine)];

		const attempt = insertTimedBlockResult(HAS_IT, HEADING, block, 9 * 60);
		// The gate: only remove when the destination accepted it.
		const source = attempt.inserted
			? removeLines(USER_NOTE, LINE.row0700, node.subtreeEndLine)
			: USER_NOTE;

		expect(attempt.inserted).toBe(false);
		expect(source).toBe(USER_NOTE);
		expect(source).toContain('- [ ] 07:00 - 08:00');
		expect(source).toContain('Document - 1 dream');
		expect(source).toContain('minoxidil');
		expect(attempt.text).toBe(HAS_IT);
	});

	it('still inserts, and says so, when the destination does not have it', () => {
		const out = insertTimedBlockResult(HAS_IT, HEADING, ['- [ ] 10:00 New'], 10 * 60);
		expect(out.inserted).toBe(true);
		expect(out.text).toContain('- [ ] 10:00 New');
	});
});
