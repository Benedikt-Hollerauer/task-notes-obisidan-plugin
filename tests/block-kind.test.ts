import { describe, it, expect } from 'vitest';
import {
	BLOCK_KIND_LINE,
	BLOCK_KIND_NOTE,
	blockKindFor,
	blockKindOptions,
	schedulableSpecs,
} from '../src/core/block-kind';
import { EMOJI_REGISTRY } from '../src/constants';

describe('blockKindFor — what a dragged block becomes', () => {
	it('THE SAFE DEFAULT: anything unrecognised writes a line and creates no file', () => {
		// A dispatch bug must fall back to the outcome that touches the least.
		// `undefined` is the real case, not a hypothetical: it is what a prompt
		// with no choice row reports, which every other caller of TextPromptModal
		// still is.
		for (const value of [undefined, '', 'line', 'nonsense', '🦄', 'note ', 'NOTE']) {
			expect(blockKindFor(value), String(value)).toEqual({ kind: 'line' });
		}
	});

	it('reads the two named kinds', () => {
		expect(blockKindFor(BLOCK_KIND_LINE)).toEqual({ kind: 'line' });
		expect(blockKindFor(BLOCK_KIND_NOTE)).toEqual({ kind: 'note' });
	});

	it('reads every type it offers — the row and the dispatch cannot disagree', () => {
		// The bug this forecloses: an option in the dialog that falls through to
		// 'line' when picked, so choosing 📅 silently just writes a plain line.
		for (const option of blockKindOptions()) {
			const parsed = blockKindFor(option.value);
			if (option.value === BLOCK_KIND_LINE) expect(parsed).toEqual({ kind: 'line' });
			else if (option.value === BLOCK_KIND_NOTE) expect(parsed).toEqual({ kind: 'note' });
			else expect(parsed).toEqual({ kind: 'typed', emoji: option.value });
		}
	});
});

describe('blockKindOptions — the row itself', () => {
	it('leads with the line, which is what the drag has always done', () => {
		expect(blockKindOptions()[0]?.value).toBe(BLOCK_KIND_LINE);
		expect(blockKindOptions()[1]?.value).toBe(BLOCK_KIND_NOTE);
	});

	it('gives every option a distinct value and a tooltip', () => {
		const options = blockKindOptions();
		expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
		for (const o of options) {
			expect(o.label.length, o.value).toBeGreaterThan(0);
			expect(o.title.length, o.value).toBeGreaterThan(0);
		}
	});

	it('offers exactly the file types you could be scheduling', () => {
		expect(schedulableSpecs().map((s) => s.emoji)).toEqual(['◻️', '📅', '🔁']);
	});

	it('offers no FOLDER type — the create path makes a file', () => {
		// 🚀 project and 🎯 goal name folders. Creating a file with a folder's
		// name would produce something no part of the plugin can classify.
		const folders = EMOJI_REGISTRY.filter((s) => s.appliesTo === 'folder').map((s) => s.emoji);
		expect(folders.length).toBeGreaterThan(0); // the guard is guarding something
		for (const emoji of folders) {
			expect(blockKindOptions().some((o) => o.value === emoji), emoji).toBe(false);
			expect(blockKindFor(emoji), emoji).toEqual({ kind: 'line' });
		}
	});

	it('offers no terminal STATE — those are reached, not created', () => {
		// ✅ completed and ❌ unimportant describe where a note ended up. Blocking
		// out an hour next Tuesday does not create one, and both stay reachable
		// from a note's own right-click menu.
		for (const emoji of ['✅', '❌']) {
			expect(blockKindOptions().some((o) => o.value === emoji), emoji).toBe(false);
		}
	});

	it('names a type the way the right-click menu names it', () => {
		// Two vocabularies for one type is how a UI starts lying about itself.
		for (const spec of schedulableSpecs()) {
			const option = blockKindOptions().find((o) => o.value === spec.emoji);
			expect(option?.title, spec.emoji).toContain(spec.menuLabel);
		}
	});
});
