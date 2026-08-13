import { describe, it, expect } from 'vitest';
import { wikilinkFragment, spliceWikilink, autoCloseWikilink } from '../src/core/wikilink';

/** `|` marks the caret, so these read like what you actually typed. */
const at = (marked: string) => ({ value: marked.replace('|', ''), caret: marked.indexOf('|') });

const fragmentOf = (marked: string) => {
	const { value, caret } = at(marked);
	return wikilinkFragment(value, caret);
};

const spliceOf = (marked: string, basename: string) => {
	const { value, caret } = at(marked);
	return spliceWikilink(value, caret, basename);
};

describe('wikilinkFragment — only an UNFINISHED link suggests', () => {
	it('finds an empty one the moment `[[` is typed', () => {
		expect(fragmentOf('[[|')).toEqual({ start: 0, query: '' });
	});

	it('finds one mid-word, anywhere in the line', () => {
		expect(fragmentOf('Prep for [[Acme|')).toEqual({ start: 9, query: 'Acme' });
	});

	it('THE RULE: a closed link does not reopen the suggester', () => {
		expect(fragmentOf('[[Acme]]|')).toBeNull();
		expect(fragmentOf('[[Acme]] with Sam|')).toBeNull();
		// Half-closed by hand counts as closed — the user is finishing it themselves.
		expect(fragmentOf('[[Acme]|')).toBeNull();
	});

	it('takes the LAST opener, so a second link works after a finished one', () => {
		expect(fragmentOf('[[A]] then [[B|')).toEqual({ start: 11, query: 'B' });
	});

	it('is null when there is no link at all', () => {
		expect(fragmentOf('just text|')).toBeNull();
		expect(fragmentOf('[single|')).toBeNull();
		expect(fragmentOf('|')).toBeNull();
	});

	it('ignores a `[[` that comes AFTER the caret', () => {
		// Scanning backwards is what makes this true; a forward search would match.
		expect(fragmentOf('|[[Acme')).toBeNull();
	});

	it('stops at a newline', () => {
		expect(wikilinkFragment('[[\nAcme', 7)).toBeNull();
	});

	it('survives a caret outside the string', () => {
		expect(wikilinkFragment('[[Acme', 999)).toEqual({ start: 0, query: 'Acme' });
		expect(wikilinkFragment('[[Acme', -5)).toBeNull();
	});
});

describe('spliceWikilink — keeps what you already typed', () => {
	it('completes an empty fragment', () => {
		expect(spliceOf('[[|', 'Acme')).toEqual({ value: '[[Acme]]', caret: 8 });
	});

	it('THE RULE: text before AND after the link survives', () => {
		// Replacing the whole field would throw both away — this is one line of
		// free text, not a file-path picker.
		expect(spliceOf('Prep for [[Ac| with Sam', '📅 call - 1 - Acme')).toEqual({
			value: 'Prep for [[📅 call - 1 - Acme]] with Sam',
			// 31, not 30: the caret is a UTF-16 offset and 📅 is a surrogate pair.
			caret: 31,
		});
	});

	it('does not leave `]]]]` when the field already closed the link', () => {
		expect(spliceOf('[[Ac|]]', 'Acme')).toEqual({ value: '[[Acme]]', caret: 8 });
	});

	it('inserts a whole link when there is no fragment at all', () => {
		expect(spliceOf('Lunch |', 'Acme')).toEqual({ value: 'Lunch [[Acme]]', caret: 14 });
	});

	it('leaves an already-finished link alone and adds a second', () => {
		expect(spliceOf('[[A]] |', 'B')).toEqual({ value: '[[A]] [[B]]', caret: 11 });
	});

	it('handles a basename with brackets and emoji verbatim', () => {
		const name = '📅 By 2026-07-24 at 16.00h, meet at - 1 - Bob (at home)';
		expect(spliceOf('[[Bob|', name).value).toBe(`[[${name}]]`);
	});

	it('puts the caret after the link, ready to keep typing', () => {
		const out = spliceOf('[[Ac| later', 'Acme');
		expect(out.value.slice(out.caret)).toBe(' later');
	});
});

describe('autoCloseWikilink — `[[` closes itself, like the editor', () => {
	/** Compact: `|` marks the caret in and out. */
	const run = (spec: string): string | null => {
		const caret = spec.indexOf('|');
		const out = autoCloseWikilink(spec.replace('|', ''), caret);
		return out ? `${out.value.slice(0, out.caret)}|${out.value.slice(out.caret)}` : null;
	};

	it('THE POINT: typing the second bracket writes the closer and stays inside', () => {
		expect(run('[[|')).toBe('[[|]]');
		expect(run('Prep for [[|')).toBe('Prep for [[|]]');
	});

	it('leaves everything after the caret alone', () => {
		expect(run('[[| with Sam')).toBe('[[|]] with Sam');
	});

	it('does nothing when there is no fresh `[[` at the caret', () => {
		expect(run('|')).toBeNull();
		expect(run('[|')).toBeNull();
		expect(run('plain text|')).toBeNull();
		// The caret has moved on: this is typing INSIDE a link, not opening one.
		expect(run('[[a|')).toBeNull();
	});

	it('does not double up on a pair that is already closed', () => {
		expect(run('[[|]]')).toBeNull();
		// …including one the user is re-editing after deleting the name.
		expect(run('[[|]] with Sam')).toBeNull();
	});

	it('THE `[[[` CASE: a third bracket is editing, not opening', () => {
		// Closing here gives `[[[]]`, which links nothing and is a nuisance to undo.
		expect(run('[[[|')).toBeNull();
	});

	it('claims a later `]]` rather than adding a second pair', () => {
		// `[[|]]` after clearing the middle: the closer downstream is THIS link's.
		expect(run('see [[|]] later')).toBeNull();
	});

	it('still closes when the `]]` further along belongs to a DIFFERENT link', () => {
		// The next thing along is another opener, so that `]]` is spoken for.
		expect(run('[[| and [[other]]')).toBe('[[|]] and [[other]]');
	});

	it('treats a newline as a hard boundary, like the fragment scanner', () => {
		expect(run('[[|\nsomething]]')).toBe('[[|]]\nsomething]]');
	});

	it('composes with the suggester: picking one still leaves exactly one pair', () => {
		// Type `[[` → auto-closed → then accept a suggestion. spliceWikilink knows
		// to consume the `]]` it finds ahead, so the two features cannot fight.
		const closed = autoCloseWikilink('[[', 2);
		expect(closed).not.toBeNull();
		const picked = spliceWikilink(closed!.value, closed!.caret, 'My note');
		expect(picked.value).toBe('[[My note]]');
	});
});
