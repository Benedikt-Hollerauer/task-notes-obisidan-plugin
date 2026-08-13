import { describe, it, expect } from 'vitest';
import { inlineSegments } from '../src/core/inline-markdown';

/** Compact form for readability: "text" or "text@mark,mark". */
const shape = (text: string): string[] =>
	inlineSegments(text).map((s) => (s.marks.length ? `${s.text}@${s.marks.join(',')}` : s.text));

describe('inlineSegments — what a block can render without Obsidian', () => {
	it('THE ONE THAT WAS ASKED FOR: ==highlight==', () => {
		expect(shape('Review the ==investor== deck')).toEqual([
			'Review the ',
			'investor@mark',
			' deck',
		]);
	});

	it('handles the rest of the inline set', () => {
		expect(shape('**bold**')).toEqual(['bold@strong']);
		expect(shape('*italic*')).toEqual(['italic@em']);
		expect(shape('_italic_')).toEqual(['italic@em']);
		expect(shape('~~gone~~')).toEqual(['gone@del']);
		expect(shape('`code`')).toEqual(['code@code']);
	});

	it('never reads ** as two *', () => {
		// Longest delimiter first, or "**bold**" becomes an empty italic.
		expect(shape('**bold**')).toEqual(['bold@strong']);
		expect(shape('*a* and *b*')).toEqual(['a@em', ' and ', 'b@em']);
	});

	it('nests, innermost mark first', () => {
		expect(shape('**==both==**')).toEqual(['both@mark,strong']);
	});

	it('leaves an unclosed delimiter completely alone', () => {
		// Verbatim wins when the syntax is incomplete: a planner line is the
		// user's own text first and markup second.
		expect(shape('==unclosed')).toEqual(['==unclosed']);
		expect(shape('2 ** 8 is not bold')).toEqual(['2 ** 8 is not bold']);
		expect(shape('a * b')).toEqual(['a * b']);
	});

	it('treats an empty delimiter pair as literal text', () => {
		expect(shape('====')).toEqual(['====']);
		expect(shape('``')).toEqual(['``']);
	});

	it('does not interpret markup inside code', () => {
		expect(shape('`**not bold**`')).toEqual(['**not bold**@code']);
	});

	it('leaves a wikilink exactly as written', () => {
		// The timeline shows what the note says; Obsidian's renderer turns this
		// into a real link when it runs, and this pass must not mangle it first.
		expect(shape('[[📅 By 2026-08-25 at 10.00h, prepare - 1 - deck]]')).toEqual([
			'[[📅 By 2026-08-25 at 10.00h, prepare - 1 - deck]]',
		]);
	});

	it('survives the punctuation a task name is full of', () => {
		expect(shape('Consume - 0mg - of caffeine after 14.00h ☕')).toEqual([
			'Consume - 0mg - of caffeine after 14.00h ☕',
		]);
		expect(shape('')).toEqual(['']);
	});
});
