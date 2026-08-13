// THE SUB-ITEM THAT WAS DELETED AND NEVER ARRIVED.
//
// `SyncEngine.moveLineAcrossDays` does three things in order:
//   1. read the source note and snapshot the block   (vault.read)
//   2. await a write that inserts that snapshot into the destination
//   3. await a write that removes the block from the source
//
// Step 3 recomputes the subtree from the note's CURRENT text — deliberately, so a
// concurrent edit can never make it delete somebody else's lines. But that same
// re-derivation is what loses data: anything added under the block during step 2
// is inside the CURRENT subtree, so it is removed from the source, while the
// destination only ever received the step-1 snapshot. The line is gone from both.
//
// And it is silent: `removed` is true, so the "Move only partly completed" warning
// never fires. Obsidian Sync pulling a change, or simply typing fast, is enough.
//
// The guard is a comparison between the body that was COPIED and the body that is
// PRESENT at removal time. `blockBodyAt` is the shared helper both sides use.

import { describe, it, expect } from 'vitest';
import { blockBodyAt, buildLineTree } from '../src/core/line-tree';
import { insertTimedBlockResult, removeLines } from '../src/core/planner-section';
import { parseListLine, serializePlannerLine } from '../src/core/planner-line';

const HEADING = '## Day planner';

/**
 * The real move, including the window between the read and the removal.
 *
 * `sourceAtRemoval` is what the file says when step 3 runs — the same string as
 * `sourceAtRead` when nothing raced, different when something did. `guard` toggles
 * the fix so these tests can show the old behaviour losing the line.
 */
function moveBlock(
	sourceAtRead: string,
	sourceAtRemoval: string,
	target: string,
	lineNo: number,
	newStart: number | null,
	guard = true,
) {
	const lines = sourceAtRead.split('\n');
	const parsed = parseListLine(lines[lineNo], lineNo)!;
	const moved = serializePlannerLine({ ...parsed, startMinutes: newStart, endMinutes: null });
	const copiedBody = blockBodyAt(sourceAtRead, lineNo) ?? [];
	const block = [moved, ...copiedBody];

	const outcome = insertTimedBlockResult(target, HEADING, block, newStart, {
		sorted: true,
		startMinutes: newStart,
	});
	if (!outcome.inserted) return { source: sourceAtRemoval, target: outcome.text, removed: false };

	// Step 3, against the CURRENT text.
	const i = lineNo;
	const currentBody = blockBodyAt(sourceAtRemoval, i);
	if (currentBody === null) return { source: sourceAtRemoval, target: outcome.text, removed: false };

	// THE FIX: only remove what we actually carried across.
	const bodyDrifted =
		currentBody.length !== copiedBody.length || currentBody.some((l, k) => l !== copiedBody[k]);
	if (guard && bodyDrifted) {
		return { source: sourceAtRemoval, target: outcome.text, removed: false };
	}

	const tree = buildLineTree(sourceAtRemoval);
	const node = tree.nodes[tree.byLineNo.get(i) ?? -1];
	return {
		source: removeLines(sourceAtRemoval, i, node ? node.subtreeEndLine : i + 1),
		target: outcome.text,
		removed: true,
	};
}

const SOURCE_AT_READ = [HEADING, '- [ ] 09:00 - 10:00 standup', '\t- [ ] agenda', ''].join('\n');
// A sub-item typed (or pulled by Sync) while the destination write was in flight.
const SOURCE_AT_REMOVAL = [
	HEADING,
	'- [ ] 09:00 - 10:00 standup',
	'\t- [ ] agenda',
	'\t- [ ] ask about the budget',
	'',
].join('\n');
const EMPTY_TARGET = `${HEADING}\n`;

describe('a sub-item added while the move is in flight', () => {
	it('THE BUG: it is deleted from the source and never reaches the destination', () => {
		const r = moveBlock(SOURCE_AT_READ, SOURCE_AT_REMOVAL, EMPTY_TARGET, 1, 660, false);
		// Gone from where it was typed…
		expect(r.source).not.toContain('ask about the budget');
		// …and never written to where the block went.
		expect(r.target).not.toContain('ask about the budget');
		// And nothing warned, because the removal "succeeded".
		expect(r.removed).toBe(true);
	});

	it('THE FIX: the source is left alone, so the line still exists somewhere', () => {
		const r = moveBlock(SOURCE_AT_READ, SOURCE_AT_REMOVAL, EMPTY_TARGET, 1, 660, true);
		expect(r.source).toContain('ask about the budget');
		expect(r.source).toContain('agenda');
		// removed === false is what raises "Move only partly completed", which tells
		// the user both copies are live. Duplication is recoverable; deletion is not.
		expect(r.removed).toBe(false);
	});

	it('an ordinary move with no race still removes the source, exactly as before', () => {
		const r = moveBlock(SOURCE_AT_READ, SOURCE_AT_READ, EMPTY_TARGET, 1, 660, true);
		expect(r.removed).toBe(true);
		expect(r.source).not.toContain('standup');
		expect(r.target).toContain('standup');
		expect(r.target).toContain('agenda');
	});

	it('a childless row is unaffected by the guard', () => {
		const src = `${HEADING}\n- [ ] 09:00 - 10:00 standup\n`;
		const r = moveBlock(src, src, EMPTY_TARGET, 1, 660, true);
		expect(r.removed).toBe(true);
		expect(r.source).not.toContain('standup');
	});

	it('a sub-item EDITED (not added) during the window is also protected', () => {
		const edited = [HEADING, '- [ ] 09:00 - 10:00 standup', '\t- [x] agenda', ''].join('\n');
		const r = moveBlock(SOURCE_AT_READ, edited, EMPTY_TARGET, 1, 660, true);
		// The tick happened after the copy, so the destination has the unticked
		// version. Removing the source would throw the tick away.
		expect(r.removed).toBe(false);
		expect(r.source).toContain('- [x] agenda');
	});
});

describe('blockBodyAt', () => {
	it('returns only the nested rows, not the row itself', () => {
		expect(blockBodyAt(SOURCE_AT_READ, 1)).toEqual(['\t- [ ] agenda']);
	});

	it('returns an empty body for a childless row, and null for a non-row', () => {
		expect(blockBodyAt(`${HEADING}\n- [ ] 09:00 x\n`, 1)).toEqual([]);
		expect(blockBodyAt(SOURCE_AT_READ, 0)).toBeNull();
	});
});
