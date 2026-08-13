// Locate and edit the planner section of a daily note. Pure (no Obsidian imports).
// All edits are minimal-diff: only the targeted line(s) change; every other line
// (and the trailing newline) is byte-preserved via split('\n') / join('\n').

import type { PlannerLine } from '../types';
import { parsePlannerLine, parseListLine } from './planner-line';
import { buildLineTree, frontmatterEnd, type LineTree } from './line-tree';

export interface PlannerSection {
	found: boolean;
	/** Line index of the heading, or -1. */
	headingLineNo: number;
	/** Heading level (1–6), or 0 when the configured heading isn't a markdown heading. */
	headingLevel: number;
	/** First content line index (after the heading). */
	start: number;
	/** Exclusive end index of the section. */
	end: number;
}

interface HeadingInfo {
	level: number;
	text: string;
}

function parseHeading(line: string): HeadingInfo | null {
	const m = line.match(/^(#{1,6})\s+(.*?)\s*$/);
	if (!m) return null;
	return { level: m[1].length, text: m[2].trim() };
}

/** Interpret the configured planner heading string. */
function parseConfiguredHeading(heading: string): HeadingInfo {
	const parsed = parseHeading(heading);
	if (parsed) return parsed;
	return { level: 0, text: heading.trim() };
}

function lineIsTargetHeading(line: string, target: HeadingInfo): boolean {
	const h = parseHeading(line);
	if (target.level === 0) {
		return line.trim().toLowerCase() === target.text.toLowerCase();
	}
	if (!h) return false;
	return h.level === target.level && h.text.toLowerCase() === target.text.toLowerCase();
}

/** True if `line` is the configured planner heading. */
export function matchesConfiguredHeading(line: string, heading: string): boolean {
	return lineIsTargetHeading(line, parseConfiguredHeading(heading));
}

/** Find the planner section within `text`. */
export function getPlannerSection(text: string, heading: string): PlannerSection {
	const target = parseConfiguredHeading(heading);
	const lines = text.split('\n');

	let headingLineNo = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lineIsTargetHeading(lines[i], target)) {
			headingLineNo = i;
			break;
		}
	}

	if (headingLineNo === -1) {
		return { found: false, headingLineNo: -1, headingLevel: target.level, start: -1, end: -1 };
	}

	// A non-heading configured heading has no level: ANY markdown heading below it
	// terminates the section (level 6 = the loosest bound), otherwise a following
	// `## Other` section would be swallowed into the planner.
	const boundaryLevel = target.level === 0 ? 6 : target.level;
	let end = lines.length;
	for (let i = headingLineNo + 1; i < lines.length; i++) {
		const h = parseHeading(lines[i]);
		if (h && h.level <= boundaryLevel) {
			end = i;
			break;
		}
	}

	return {
		found: true,
		headingLineNo,
		headingLevel: target.level,
		start: headingLineNo + 1,
		end,
	};
}

/** Every line a day's timeline should show, split by who owns it. */
export interface DayScan {
	/** Checkbox lines inside the planner section — the writable, renameable set. */
	plannerLines: PlannerLine[];
	/** Timed list lines anywhere else in the note. Render-only. */
	extraLines: PlannerLine[];
	/**
	 * Which lines are nested under which. The two arrays above stay flat and keep
	 * exactly their historical contents; nesting is a separate question, answered
	 * here so a line can be shown as the BODY of the block above it rather than as
	 * an event of its own.
	 */
	tree: LineTree;
}

/**
 * Scan a whole daily note for things that belong on a timeline.
 *
 * Inside the planner section the grammar is unchanged (checkbox items, time
 * optional). Outside it, a time is MANDATORY — that is what keeps prose bullets
 * under `## Notes` off the timeline while `- 16:00 Reviewed the deck` under
 * `## Log` shows up. Nothing outside the section may claim a file, so this
 * widens only what is *displayed*, never what is automatically rewritten.
 */
export function scanDayLines(text: string, heading: string): DayScan {
	const section = getPlannerSection(text, heading);
	const lines = text.split('\n');
	const plannerLines: PlannerLine[] = [];
	const extraLines: PlannerLine[] = [];
	const bodyStart = frontmatterEnd(lines);

	for (let i = bodyStart; i < lines.length; i++) {
		const inSection = section.found && i >= section.start && i < section.end;
		const planner = inSection ? parsePlannerLine(lines[i], i) : null;
		if (planner) {
			plannerLines.push(planner);
			continue;
		}
		// A timed bullet with no checkbox is shown wherever it is — including inside
		// the section, where it would otherwise be invisible — but stays render-only.
		const listed = parseListLine(lines[i], i);
		if (listed && listed.startMinutes != null) extraLines.push(listed);
	}

	return { plannerLines, extraLines, tree: buildLineTree(text) };
}

