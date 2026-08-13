// Does this text need Obsidian's async renderer at all? Pure (no Obsidian).
//
// Every block title and every body row runs a full `MarkdownRenderer.render`
// pass — an async call that builds a detached tree, resolves links against the
// metadata cache, and then swaps the result in. On a template-heavy day that is
// dozens of those per redraw, and the overwhelming majority resolve to exactly
// the text that is already on screen, because a planner line is usually plain
// prose: "Consume - 0mg - of caffeine after 14.00h ☕".
//
// So: run the async pass only when the text contains something the SYNCHRONOUS
// pass (core/inline-markdown.ts) cannot already draw correctly.
//
// THE ASYMMETRY THAT SHAPES THIS. A false positive costs one needless async
// render — invisible. A false negative silently downgrades real Markdown to
// plain text, which is exactly the class of display bug this release exists to
// kill. So this errs toward "yes, render" and never tries to decide whether the
// syntax is well-formed: one significant character anywhere is enough.
//
// But it errs toward yes CAREFULLY, because this vault's filename grammar is
// built out of punctuation. Every task name contains " - " and most contain a
// clock like "14.00h" or "10:30". Treating `-`, `.` or `:` as significant
// wherever they appear would put every single title back on the slow path and
// leave an optimisation that optimises nothing. Position is what separates them:
// a hyphen STARTING the text is a list bullet, a hyphen inside it is a hyphen.

/**
 * Significant wherever they appear.
 *
 * `[` `]` links, wikilinks, footnotes · `*` `_` emphasis · `` ` `` code ·
 * `~` strikethrough · `=` highlight · `#` tags · `<` `&` HTML and entities ·
 * `\` escapes · `$` math · `%` comments · `|` table cells and link aliases ·
 * `^` block references.
 *
 * `(` `)` `!` `:` are absent on purpose: each is only meaningful next to a
 * character already in this set, so the set already catches them.
 *
 * `*`, `_`, `` ` ``, `~` and `=` are here even though the inline pass DOES draw
 * them — Obsidian nests and escapes them more correctly than a small parser
 * can, and it is the authority whenever both can run.
 */
const ANYWHERE = /[[\]*_`~=#<&\\$%|^]/;

/**
 * Significant only at the start (leading whitespace allowed), where Markdown
 * reads line structure: `- ` `+ ` bullets, `1. ` and `1) ` ordered items, `> `
 * quotes. Both ordered forms, because CommonMark accepts either and a title
 * beginning "1) call Bob" would otherwise be a false negative.
 *
 * A trailing space is required, so "- 1 -" is a bullet but "-5°C" is a
 * temperature. `* ` needs no entry here: `*` is significant anywhere.
 */
const AT_START = /^\s*(?:[-+>]\s|\d+[.)]\s)/;

/**
 * A bare URL or email address, which Obsidian turns into a clickable link and
 * the inline pass cannot.
 *
 * Matched as a PATTERN rather than by adding `:` or `/` to the set above — those
 * two characters appear in "10:30" and in half the dates and paths a planner
 * line carries, so treating them as significant would send every line back to
 * the slow path. A scheme, a `www.` or an `@…tld` is unambiguous.
 */
const URL_LIKE = /\b(?:[a-z][a-z\d+.-]*:\/\/|www\.|mailto:)|\S+@\S+\.[a-z]/i;

/**
 * True when `text` should also go through Obsidian's Markdown renderer.
 *
 * False only for text that is inert in every position and carries no bare URL —
 * for which the synchronous inline pass already produces an identical result.
 */
export function needsMarkdownRender(text: string): boolean {
	return ANYWHERE.test(text) || AT_START.test(text) || URL_LIKE.test(text);
}
