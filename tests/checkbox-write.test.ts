import { describe, it, expect } from 'vitest';
import { setCheckboxStatus, parseListLine } from '../src/core/planner-line';
import { findBodyLine, findPlacementLine } from '../src/core/placement';
import { USER_NOTE, LINE } from './fixtures/user-note';

describe('setCheckboxStatus — a tick changes one character, nothing else', () => {
	it('ticks and unticks', () => {
		expect(setCheckboxStatus('- [ ] 09:00 Standup', 'x')).toBe('- [x] 09:00 Standup');
		expect(setCheckboxStatus('- [x] 09:00 Standup', ' ')).toBe('- [ ] 09:00 Standup');
	});

	it('keeps a trailing space that a round-trip would have eaten', () => {
		// This exact line is in the real note: `- [ ] 13:00 - 14:00 ` with a space.
		expect(setCheckboxStatus('- [ ] 13:00 - 14:00 ', 'x')).toBe('- [x] 13:00 - 14:00 ');
	});

	it('does not normalise a time the user wrote loosely', () => {
		expect(setCheckboxStatus('\t- [x] 9:05 Odd time', ' ')).toBe('\t- [ ] 9:05 Odd time');
		expect(setCheckboxStatus('- [ ] 14.00 - 15.00 Dotted', 'x')).toBe('- [x] 14.00 - 15.00 Dotted');
	});

	it('preserves indent, marker and an unusual status char', () => {
		expect(setCheckboxStatus('  * [X] item', ' ')).toBe('  * [ ] item');
		expect(setCheckboxStatus('\t\t+ [-] item', 'x')).toBe('\t\t+ [x] item');
	});

	it('leaves a line with no checkbox completely alone', () => {
		// A group label must never grow a checkbox from being clicked near.
		expect(setCheckboxStatus('- ==📅 Monthly - First Mon - 2026-09-07==', 'x')).toBe(
			'- ==📅 Monthly - First Mon - 2026-09-07==',
		);
		expect(setCheckboxStatus('- 16:00 Reviewed the deck', 'x')).toBe('- 16:00 Reviewed the deck');
		expect(setCheckboxStatus('Just prose', 'x')).toBe('Just prose');
	});

	it('produces a line that still parses to the same thing but for its status', () => {
		const raw = '\t- [ ] 07:30 - 08:00 [[📅 By 2026-08-08 at 07.30h, do - 1 - thing]]';
		const before = parseListLine(raw, 0)!;
		const after = parseListLine(setCheckboxStatus(raw, 'x'), 0)!;
		expect({ ...after, status: before.status, raw: before.raw }).toEqual(before);
		expect(after.status).toBe('x');
	});
});

describe('findBodyLine — the right one of several identical children', () => {
	// Two hour rows carrying a byte-identical routine, exactly as the real note does.
	const doc = [
		'- [ ] 07:00 - 08:00',
		'\t- [ ] [[🔁 Drink min. - 750ml - of tap water 💧]]',
		'- [ ] 13:00 - 14:00',
		'\t- [ ] [[🔁 Drink min. - 750ml - of tap water 💧]]',
	].join('\n');
	const child = { lineNo: 1, raw: '\t- [ ] [[🔁 Drink min. - 750ml - of tap water 💧]]' };

	it('resolves each twin against its own parent', () => {
		expect(findBodyLine(doc, { lineNo: 0, raw: '- [ ] 07:00 - 08:00' }, child)).toBe(1);
		expect(findBodyLine(doc, { lineNo: 2, raw: '- [ ] 13:00 - 14:00' }, { ...child, lineNo: 3 })).toBe(3);
	});

	it('still finds the child when the whole note shifted down', () => {
		// Two lines prepended: the parent moves 0 → 2 and its child 1 → 3, and the
		// stale remembered indices must not matter.
		const shifted = `# Heading\n\n${doc}`;
		expect(findBodyLine(shifted, { lineNo: 0, raw: '- [ ] 07:00 - 08:00' }, child)).toBe(3);
	});

	it('refuses to guess when the parent is gone', () => {
		expect(findBodyLine(doc, { lineNo: 0, raw: '- [ ] 06:00 - 07:00' }, child)).toBe(-1);
	});

	it("refuses to guess when the child left THIS parent, even though a twin exists", () => {
		const moved = ['- [ ] 07:00 - 08:00', '- [ ] 13:00 - 14:00', '\t- [ ] [[🔁 Drink min. - 750ml - of tap water 💧]]'].join('\n');
		expect(findBodyLine(moved, { lineNo: 0, raw: '- [ ] 07:00 - 08:00' }, child)).toBe(-1);
	});

	it('scopes to the subtree, so a grandchild is reachable but a sibling block is not', () => {
		const grandchild = '\t\t- [ ] [[📅 Attend - 1h - monthly planning at Logisitsy - First mon at 08.00h ✍️]]';
		expect(
			findBodyLine(USER_NOTE, { lineNo: LINE.row0800, raw: '- [ ] 08:00 - 09:00' }, { lineNo: LINE.monthlyChild, raw: grandchild }),
		).toBe(LINE.monthlyChild);
		expect(
			findBodyLine(USER_NOTE, { lineNo: LINE.row0700, raw: '- [ ] 07:00 - 08:00' }, { lineNo: LINE.monthlyChild, raw: grandchild }),
		).toBe(-1);
	});

	it('the block itself is addressed with the plain locator', () => {
		expect(findPlacementLine(USER_NOTE, { lineNo: LINE.row1000, raw: '- [ ] 10:00 - 11:00 [[🔁 Do - 1 workout - with non-visual media 🏥]]' })).toBe(
			LINE.row1000,
		);
	});
});
