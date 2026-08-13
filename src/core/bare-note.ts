// Bare daily-note construction and detection. Pure (no Obsidian imports).
//
// A "bare" daily note is one the plugin created ahead of time to hold planner
// lines for a future day. It contains ONLY the planner heading plus planner
// list items — no hidden markers, no frontmatter — so it stays fully usable
// without the plugin, and is safe to merge a template into later.

import { parseListLine } from './planner-line';
import { matchesConfiguredHeading } from './planner-section';

/** Build a bare daily note body: the heading followed by any planner lines. */
export function buildBareDailyNote(heading: string, lines: string[] = []): string {
	const body = lines.length > 0 ? `\n${lines.join('\n')}` : '';
	return `${heading}${body}\n`;
}

/**
 * True when `content` looks like a plugin-created bare daily note: the first
 * non-blank line is the planner heading and every other non-blank line is a
 * list item.
 *
 * List item, not checkbox item: a timed bullet without a checkbox (`- 16:00
 * Reviewed the deck`) is a line the plugin itself will happily move onto a
 * future day, and requiring the checkbox meant such a day could never receive
 * its template — not on arrival, not ever. Frontmatter, a second heading and
 * any prose still disqualify, which is what keeps a real note safe.
 */
export function isBareDailyNote(content: string, heading: string): boolean {
	const nonBlank = content.split('\n').filter((l) => l.trim().length > 0);
	if (nonBlank.length === 0) return false;
	if (!matchesConfiguredHeading(nonBlank[0], heading)) return false;
	for (let i = 1; i < nonBlank.length; i++) {
		if (parseListLine(nonBlank[i], i) === null) return false;
	}
	return true;
}
