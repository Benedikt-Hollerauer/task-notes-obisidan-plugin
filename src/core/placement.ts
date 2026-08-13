// Locate an event's planner line inside a daily note. Pure (no Obsidian imports).

import { buildLineTree } from './line-tree';

/** The identifying part of a placement needed to re-find its line. */
export interface PlacementRef {
	lineNo: number;
	raw: string;
}

/**
 * The index of the placement's line in `content`, or -1.
 *
 * Never falls back to the recorded lineNo when the raw text isn't there: the
 * index can lag the file by a flush cycle, and acting on a stale index would
 * edit or delete an unrelated line.
 */
export function findPlacementLine(content: string, placement: PlacementRef): number {
	const lines = content.split('\n');
	const { lineNo, raw } = placement;
	if (raw == null) return lineNo >= 0 && lineNo < lines.length ? lineNo : -1;
	if (lineNo >= 0 && lineNo < lines.length && lines[lineNo] === raw) return lineNo;

	// Two identical lines are entirely legal (`- 09:00 Standup` on two days' worth
	// of log entries). Take the one NEAREST the remembered index rather than the
	// first in the file, so an edit lands on the block that was actually dragged.
	let best = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i] !== raw) continue;
		if (best < 0 || Math.abs(i - lineNo) < Math.abs(best - lineNo)) best = i;
	}
	return best;
}

/**
 * The line index of a BODY row, resolved inside its own block's subtree.
 *
 * A daily note legitimately contains byte-identical child lines — the same
 * routine appears under several hours. The raw text alone therefore does not
 * identify one of them. Find the parent first, then look only within the lines
 * it owns. Returns -1 rather than guessing, so a stale reference writes nothing.
 */
export function findBodyLine(content: string, parent: PlacementRef, child: PlacementRef): number {
	const parentLine = findPlacementLine(content, parent);
	if (parentLine < 0) return -1;

	const tree = buildLineTree(content);
	const node = tree.nodes[tree.byLineNo.get(parentLine) ?? -1];
	if (!node) return -1;

	const lines = content.split('\n');
	let best = -1;
	for (let i = parentLine + 1; i < Math.min(node.subtreeEndLine, lines.length); i++) {
		if (lines[i] !== child.raw) continue;
		if (best < 0 || Math.abs(i - child.lineNo) < Math.abs(best - child.lineNo)) best = i;
	}
	return best;
}
