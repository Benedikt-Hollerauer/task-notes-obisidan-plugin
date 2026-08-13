// Parse/serialize Day-Planner-style planner lines. Pure (no Obsidian imports).
//
// Grammar (checkbox list items — the plugin's plain-markdown contract):
//   - [ ] 14:00 - 15:00 [[📅 By 2026-07-24 at 14.00h, prepare - 1 - deck]]
//   - [ ] 13:00 Lunch
//   - [x] Some done task with no time
//
// `parseListLine` relaxes this to any list item, checkbox or not, for the READ
// path only: a `- 16:00 Reviewed the deck` under `## Log` should show on the
// timeline. Everything the plugin WRITES still goes through the strict parser,
// and `hasCheckbox` makes sure a rewrite never grows a checkbox of its own.
//
// Time separators `:` and `.` are both accepted on read; we always write `HH:MM`.
// The regex is adapted from obsidian-day-planner (MIT, © James Lynch / Ivan Lednev).

import type { PlannerLine } from '../types';
import { colonToMinutes, dotToMinutes, minutesToColon } from './timestamps';

// The time group ends at whitespace OR end-of-line, so a line that is *only* a
// time range (`- [ ] 14:00 - 15:00`) keeps its times instead of parsing them as text.
const LINE_RE =
	/^(?<indent>[ \t]*)(?<marker>[-*+]) (?:\[(?<status>.)\]\s+)?(?:(?<start>\d{1,2}[:.]\d{2})(?:\s*-\s*(?<end>\d{1,2}[:.]\d{2}))?(?=\s|$)\s*)?(?<text>.*)$/;

const WIKILINK_RE = /\[\[(?<target>[^\]|#^]+)(?:#[^\]|]*)?(?:\|(?<alias>[^\]]*))?\]\]/;

/** The line without its trailing carriage return, if it has one. */
function stripEol(raw: string): string {
	return raw.endsWith('\r') ? raw.slice(0, -1) : raw;
}

function parseTimeToken(token: string | undefined): number | null {
	if (!token) return null;
	return token.includes(':') ? colonToMinutes(token) : dotToMinutes(token);
}

/**
 * Parse any list item — checkbox optional. Read path only: `hasCheckbox` records
 * which kind it was so a rewrite reproduces it faithfully.
 */
export function parseListLine(raw: string, lineNo: number): PlannerLine | null {
	// `.` in JavaScript does not match `\r`, so a CRLF note would fail to match at
	// all — every line of a note synced from Windows was invisible. Parse without
	// the carriage return, but keep `raw` byte-exact: it is what re-finds the line.
	const m = stripEol(raw).match(LINE_RE);
	if (!m || !m.groups) return null;

	const g = m.groups;
	const startMinutes = parseTimeToken(g.start);
	const endMinutes = parseTimeToken(g.end);
	let text = g.text ?? '';

	// A token that looked like a time but isn't valid (e.g. `99:99`) must survive
	// into the text, otherwise parse→serialize would silently delete it.
	if (g.start && startMinutes == null) {
		const tokens = g.end ? `${g.start} - ${g.end}` : g.start;
		text = text ? `${tokens} ${text}` : tokens;
	} else if (g.end && endMinutes == null) {
		text = text ? `${g.end} ${text}` : g.end;
	}

	const link = text.match(WIKILINK_RE);

	return {
		lineNo,
		raw,
		indent: g.indent ?? '',
		marker: g.marker ?? '-',
		hasCheckbox: g.status != null,
		status: g.status ?? ' ',
		startMinutes: g.start && startMinutes == null ? null : startMinutes,
		endMinutes: g.start && startMinutes == null ? null : endMinutes,
		text: text.trim(),
		linkTarget: link?.groups?.target?.trim() ?? null,
		linkAlias: link?.groups?.alias?.trim() ?? null,
	};
}

/**
 * Parse a single line into a PlannerLine, or null if it is not a CHECKBOX list
 * item. This is the strict grammar: what counts as a planner line, what may be
 * auto-renamed, and what makes a daily note "bare" all still hinge on it.
 */
export function parsePlannerLine(raw: string, lineNo: number): PlannerLine | null {
	const line = parseListLine(raw, lineNo);
	return line && line.hasCheckbox ? line : null;
}

/** True if the parsed line has a checked/done status. */
export function isChecked(line: Pick<PlannerLine, 'status'>): boolean {
	return line.status.trim().toLowerCase() === 'x';
}

/** Serialize a planner line back to markdown. */
export function serializePlannerLine(line: {
	indent?: string;
	marker?: string;
	status?: string;
	/** Defaults to true: everything the plugin creates itself is a checkbox item. */
	hasCheckbox?: boolean;
	startMinutes: number | null;
	endMinutes: number | null;
	text: string;
	/** The original line, read only to keep its line ending. */
	raw?: string;
}): string {
	const indent = line.indent ?? '';
	const marker = line.marker ?? '-';
	// A line that had no checkbox must not gain one just because it was dragged.
	const box = line.hasCheckbox === false ? '' : `[${line.status ?? ' '}] `;
	let time = '';
	if (line.startMinutes != null) {
		time = minutesToColon(line.startMinutes);
		if (line.endMinutes != null) time += ` - ${minutesToColon(line.endMinutes)}`;
		if (line.text) time += ' ';
	}
	// Rewriting one line of a CRLF note must not leave it the only LF line.
	const eol = line.raw?.endsWith('\r') ? '\r' : '';
	return `${indent}${marker} ${box}${time}${line.text}${eol}`;
}

const CHECKBOX_RE = /^([ \t]*[-*+] \[)(.)(\])/;

/**
 * Flip a line's checkbox by replacing ONLY the character between the brackets.
 *
 * Deliberately not a parse/serialize round-trip: that would rewrite `9:05` as
 * `09:05` and drop the trailing space on `- [ ] 13:00 - 14:00 `. Ticking a box
 * is not permission to reformat the line. A line without a checkbox is returned
 * untouched — the plugin never adds one.
 */
export function setCheckboxStatus(raw: string, status: string): string {
	const m = raw.match(CHECKBOX_RE);
	if (!m) return raw;
	return raw.slice(0, m[1].length) + status + raw.slice(m[1].length + 1);
}

/** Build a planner line linking to a note basename (null start = all-day item). */
export function buildLinkLine(
	basename: string,
	startMinutes: number | null,
	endMinutes: number | null,
	status = ' ',
): string {
	return serializePlannerLine({
		status,
		startMinutes,
		endMinutes,
		text: `[[${basename}]]`,
	});
}