/** Replace exactly one line (by index). No-op if out of range or unchanged. */
export function replaceLine(text: string, lineNo: number, newLine: string): string {
	const lines = text.split('\n');
	if (lineNo < 0 || lineNo >= lines.length || lines[lineNo] === newLine) return text;
	lines[lineNo] = newLine;
	return lines.join('\n');
}

/** Remove the lines in `[from, to)`. No-op when the range is empty or invalid. */
export function removeLines(text: string, from: number, to: number): string {
	const lines = text.split('\n');
	if (from < 0 || from >= lines.length || to <= from) return text;
	lines.splice(from, Math.min(to, lines.length) - from);
	return lines.join('\n');
}

export interface InsertOptions {
	/** Keep the section sorted by start time when inserting. */
	sorted?: boolean;
	/** Start minutes of the inserted block (used for sorted placement). */
	startMinutes?: number | null;
}

/** What an insert did, for a caller that must not act on an insert that didn't happen. */
export interface InsertResult {
	/** The new text. Byte-identical to the input when `inserted` is false. */
	text: string;
	/** True only when the block was actually spliced in. */
	inserted: boolean;
	/** Why nothing happened, so the caller can say something honest. */
	reason?: 'duplicate' | 'empty';
}

/**
 * Insert a planner line together with the lines nested under it, as one unit,
 * and say whether it actually inserted.
 *
 * `block[0]` is the line itself; the rest are its body, already indented
 * relative to it. They are spliced contiguously so a block can never arrive at
 * its destination separated from its own sub-items.
 *
 * There is deliberately no `.text`-only wrapper: a caller that removes the
 * source afterwards MUST read `inserted`, because a refused insert followed by
 * an unconditional removal is how a block gets deleted from BOTH notes.
 */
export function insertBlockResult(
	text: string,
	heading: string,
	block: string[],
	options: InsertOptions = {},
): InsertResult {
	if (block.length === 0) return { text, inserted: false, reason: 'empty' };
	const newLine = block[0];
	const section = getPlannerSection(text, heading);
	const lines = text.split('\n');

	// Create the heading + block at the end if the section is missing.
	if (!section.found) {
		const needsBlankLine = text.length > 0 && !text.endsWith('\n');
		const prefix = text.length === 0 ? '' : needsBlankLine ? '\n' : '';
		return { text: `${text}${prefix}${heading}\n${block.join('\n')}\n`, inserted: true };
	}

	// Avoid inserting a duplicate identical line.
	for (let i = section.start; i < section.end; i++) {
		if (lines[i] === newLine) return { text, inserted: false, reason: 'duplicate' };
	}

	let insertAt = section.end;
	if (options.sorted && options.startMinutes != null) {
		insertAt = section.start;
		for (let i = section.start; i < section.end; i++) {
			// Ordering looks at every list line, including timed ones without a
			// checkbox, so an insert lands in the right place among all of them.
			const parsed = parseListLine(lines[i], i);
			// Blank/non-list lines must not advance the cursor — otherwise an
			// insert lands after the section's trailing blank lines.
			if (!parsed) continue;
			if (parsed.startMinutes == null || parsed.startMinutes <= options.startMinutes) {
				insertAt = i + 1;
			} else {
				break;
			}
		}
	} else {
		// Insert after the last non-empty line in the section to avoid trailing gaps.
		insertAt = section.start;
		for (let i = section.start; i < section.end; i++) {
			if (lines[i].trim().length > 0) insertAt = i + 1;
		}
		if (insertAt < section.start) insertAt = section.start;
	}

	lines.splice(insertAt, 0, ...block);
	return { text: lines.join('\n'), inserted: true };
}

export interface TimedInsertPoint {
	/** Line index to splice at. -1 when `fallback` is true. */
	at: number;
	/** Indent the new row must carry — its anchor's own. */
	indent: string;
	/** The note has no timed line to anchor on: fall back to the heading. */
	fallback: boolean;
}

