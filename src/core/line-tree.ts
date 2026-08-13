// Indentation as structure: which lines belong to which. Pure (no Obsidian).
//
// A daily note written by hand nests its detail under the line it belongs to:
//
//   - [ ] 07:00 - 08:00
//   	- [ ] Document 1 dream of the night
//   	- [x] Apply minoxidil
//
// The two indented lines are not two more events at no particular time — they
// are the body of the 07:00 block. This module is the only place that knows it.
//
// It parses EVERY list line, not just the ones `scanDayLines` keeps: a group
// label like `- ==📅 Monthly - First Mon==` has no checkbox and no time, so no
// scan returns it, yet it is a real parent of the lines beneath it.

import type { PlannerLine } from '../types';
import { parseListLine, isChecked } from './planner-line';

/** A tab advances to the next multiple of this, as in an editor. */
export const TAB_WIDTH = 4;

export interface LineNode {
	line: PlannerLine;
	/** Index into `LineTree.nodes` of the parent, or -1 for a root. */
	parent: number;
	/** Indices into `LineTree.nodes`, in document order. */
	children: number[];
	/** Tree depth (0 = root), which is not the same as visual indent depth. */
	depth: number;
	/** Visual indent width, in columns. */
	width: number;
	/** Nearest STRICT ancestor whose line carries a time, or -1. */
	timedAncestor: number;
	/**
	 * Exclusive LINE index just past this node and everything under it, ignoring
	 * trailing blank lines — so splicing here can never land after a note's final
	 * empty string and swallow its trailing newline.
	 */
	subtreeEndLine: number;
}

export interface LineTree {
	/** Every list line in the note body, in document order. */
	nodes: LineNode[];
	/** Indices of root nodes. */
	roots: number[];
	byLineNo: Map<number, number>;
	/** First line after YAML frontmatter. */
	bodyStart: number;
}

/** One row of a block's body. `line` is shared, never copied. */
export interface BodyRow {
	line: PlannerLine;
	/** Depth relative to the block: 1 = a direct child. */
	depth: number;
}

/**
 * Index of the first line after YAML frontmatter (0 when there is none).
 *
 * Frontmatter is data, not content: a `tags:` list in it is written with the
 * same `- ` markers as a task and must never become a line on the timeline.
 */
export function frontmatterEnd(lines: string[]): number {
	if (lines[0]?.trim() !== '---') return 0;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === '---') return i + 1;
	}
	return 0; // unterminated: treat the whole note as body rather than hide it
}

/** Visual width of a leading-whitespace run, with real tab stops. */
export function indentWidth(indent: string): number {
	let w = 0;
	for (const ch of indent) {
		if (ch === '\t') w += TAB_WIDTH - (w % TAB_WIDTH);
		else w += 1;
	}
	return w;
}

function leadingWidth(raw: string): number {
	const m = raw.match(/^[ \t]*/);
	return indentWidth(m ? m[0] : '');
}

const FENCE_RE = /^[ \t]*(```|~~~)/;

/**
 * Build the containment tree for a note.
 *
 * Parenthood is decided by an indent STACK, never by dividing the width by a
 * step: a line's parent is the nearest line above it with a strictly smaller
 * indent. That is correct for tabs, for 2-, 3- and 4-space indentation, and for
 * a note that mixes them — no assumption about the user's editor is needed.
 */
export function buildLineTree(text: string): LineTree {
	const lines = text.split('\n');
	const bodyStart = frontmatterEnd(lines);
	const nodes: LineNode[] = [];
	const roots: number[] = [];
	const byLineNo = new Map<number, number>();

	/** Open ancestors, innermost last. */
	const stack: number[] = [];
	/** Last non-blank line seen, so a subtree never ends on blank lines. */
	let lastContent = bodyStart - 1;
	let inFence = false;

	const closeTo = (width: number) => {
		while (stack.length > 0 && nodes[stack[stack.length - 1]].width >= width) {
			nodes[stack.pop()!].subtreeEndLine = lastContent + 1;
		}
	};

	for (let i = bodyStart; i < lines.length; i++) {
		const raw = lines[i];

		if (FENCE_RE.test(raw)) {
			// A fence at column 0 ends whatever list preceded it; an indented one is
			// part of the item it sits under. Either way its contents are not lines.
			if (leadingWidth(raw) === 0) closeTo(0);
			inFence = !inFence;
			lastContent = i;
			continue;
		}
		if (inFence) {
			if (raw.trim().length > 0) lastContent = i;
			continue;
		}

		const parsed = parseListLine(raw, i);
		if (!parsed) {
			if (raw.trim().length === 0) continue; // blank lines keep a list open
			// A heading or paragraph at column 0 closes everything; an indented one
			// is a continuation of the item above it.
			if (leadingWidth(raw) === 0) closeTo(0);
			lastContent = i;
			continue;
		}

		const width = indentWidth(parsed.indent);
		closeTo(width);
		const parent = stack.length > 0 ? stack[stack.length - 1] : -1;
		const index = nodes.length;
		nodes.push({
			line: parsed,
			parent,
			children: [],
			depth: stack.length,
			width,
			timedAncestor:
				parent < 0 ? -1 : nodes[parent].line.startMinutes != null ? parent : nodes[parent].timedAncestor,
			subtreeEndLine: i + 1,
		});
		byLineNo.set(i, index);
		if (parent >= 0) nodes[parent].children.push(index);
		else roots.push(index);
		stack.push(index);
		lastContent = i;
	}

	closeTo(0);
	while (stack.length > 0) nodes[stack.pop()!].subtreeEndLine = lastContent + 1;

	return { nodes, roots, byLineNo, bodyStart };
}

/** Node index of the nearest timed ancestor of `lineNo`, or -1. */
export function bodyOwnerOf(tree: LineTree, lineNo: number): number {
	const index = tree.byLineNo.get(lineNo);
	return index == null ? -1 : tree.nodes[index].timedAncestor;
}

/**
 * Is this line drawn INSIDE another block rather than as a block of its own?
 *
 * The same question is asked by the index (which events to emit), by reconcile
 * (which lines may rename a file) and by the tests. It was written out three
 * times, twice with the polarity flipped — so a change to one could silently
 * disagree with the others about which of the user's files may be renamed.
 */
export function isBodyRow(tree: LineTree, lineNo: number): boolean {
	return bodyOwnerOf(tree, lineNo) >= 0;
}

/** Every line nested under `lineNo`, in document order. Empty when there is none. */
export function bodyOf(tree: LineTree, lineNo: number): BodyRow[] {
	const index = tree.byLineNo.get(lineNo);
	if (index == null) return [];
	const base = tree.nodes[index].depth;
	const rows: BodyRow[] = [];
	const walk = (i: number) => {
		for (const child of tree.nodes[i].children) {
			rows.push({ line: tree.nodes[child].line, depth: tree.nodes[child].depth - base });
			walk(child);
		}
	};
	walk(index);
	return rows;
}

/** How many of a body's CHECKBOX rows are ticked. Labels don't count. */
export function bodyProgress(rows: BodyRow[]): { done: number; total: number } {
	let done = 0;
	let total = 0;
	for (const row of rows) {
		if (!row.line.hasCheckbox) continue;
		total += 1;
		if (isChecked(row.line)) done += 1;
	}
	return { done, total };
}
