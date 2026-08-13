// Typing `[[` in a plain input, the way it works in a note. Pure.
//
// The write path has always accepted a wikilink — `buildLinkLine` and the
// "New time block" prompt go through the same serializer — so a link typed by
// hand already becomes a real, indexed link. Only the suggestions were missing.

/** An in-progress `[[…` at the caret. */
export interface WikilinkFragment {
	/** Index of the opening `[`, i.e. where the replacement starts. */
	start: number;
	/** What has been typed after `[[`, to search on. */
	query: string;
}

/**
 * The unclosed `[[…` immediately before `caret`, or null.
 *
 * Only an UNCLOSED one counts: once the user has typed or accepted `]]`, the
 * link is finished and typing on should not reopen the suggester. Scanning
 * backwards from the caret is what makes that distinction — a forward search
 * would match a `[[` from earlier in the line that is already closed.
 */
export function wikilinkFragment(value: string, caret: number): WikilinkFragment | null {
	const upto = value.slice(0, Math.max(0, Math.min(caret, value.length)));
	const open = upto.lastIndexOf('[[');
	if (open < 0) return null;
	const query = upto.slice(open + 2);
	// A `]` after the `[[` means this link is already closed, or the user is
	// mid-way through closing it themselves. Either way, stop suggesting.
	if (query.includes(']')) return null;
	// A newline can never be inside a link; treat it as a hard boundary.
	if (query.includes('\n')) return null;
	return { start: open, query };
}

/** The value and caret after accepting `basename` for the fragment at the caret. */
export interface WikilinkSplice {
	value: string;
	caret: number;
}

/**
 * Replace the `[[…` at the caret with a finished `[[basename]]`.
 *
 * Splices rather than replacing the whole field: the prompt is one line of free
 * text that may already say "Prep for" before the link and "with Sam" after it,
 * and overwriting it would throw both away. Anything the user had already typed
 * after the caret is kept, including a `]]` they started themselves.
 */
export function spliceWikilink(value: string, caret: number, basename: string): WikilinkSplice {
	const fragment = wikilinkFragment(value, caret);
	const at = Math.max(0, Math.min(caret, value.length));
	const start = fragment ? fragment.start : at;
	// Don't leave `]]]]` behind when the field already had a closing pair.
	const rest = value.slice(at).startsWith(']]') ? value.slice(at + 2) : value.slice(at);
	const link = `[[${basename}]]`;
	return { value: value.slice(0, start) + link + rest, caret: start + link.length };
}

/**
 * Close a `[[` the moment it is typed, the way the editor does.
 *
 * Obsidian's own auto-pairing lives in CodeMirror and is not reachable from a
 * plain `<input>` in a modal, so this is the one piece of the link experience
 * that has to be written rather than reused. `spliceWikilink` above already
 * writes `]]` when you PICK a suggestion; this covers typing a name yourself and
 * never picking one, which otherwise left `[[my note` with no closer and a line
 * that does not link anything.
 *
 * Returns null when there is nothing to do, so the caller can leave the input —
 * and the user's own undo history — completely alone in the common case.
 */
export function autoCloseWikilink(value: string, caret: number): WikilinkSplice | null {
	const at = Math.max(0, Math.min(caret, value.length));
	// The caret must sit directly after a just-typed `[[`.
	if (value.slice(at - 2, at) !== '[[') return null;
	// `[[[` — a third bracket is the user editing an existing pair, not opening
	// a new one. Closing here would produce `[[[]]`.
	if (value[at - 3] === '[') return null;
	// Already closed, by an earlier auto-close or by hand.
	if (value.slice(at).startsWith(']]')) return null;
	// A `]]` further along that this `[[` would claim: `[[|]]` after deleting the
	// inner text still has its closer, and adding another gives `[[]]]]`.
	const rest = value.slice(at);
	const nextClose = rest.indexOf(']]');
	const nextOpen = rest.indexOf('[[');
	if (nextClose >= 0 && (nextOpen < 0 || nextClose < nextOpen) && !rest.slice(0, nextClose).includes('\n')) {
		return null;
	}
	return { value: `${value.slice(0, at)}]]${rest}`, caret: at };
}