/**
 * Where a new timed line goes: its own row, in time order, wherever the note
 * keeps its times.
 *
 * No heading is consulted and no structure is assumed. The anchor is the timed
 * line with the greatest start at or before the new one — greatest START, not
 * last in the document, so a note that ends with a stray `04:00` row doesn't
 * drag every new block to the bottom. The insert lands just past that anchor's
 * entire indented subtree, at the anchor's own indent, so an existing block
 * never loses a child and the new line is never adopted as one.
 */
export function findTimedInsertPoint(text: string, startMinutes: number): TimedInsertPoint {
	const tree = buildLineTree(text);
	const timed = tree.nodes.filter((n) => n.line.startMinutes != null);
	if (timed.length === 0) return { at: -1, indent: '', fallback: true };

	let anchor: (typeof timed)[number] | null = null;
	for (const node of timed) {
		if (node.line.startMinutes! > startMinutes) continue;
		// `>=` breaks a tie towards the LAST line with that time, so a second 07:00
		// block lands after the existing one rather than jumping ahead of it.
		if (!anchor || node.line.startMinutes! >= anchor.line.startMinutes!) anchor = node;
	}

	if (!anchor) {
		// Earlier than everything: go in front of the first timed line.
		const first = timed[0];
		return { at: first.line.lineNo, indent: first.line.indent, fallback: false };
	}

	// Climb to the outermost timed row: a new block is a peer of the day's rows,
	// not something swallowed into the body of one of them.
	let outermost = anchor;
	for (let p = anchor.parent; p >= 0; p = tree.nodes[p].parent) {
		if (tree.nodes[p].line.startMinutes != null) outermost = tree.nodes[p];
	}
	return { at: outermost.subtreeEndLine, indent: outermost.line.indent, fallback: false };
}

/** Move a block from one indent to another, keeping its internal shape. */
function reindentBlock(block: string[], from: string, to: string): string[] {
	if (from === to) return block;
	return block.map((line) => (line.startsWith(from) ? to + line.slice(from.length) : line));
}

/**
 * Insert one line by the placement rule above, re-indented to match its anchor.
 * An untimed line, or a note with no timed line at all, falls through to
 * `insertBlockResult` — which is what puts the first line of a brand-new day
 * under the configured heading.
 */
export function insertTimedLine(
	text: string,
	heading: string,
	newLine: string,
	startMinutes: number | null,
	options: InsertOptions = {},
): string {
	return insertTimedBlock(text, heading, [newLine], startMinutes, options);
}

/**
 * Insert a line together with the lines nested under it, by the placement rule.
 * The whole block shifts to the anchor's indent as one, so its own shape — which
 * row owns which — is exactly what it was in the note it came from.
 */
export function insertTimedBlock(
	text: string,
	heading: string,
	block: string[],
	startMinutes: number | null,
	options: InsertOptions = {},
): string {
	return insertTimedBlockResult(text, heading, block, startMinutes, options).text;
}

/** As `insertTimedBlock`, but says whether it actually inserted. See `insertBlockResult`. */
export function insertTimedBlockResult(
	text: string,
	heading: string,
	block: string[],
	startMinutes: number | null,
	options: InsertOptions = {},
): InsertResult {
	if (block.length === 0) return { text, inserted: false, reason: 'empty' };
	if (startMinutes == null) return insertBlockResult(text, heading, block, options);

	const point = findTimedInsertPoint(text, startMinutes);
	if (point.fallback) return insertBlockResult(text, heading, block, options);

	const lines = text.split('\n');
	const rootIndent = block[0].match(/^[ \t]*/)?.[0] ?? '';
	const placed = reindentBlock(block, rootIndent, point.indent);

	// A line the note already has is not inserted twice. Checked on the block's
	// own first line only: identical UNTIMED children are normal in a day plan and
	// must not block a genuinely new row.
	for (const line of lines) {
		if (line === placed[0]) return { text, inserted: false, reason: 'duplicate' };
	}

	// Match the note's own line endings, so one LF line can't appear among CRLF.
	const neighbour = lines[Math.max(0, Math.min(point.at, lines.length - 1) - 1)] ?? '';
	const withEol = neighbour.endsWith('\r')
		? placed.map((l) => (l.endsWith('\r') ? l : `${l}\r`))
		: placed.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

	lines.splice(point.at, 0, ...withEol);
	return { text: lines.join('\n'), inserted: true };
}
