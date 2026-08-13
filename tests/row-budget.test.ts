import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	visibleRowCount,
	showsTimeLabel,
	ROW_PX,
	HEAD_PX,
	CAL_CHIP_PX,
	CAL_DAYNUM_PX,
} from '../src/core/row-budget';

/** The declaration block for a top-level selector. */
function ruleFor(css: string, selector: string): string {
	const i = css.indexOf(`\n${selector} {`);
	expect(i, `${selector} is missing from styles.css`).toBeGreaterThan(-1);
	return css.slice(i, css.indexOf('}', i));
}

/**
 * EVERY block whose head ends in this selector, joined.
 *
 * `.tn-cal-chip` appears twice on purpose — once in the grouped rule it shares
 * with the all-day chip, once alone for the size that legitimately differs — and
 * `ruleFor` would only ever see whichever comes first.
 */
function allRulesFor(css: string, selector: string): string {
	const blocks: string[] = [];
	let from = 0;
	for (;;) {
		const i = css.indexOf(`\n${selector} {`, from);
		if (i < 0) break;
		const end = css.indexOf('}', i);
		blocks.push(css.slice(i, end));
		from = end;
	}
	expect(blocks.length, `${selector} is missing from styles.css`).toBeGreaterThan(0);
	return blocks.join('\n');
}

describe('visibleRowCount — count the last row, do not clip it', () => {
	it('draws everything when it all fits', () => {
		expect(visibleRowCount(4, 4, 12)).toBe(4);
		expect(visibleRowCount(2, 9, 12)).toBe(2);
	});

	it('reserves a row for the "+N more" line when something is hidden', () => {
		expect(visibleRowCount(4, 3, 12)).toBe(2);
		expect(visibleRowCount(10, 3, 12)).toBe(2);
	});

	it('respects the hard cap, still leaving room for the counter', () => {
		// 40 rows capped at 12: 28 are hidden, so one of the twelve is the "+28 more".
		expect(visibleRowCount(40, 40, 12)).toBe(11);
		expect(visibleRowCount(12, 40, 12)).toBe(12);
	});

	it('draws nothing when there is no room at all', () => {
		expect(visibleRowCount(5, 0, 12)).toBe(0);
		expect(visibleRowCount(5, -3, 12)).toBe(0);
	});
});

describe('showsTimeLabel — the time label earns its line', () => {
	// `10:00–11:00` is the least informative thing in a block head: the block's
	// POSITION and HEIGHT already state its range, and so do the tooltip and the
	// aria-label. On a short block it was competing with the title, which is the
	// one thing not repeated anywhere else.

	it('a block with room for two lines keeps it', () => {
		expect(showsTimeLabel(HEAD_PX * 2)).toBe(true);
		expect(showsTimeLabel(200)).toBe(true);
	});

	it('a one-line block gives the space to its title', () => {
		expect(showsTimeLabel(HEAD_PX)).toBe(false);
		expect(showsTimeLabel(HEAD_PX * 2 - 1)).toBe(false);
	});

	it('THE CASE THAT MATTERS: a 15-minute block at default zoom', () => {
		// 60px/hour → 15px. At the 125px/hour this vault uses it is ~31px, still
		// under the threshold — which is the point: the rule follows drawn PIXELS,
		// not minutes, so zooming in gives the label back.
		expect(showsTimeLabel(15)).toBe(false);
		expect(showsTimeLabel(31)).toBe(false);
		expect(showsTimeLabel((15 / 60) * 400)).toBe(true); // same block, zoomed in
	});

	it('never throws on a degenerate height', () => {
		// A collapsed or not-yet-measured block must not crash the grid.
		for (const px of [0, -1, Number.NaN]) {
			expect(showsTimeLabel(px), String(px)).toBe(false);
		}
	});
});

describe('ROW_PX / HEAD_PX are welded to three values in styles.css', () => {
	// These two constants decide how many rows EVERY block builds, and they were
	// derived by hand from the CSS below. Changing one of those three values
	// without changing the constants silently clips or hides a row in every
	// block on screen — a failure nobody would trace back to a font size.
	const CSS = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
	const FIX = 'change ROW_PX/HEAD_PX in src/core/row-budget.ts to match';

	it('the block type size is still the small step at 0.72rem', () => {
		// Renamed from --tn-font-xs when the 1px-apart xs/s pair was collapsed. The
		// VALUE is unchanged, so ROW_PX/HEAD_PX still hold.
		expect(CSS, FIX).toContain('--tn-font-s: var(--font-ui-smaller, 0.72rem)');
		expect(ruleFor(CSS, '.tn-block'), FIX).toMatch(/font-size:\s*var\(--tn-font-s\)/);
	});

	it('a block still sets line-height 1.3, which its rows inherit', () => {
		expect(ruleFor(CSS, '.tn-block'), FIX).toMatch(/line-height:\s*1\.3/);
	});

	it('the block head still adds 2px of padding above and below', () => {
		// Spelled as a token now, so the assertion resolves it rather than matching
		// a literal — that is a STRONGER guarantee than the old `2px` match, which
		// would have passed happily if --tn-space-1 were later redefined.
		expect(ruleFor(CSS, '.tn-block-head'), FIX).toMatch(/padding:\s*var\(--tn-space-1\) /);
		expect(CSS, FIX).toMatch(/--tn-space-1:\s*2px/);
	});

	it('the month chip and day-number heights are still what they were measured from', () => {
		// Same welded-constant problem one view over: the month grid must decide how
		// many chips fit BEFORE drawing them, into a cell that is overflow: hidden.
		const chip = allRulesFor(CSS, '.tn-cal-chip');
		expect(chip, FIX).toMatch(/font-size:\s*var\(--tn-font-s\)/);
		expect(chip, FIX).toMatch(/padding:\s*1px /);
		// The hairline counts toward the chip's height, and was added after the
		// constant was first derived — that is 2px the budget has to know about.
		// Via --tn-border since the chip stopped carrying its own tinted hairline,
		// so both halves are checked: the chip uses the token, and the token is 1px.
		expect(chip, FIX).toMatch(/border:\s*var\(--tn-border\)/);
		expect(CSS, FIX).toMatch(/--tn-border:\s*1px solid/);
		// Rounded UP on purpose: over-estimating hides a chip behind an honest
		// "+N more"; under-estimating clips one with no counter at all.
		expect(CAL_CHIP_PX).toBeGreaterThan(0);
		expect(CAL_DAYNUM_PX).toBeGreaterThan(0);
	});

	it('and the constants themselves have not drifted', () => {
		// 0.72rem × 16 ≈ 11.5px × 1.3 ≈ 15px, rounded UP to 16; the head adds 4px.
		expect(ROW_PX).toBe(16);
		expect(HEAD_PX).toBe(ROW_PX + 4);
	});
});
