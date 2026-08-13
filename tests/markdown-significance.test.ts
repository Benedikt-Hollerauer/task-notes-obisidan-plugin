import { describe, it, expect } from 'vitest';
import { needsMarkdownRender } from '../src/core/markdown-significance';
import { inlineSegments } from '../src/core/inline-markdown';

describe('needsMarkdownRender — when the async renderer is worth running', () => {
	it('THE POINT: a real task name from this vault skips the async pass', () => {
		// These are actual note names. They are made entirely of hyphens, dots and
		// colons, and an earlier draft of this predicate called all three
		// significant — which put every title back on the slow path and optimised
		// precisely nothing. This test is why the predicate is position-aware.
		for (const plain of [
			'Consume - 0mg - of caffeine after 14.00h ☕',
			'By 2026-08-25 at 10.00h, prepare - 1 - deck',
			'meet at - 1 - Bob (at home)',
			'attend - 1 - conference',
			'Top engineer - Get hired at - 1 company',
			'Standup 10:30',
			'-5°C outside',
			'Call Bob!',
			'',
		]) {
			expect(needsMarkdownRender(plain), plain).toBe(false);
		}
	});

	it('never skips text the inline pass would mark up', () => {
		// The contract that keeps this safe: anything the SYNCHRONOUS pass turns
		// into marks must also reach Obsidian, which is the authority when both
		// can run. Asserted against that parser rather than a hand-written list,
		// so adding a rule there cannot quietly desync the two.
		for (const marked of ['==h==', '**b**', '*i*', '_i_', '`c`', '~~d~~', '**==both==**']) {
			expect(inlineSegments(marked).some((s) => s.marks.length), marked).toBe(true);
			expect(needsMarkdownRender(marked), marked).toBe(true);
		}
	});

	it('catches everything only Obsidian can draw', () => {
		for (const rich of [
			'[[📅 By 2026-08-25 at 10.00h, prepare - 1 - deck]]',
			'![[embedded.png]]',
			'[link](https://example.com)',
			'a #tag inline',
			'see [^1] for detail',
			'$x^2$',
			'%%a comment%%',
			'<b>html</b>',
			'AT&amp;T',
			'a \\* literal star',
			'[[note|alias]]',
			'block ref ^abc123',
		]) {
			expect(needsMarkdownRender(rich), rich).toBe(true);
		}
	});

	it('catches a bare URL, which Obsidian makes clickable and the inline pass cannot', () => {
		// The single most common non-prose thing in a planner line. Matched as a
		// pattern, not by calling `:` or `/` significant — those live in "10:30"
		// and in every path, and would put every line back on the slow path.
		for (const url of [
			'standup https://meet.google.com/xyz',
			'http://example.com',
			'see www.example.com for detail',
			'obsidian://open?vault=x',
			'mailto:someone@example.com',
			'ping someone@example.com',
		]) {
			expect(needsMarkdownRender(url), url).toBe(true);
		}
	});

	it('does not mistake a clock or a ratio for a URL', () => {
		for (const plain of ['Standup 10:30', 'ratio 3:1', 'note: call Bob', 'a/b split']) {
			expect(needsMarkdownRender(plain), plain).toBe(false);
		}
	});

	it('reads line structure only at the start, which is where it means anything', () => {
		expect(needsMarkdownRender('- a bullet')).toBe(true);
		expect(needsMarkdownRender('  + nested')).toBe(true);
		expect(needsMarkdownRender('1. ordered')).toBe(true);
		// CommonMark accepts `1)` as well, so "1) call Bob" is a list, not prose.
		expect(needsMarkdownRender('1) ordered')).toBe(true);
		expect(needsMarkdownRender('> quoted')).toBe(true);

		// The same characters mid-string are ordinary punctuation — and this is the
		// common case for a task name, not an edge case.
		expect(needsMarkdownRender('do a - b')).toBe(false);
		expect(needsMarkdownRender('1 + 1 is 2')).toBe(false);
		expect(needsMarkdownRender('a > b')).toBe(false);
		expect(needsMarkdownRender('version 1. no space')).toBe(false);
	});

	it('requires the space that makes a bullet a bullet', () => {
		expect(needsMarkdownRender('-notabullet')).toBe(false);
		expect(needsMarkdownRender('+1 vote')).toBe(false);
		expect(needsMarkdownRender('2.5 hours')).toBe(false);
		expect(needsMarkdownRender('2)5')).toBe(false);
	});
});
