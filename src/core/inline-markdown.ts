// The inline Markdown a timeline block can render on its own. Pure (no Obsidian).
//
// WHY THIS EXISTS ALONGSIDE Obsidian's renderer. MarkdownRenderer.render is
// async, and when it fails it fails silently — the block is simply left showing
// its source text, which is indistinguishable from "the feature is not wired up".
// This runs SYNCHRONOUSLY and always, so `==x==` is a highlight the instant a
// block is drawn; Obsidian's renderer then upgrades the same element when it
// succeeds, adding everything this deliberately does not do (links, embeds,
// footnotes, math).
//
// Deliberately small. It handles the inline marks people actually put in a
// planner line, and nothing block-level: a block is one line, and a renderer
// that could emit a <ul> here would break the row height it lives in.

export type InlineMark = 'mark' | 'strong' | 'em' | 'code' | 'del';

export interface InlineSegment {
	text: string;
	/** Innermost first; empty for plain text. */
	marks: InlineMark[];
}

/** Longest delimiters first, so `**` is never read as two `*`. */
const RULES: { open: string; close: string; mark: InlineMark; raw?: boolean }[] = [
	{ open: '==', close: '==', mark: 'mark' },
	{ open: '**', close: '**', mark: 'strong' },
	{ open: '~~', close: '~~', mark: 'del' },
	// Code is raw: `**x**` inside backticks is literally two asterisks and an x.
	{ open: '`', close: '`', mark: 'code', raw: true },
	{ open: '*', close: '*', mark: 'em' },
	{ open: '_', close: '_', mark: 'em' },
];

/**
 * Split a line into runs of text and the marks around them.
 *
 * An unclosed delimiter stays literal — verbatim wins whenever the syntax is
 * incomplete, because a planner line is the user's own text first and markup
 * second. `**a** and *b*` gives three segments, not a mangled one.
 */
export function inlineSegments(text: string): InlineSegment[] {
	const out: InlineSegment[] = [];
	let plain = '';

	const flush = (): void => {
		if (plain) out.push({ text: plain, marks: [] });
		plain = '';
	};

	let i = 0;
	while (i < text.length) {
		const rule = RULES.find((r) => text.startsWith(r.open, i));
		if (rule) {
			const from = i + rule.open.length;
			const end = text.indexOf(rule.close, from);
			// A closing delimiter must exist AND enclose something.
			if (end > from) {
				const inner = text.slice(from, end);
				flush();
				if (rule.raw) {
					out.push({ text: inner, marks: [rule.mark] });
				} else {
					// Nested marks: `**==x==**` is bold AND highlighted.
					for (const seg of inlineSegments(inner)) {
						out.push({ text: seg.text, marks: [...seg.marks, rule.mark] });
					}
				}
				i = end + rule.close.length;
				continue;
			}
		}
		plain += text[i];
		i += 1;
	}
	flush();
	return out.length ? out : [{ text, marks: [] }];
}
