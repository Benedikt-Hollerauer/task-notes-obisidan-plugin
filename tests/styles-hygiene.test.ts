// styles.css is one 1900-line file that four rounds of work have edited. These
// are the two mistakes that actually happened in it — a selector declared twice
// in the same context, and a `var(--tn-…)` whose token nobody ever defined.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

/** Every .ts/.svelte file under src/, as text. */
function sources(): { path: string; text: string }[] {
	const out: { path: string; text: string }[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (/\.(ts|svelte)$/.test(entry.name))
				out.push({ path: full.slice(SRC_DIR.length + 1), text: readFileSync(full, 'utf8') });
		}
	};
	walk(SRC_DIR);
	return out;
}
const SOURCES = sources();
const ALL_SOURCE = SOURCES.map((f) => f.text).join('\n');

/** Strip comments so a selector mentioned in prose is not counted as a rule. */
const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every rule head, keyed by the at-rule it sits inside.
 *
 * `.tn-x` inside `@media (pointer: coarse)` is a different rule from `.tn-x` at
 * the top level, so the key has to carry the context or every responsive
 * override reads as a duplicate.
 */
interface Rule {
	/** `<at-rule context>|<selector list>`, so a responsive override is distinct. */
	key: string;
	/** The selector list as written, whitespace collapsed. */
	selector: string;
	/** The declarations, for a rule with no nested blocks. */
	body: string;
}

function rules(): Rule[] {
	const out: Rule[] = [];
	const stack: string[] = [];
	/** For each open block: which rule it belongs to and where its body began. */
	const open: { rule: number; from: number }[] = [];
	let buffer = '';
	for (let i = 0; i < withoutComments.length; i++) {
		const char = withoutComments[i];
		if (char === '{') {
			const head = buffer.trim().replace(/\s+/g, ' ');
			buffer = '';
			if (head.startsWith('@')) {
				stack.push(head);
				open.push({ rule: -1, from: i + 1 });
			} else {
				out.push({ key: `${stack.join(' ')}|${head}`, selector: head, body: '' });
				stack.push(''); // a plain rule's block, so its `}` pops correctly
				open.push({ rule: out.length - 1, from: i + 1 });
			}
		} else if (char === '}') {
			const block = open.pop();
			stack.pop();
			if (block && block.rule >= 0) out[block.rule].body = withoutComments.slice(block.from, i);
			buffer = '';
		} else {
			buffer += char;
		}
	}
	return out;
}
const RULES = rules();

describe('no selector is declared twice in the same context', () => {
	it('THE MISTAKE: `.tn-title` and `.tn-header-row` were each written twice', () => {
		// Two blocks for one selector is not an error, but it is always an accident
		// here — the second silently overrode half of the first from 40 lines away.
		const seen = new Map<string, number>();
		for (const { key } of RULES) seen.set(key, (seen.get(key) ?? 0) + 1);
		const duplicated = [...seen.entries()]
			.filter(([, n]) => n > 1)
			.map(([head]) => head.replace('|', ' >> '));
		expect(duplicated).toEqual([]);
	});
});

describe('every design token that is used is also defined', () => {
	it('catches a typo in a --tn-* name before it silently resolves to nothing', () => {
		const used = new Set<string>();
		// Only unfallbacked uses: `var(--tn-x, 12px)` is a deliberate default, and
		// several of ours are written for a value JS supplies at runtime.
		for (const m of withoutComments.matchAll(/var\((--tn-[\w-]+)\s*\)/g)) used.add(m[1]);

		const defined = new Set<string>();
		for (const m of withoutComments.matchAll(/(--tn-[\w-]+)\s*:/g)) defined.add(m[1]);

		expect([...used].filter((name) => !defined.has(name))).toEqual([]);
	});
});

/** The declaration block for a selector, at the top level. */
function ruleFor(selector: string): string {
	const i = withoutComments.indexOf(`\n${selector} {`);
	expect(i, `${selector} is missing`).toBeGreaterThan(-1);
	return withoutComments.slice(i, withoutComments.indexOf('}', i));
}

describe('two rules that were regressions', () => {
	it('the day header fills its column, with the note button beside it', () => {
		// It was briefly `0 1 auto` to stop today's mark becoming an ~800px accent
		// slab — but the mark moved to the cell, so the header is free to span the
		// column again. Both are pinned together: `1 1 auto` is only safe while the
		// today mark is NOT drawn on this element.
		// `button.` qualified: a lone class loses to Obsidian's own
		// `button:not(.clickable-icon)` — see the button-specificity suite below.
		expect(ruleFor('button.tn-day-header')).toMatch(/flex:\s*1 1 auto/);
		// Via RULES, not ruleFor: this one is a grouped selector, and `ruleFor`
		// matches a single selector followed by ` {`.
		const todayHeader = RULES.filter((r) =>
			r.selector.includes('.tn-day-cell.tn-today .tn-day-header'),
		);
		expect(todayHeader.length).toBeGreaterThan(0);
		for (const rule of todayHeader) {
			expect(rule.body, 'today must not paint the header itself').not.toMatch(
				/background|box-shadow/,
			);
		}
	});

	it('today marks the whole column with a bar, and never fills it', () => {
		// Two opposite regressions, one assertion each. The mark was once a FILLED
		// accent cell — --text-on-accent text and an accent checkbox on an accent
		// background, ~800px wide in Day view. Then it was a rule only as wide as
		// the date's own text, which is what "too small" meant.
		const bar = ruleFor('.tn-day-cell.tn-today::after');
		expect(bar, 'the bar must span the column, not the label').toMatch(/left:\s*0/);
		expect(bar).toMatch(/right:\s*0/);
		// One weight for "this one, right now" — a bar that invents its own 3px is
		// how the today mark stops agreeing with focus, duplicate and overlap.
		expect(bar).toMatch(/height:\s*var\(--tn-ring\)/);
		// …and the cell behind it is never painted.
		expect(ruleFor('.tn-day-cell')).not.toMatch(/background/);
	});

	it('THE DEAD REVEAL: the hover-only badge actually starts hidden', () => {
		// Two rules existed to reveal `.tn-block-badge` — one on hover/focus, one
		// forcing it visible on a phone — and both were no-ops, because the base
		// rule set `display: inline-flex`. There was never anything to reveal, so
		// a '+' sat permanently on every unlinked block. A reveal rule with no
		// hidden state is worse than neither: it reads as working.
		const base = RULES.find((r) => r.selector === 'button.tn-block-badge' && !r.key.includes('@'));
		expect(base?.body).toMatch(/display:\s*none/);

		// And the reveal names BOTH hosts — the badge lives in a timed block's
		// head and in an all-day chip.
		const reveal = RULES.find((r) => /\.tn-block-badge/.test(r.selector) && /display:\s*inline-flex/.test(r.body) && r.selector.includes(':hover'));
		expect(reveal?.selector).toContain('.tn-block:hover');
		expect(reveal?.selector).toContain('.tn-allday-chip:hover');
	});

	it('ONE button vocabulary: a range pill is styled like every other button', () => {
		// The pills used to strip their border and background inside a tinted
		// track — a second button language in a toolbar that needed one. Asked for
		// directly: "have one button style for every such button".
		for (const rule of RULES.filter((r) => /\.tn-range\b/.test(r.selector))) {
			expect(rule.body, rule.selector).not.toMatch(/border:\s*none/);
			expect(rule.body, rule.selector).not.toMatch(/background:\s*none/);
		}
		// The base declarations are literally shared with .tn-btn, not copied.
		const base = RULES.find((r) => r.selector.includes('button.tn-btn'));
		expect(base?.selector).toContain('button.tn-range');
	});

	/**
	 * THE HUE BUDGET. Three chromatic meanings exist in the grid and no more:
	 * the calendar colour (which calendar), --tn-now-color (now), and
	 * --interactive-accent (you or the app selected this).
	 *
	 * These tests exist because the previous design failed by ACCRETION, not by a
	 * decision: an accent bar was added to every block, then a tinted hairline,
	 * then a shadow, then one more mark per state — until accent was used
	 * eighteen different ways and a single block could carry nine marks at once.
	 * Nothing in a diff review catches that; each step looks reasonable alone.
	 */
	describe('the hue budget', () => {
		/** Paint that costs a hue, as opposed to a neutral or a theme surface. */
		const CHROMATIC = /^(?:--interactive-accent|--text-accent|--tn-now-color|--text-warning|--tn-event-color|--tn-block-color|--tn-local-color)$/;
		/** The same set, for scanning a rule body rather than testing one name. */
		const CHROMATIC_IN = /--interactive-accent|--text-accent|--tn-now-color|--text-warning|--tn-event-color|--tn-block-color|--tn-local-color/;

		it('AN ORDINARY BLOCK COSTS NO COLOUR — colour is reserved for meaning', () => {
			// Three positions have been tried here and the history is the argument:
			//  1. a full-strength accent bar on EVERY block — the accent stopped
			//     meaning anything, reported as "too much colour";
			//  2. no bar at all — reported as "bleak", a wall of grey rectangles;
			//  3. this: the bar KEEPS ITS SLOT but is drawn in the block's own
			//     outline colour, so geometry never shifts and no hue is spent.
			// What actually fixed "bleak" was spacing, brighter labels and the
			// warning colour — none of which is a hue on an ordinary block. So
			// orange (unplanned/overlap/duplicate), red (now) and a calendar's own
			// colour are the only colours on the grid, and each means something.
			for (const selector of ['.tn-block', '.tn-allday-chip, .tn-cal-chip']) {
				const body = RULES.find((r) => r.selector === selector && !r.key.includes('@'))?.body;
				expect(body, `${selector} must exist`).toBeTruthy();
				// --tn-local-color is exempt: it is the user's opt-in colour, UNSET
				// by default, so at rest it resolves to its neutral fallback and the
				// claim still holds. Strip it before testing, but insist the neutral
				// fallback is right there in the same var() — an unconditional read
				// would make the default coloured.
				expect(body, selector).toMatch(/var\(--tn-local-color,\s*var\(--tn-grid-line\)\)/);
				const withoutOptIn = body?.replace(/var\(--tn-local-color,[^;]+;/g, ';') ?? '';
				expect(withoutOptIn, `${selector} must spend no hue at rest`).not.toMatch(CHROMATIC_IN);
			}
		});

		it('the left bar is one slot, always the same width', () => {
			// The width never changes with state, so a block gaining or losing a
			// mark cannot reflow the text beside it.
			const block = RULES.find((r) => r.selector === '.tn-block' && !r.key.includes('@'))?.body;
			expect(block).toMatch(/border-left:\s*var\(--tn-edge\) solid var\(--tn-tint\)/);
			for (const state of ['.tn-block-remote', '.tn-block-dup', '.tn-block-now']) {
				const body = RULES.find((r) => r.selector.endsWith(state))?.body;
				expect(body, `${state} must set the tint`).toMatch(/--tn-tint:/);
				// Full strength — that is what makes it outrank an ordinary block.
				expect(body, `${state} must not be mixed down`).not.toMatch(/color-mix/);
			}
		});

		it('only these four states may claim the bar, in this order', () => {
			// If a fifth ever sets --tn-tint on a block, the bar's meaning becomes
			// "whichever rule was written last" again — the bug this replaced.
			// Matched on the STATE CLASS, not the whole selector: some of these are
			// `.tn-block.`-qualified to beat the base rule's shorthands (see the
			// cascade-order test below), and that must not change the answer here.
			const claimants = RULES.filter(
				(r) => /^(?:\.tn-block)?\.tn-block-[a-z]+$/.test(r.selector) && /--tn-tint:/.test(r.body),
			).map((r) => r.selector.replace(/^\.tn-block(?=\.)/, ''));
			expect(claimants.sort()).toEqual([
				'.tn-block-dup',
				'.tn-block-now',
				'.tn-block-remote',
				'.tn-block-unlinked',
			]);
			// ALL FOUR carry the same specificity, so source order alone decides —
			// and "happening now" must be the loudest thing a block can say.
			// Qualifying only some of them once made `unlinked` (0,2,0) outrank
			// `now` (0,1,0), turning an unplanned block that was happening right
			// now orange instead of red.
			for (const sel of claimants) {
				const rule = RULES.find((r) => r.selector.endsWith(sel));
				expect(rule?.selector, `${sel} must be .tn-block.-qualified`).toBe(`.tn-block${sel}`);
			}
			const at = (cls: string) => RULES.findIndex((r) => r.selector.endsWith(cls));
			expect(at('.tn-block-now')).toBeGreaterThan(at('.tn-block-remote'));
			expect(at('.tn-block-now')).toBeGreaterThan(at('.tn-block-dup'));
			expect(at('.tn-block-now')).toBeGreaterThan(at('.tn-block-unlinked'));
		});

		it('no block rule stacks elevation on top of a coloured edge', () => {
			// Never border + shadow + tint together. The one surface allowed a
			// shadow is the expanded block, which genuinely floats over its
			// neighbours — and it carries no tint.
			for (const rule of RULES.filter((r) => /\.tn-block/.test(r.selector))) {
				if (!/box-shadow:|filter:\s*drop-shadow/.test(rule.body)) continue;
				expect(rule.body, `${rule.selector} may not also tint`).not.toMatch(/--tn-tint:/);
			}
		});

		it('the whole file spends only the hues on the budget', () => {
			// Every chromatic variable the file ASKS FOR — ignoring fallback slots,
			// since `var(--text-warning, var(--color-orange))` is one hue named
			// twice for themes that lack the first.
			const asked = new Set<string>();
			for (const m of withoutComments.matchAll(/(,\s*)?var\(\s*(--[\w-]+)/g)) {
				if (m[1]) continue; // a fallback, not a choice
				if (CHROMATIC.test(m[2])) asked.add(m[2]);
			}
			expect([...asked].sort()).toEqual([
				// selection — you, or the app, picked this
				'--interactive-accent',
				// a duplicate placement: rare, and genuinely wrong. It carried three
				// unrelated meanings before this round (duplicates, overlaps, and
				// the toolbar chip) and now carries exactly one.
				'--text-warning',
				// which calendar this came from. --tn-event-color is deliberately
				// NOT here: it is only ever the fallback slot of --tn-block-color,
				// the default for a calendar with no colour of its own.
				'--tn-block-color',
				// the user's OPT-IN colour for local events (Settings → Timeline).
				// Unset by default, so it costs nothing until chosen — the base-rule
				// guard below tolerates it for exactly that reason.
				'--tn-local-color',
				// now
				'--tn-now-color',
			]);
			// --text-accent is absent entirely: in default Obsidian it is the SAME
			// hue as --interactive-accent, so every use of it spent a colour and
			// bought no distinction.
			expect(withoutComments).not.toContain('--text-accent');
		});

		it('THE CASCADE TRAP: a state rule above `.tn-block` must out-specify it', () => {
			// `.tn-block` sets the `border`, `border-radius` and `cursor` SHORTHANDS.
			// Every `.tn-block-<state>` rule written ABOVE it in the file has the
			// same (0,1,0) specificity, so those shorthands reset whatever the
			// state rule set — and the mark simply never paints, with no error and
			// no visual clue that the rule is dead.
			//
			// This has now been sprung three times: the midnight dashes, the
			// multi-day continuation edges, and the overlap edge (which the user
			// reported as "the warning on the timeblock is missing"). Qualifying
			// with `.tn-block.` makes the state (0,2,0) and immune to order.
			const RESET_BY_BASE = /(?:^|;|\{)\s*(?:border|border-radius|cursor)\s*:/;
			const baseAt = RULES.findIndex((r) => r.selector === '.tn-block' && !r.key.includes('@'));
			expect(baseAt, '.tn-block base rule must exist').toBeGreaterThanOrEqual(0);

			/**
			 * A rule that styles THE BLOCK ITSELF in some state: every selector in
			 * the list is a bare compound of `.tn-block-*` classes. A tag prefix
			 * (`button.tn-block-badge`) or a descendant (`.tn-block-now .head`)
			 * targets a different element, which the base rule never touched.
			 */
			const isBlockState = (selector: string): boolean =>
				selector
					.split(',')
					.map((part) => part.trim())
					.every((part) => /^\.tn-block-[a-z-]+(?:\.tn-block-[a-z-]+)*$/.test(part));

			const unguarded = RULES.filter((r, i) => {
				if (i > baseAt || r.key.includes('@')) return false;
				if (!isBlockState(r.selector)) return false;
				return RESET_BY_BASE.test(r.body) || /border-(?:top|right|bottom|left)/.test(r.body);
			}).map((r) => r.selector);

			expect(unguarded, 'prefix these with `.tn-block.` — see the comment above').toEqual([]);
		});

		it('A CARD IS NOT ITS CANVAS: the two surfaces must differ', () => {
			// The whole "bland and unübersichtlich" report came down to this: a block
			// and the grid behind it were both --background-primary, so a block was a
			// grey rectangle on an identical grey sheet with a 1px line between them.
			// A surface delta separates them for free — no hue, no shadow, no border
			// — which is the only separation that survives the hue budget.
			const bg = (selector: string): string => {
				const body = RULES.find((r) => r.selector === selector && !r.key.includes('@'))?.body;
				expect(body, `${selector} must exist`).toBeTruthy();
				return body?.match(/(?:^|;)\s*background:\s*([^;]+);/)?.[1]?.trim() ?? '';
			};
			const canvas = bg('.tn-columns');
			expect(canvas, 'the grid must paint a canvas').toBe('var(--tn-canvas)');
			// Every surface the cards sit on reads from the one token, so the idea
			// moves as a whole rather than drifting a rule at a time.
			expect(bg('.tn-allday-col')).toBe(canvas);
			expect(bg('.tn-cal-v-chips .tn-cal-cell')).toBe(canvas);
			// …and the cards do NOT.
			for (const card of ['.tn-block', '.tn-allday-chip, .tn-cal-chip']) {
				expect(bg(card), `${card} must not wear the canvas`).not.toBe(canvas);
			}
			// The gutter labels mask the hour line behind themselves, so they have to
			// match what they sit on — a card colour there paints a visible notch.
			expect(bg('.tn-hour span')).toBe(canvas);
		});

		it('a block that is both unplanned and overlapping keeps BOTH marks', () => {
			// The unlinked perimeter is declared ~750 lines after the overlap edge at
			// the same specificity, so its dashed border-right silently erased the
			// overlap mark. That collision is why the perimeter was deleted once
			// already; this combination rule is what lets it come back.
			const both = RULES.find(
				(r) => r.selector === '.tn-block.tn-block-unlinked.tn-block-overlap',
			);
			expect(both?.body, 'the overlap edge must be restated for the pair').toMatch(
				/border-right:\s*var\(--tn-ring\) solid/,
			);
			const at = (sel: string) => RULES.findIndex((r) => r.selector === sel);
			expect(at('.tn-block.tn-block-unlinked.tn-block-overlap')).toBeGreaterThan(
				at('.tn-block.tn-block-unlinked'),
			);
		});

		it('overlap is one thin edge of the block, never an overlay stripe', () => {
			// It began as a full-height ::after stripe — eight collisions meant eight
			// loud bars, which is why it was deleted outright. It is back because
			// two things at once is a rule the user keeps, but only as the block's
			// OWN border recoloured, on the right: the side the collision is on.
			const rule = RULES.find((r) => r.selector.endsWith('.tn-block-overlap'));
			expect(rule?.body).toMatch(/border-right:\s*var\(--tn-ring\) solid/);
			// An overlay is what made it shout; the mark must stay part of the box.
			expect(withoutComments, 'no ::after stripe may come back').not.toMatch(
				/\.tn-block-overlap::(?:after|before)/,
			);
			// One edge, not a frame.
			expect(rule?.body).not.toMatch(/border-(?:top|bottom|left)\s*:/);
		});
	});

	it('CAPPED AT 600: nothing in a 12px UI needs the heaviest weight', () => {
		// "Too bold" traced to nine `font-weight: 700` declarations — 28% of every
		// weight in the file — six of them on ~11.5px text and four of those
		// already sitting on an accent fill, where --text-on-accent is doing the
		// contrast anyway. With only two type sizes, weight was carrying the whole
		// hierarchy and had been pushed to the top of its range to get any range
		// at all. 400/500/600 is enough for three levels.
		const heavy = RULES.filter((r) => /font-weight:\s*(?:700|800|900|bold\b)/.test(r.body)).map(
			(r) => r.selector,
		);
		expect(heavy).toEqual([]);
	});

	it('hover never changes anything that re-lays-out the text under it', () => {
		// A `font-weight` change on hover shifts the glyphs beneath the pointer —
		// the month day-number visibly jumped inside its fixed-height row. Colour
		// and background are free; metrics are not.
		// Only rules that apply EXCLUSIVELY on hover. A grouped selector listing the
		// resting state alongside the hover one sets the property in both, so the
		// value never changes and nothing moves.
		const hoverOnly = RULES.filter((r) =>
			r.selector
				.split(',')
				.map((part) => part.trim())
				.every((part) => part.includes(':hover')),
		);
		expect(hoverOnly.length, 'the check must have something to check').toBeGreaterThan(5);
		for (const rule of hoverOnly) {
			expect(rule.body, `${rule.selector} must not re-flow on hover`).not.toMatch(
				/font-weight|font-size|letter-spacing|padding|border-width/,
			);
		}
	});

	it('an all-day chip never squashes — a shorter lane shows FEWER chips', () => {
		// Flex items shrink by default, so dragging the lane shorter compressed
		// every chip into a sliver instead of scrolling.
		expect(ruleFor('.tn-allday-chip')).toMatch(/flex:\s*0 0 auto/);
	});
});

describe('the file keeps its own conventions', () => {
	it('has no rule left over from a deleted feature', () => {
		// Each of these was removed with the thing it styled; a stray one means the
		// deletion was incomplete.
		for (const gone of [
			'tn-title-btn',
			'tn-cal-header',
			'tn-allday-open',
			'tn-allday-more',
			'task-notes-footer',
			'task-notes-title-wrapper',
		]) {
			expect(withoutComments).not.toContain(`.${gone}`);
		}
	});

	it('states a colour only through an Obsidian variable or a token', () => {
		// The file header promises this. A raw hex is how a plugin stops following
		// the user's theme. A hex is only allowed as the FALLBACK of an Obsidian
		// variable — `var(--color-red, #e5534b)` still follows a theme that sets it.
		const all = [...withoutComments.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
		const asFallback = [...withoutComments.matchAll(/var\(--[\w-]+,\s*(#[0-9a-fA-F]{3,8})\)/g)].map(
			(m) => m[1],
		);
		expect(all.length).toBe(asFallback.length);
		// …and each such fallback is stated exactly once, behind a token.
		expect(asFallback).toHaveLength(new Set(asFallback).size);
	});
});

describe('THE BUG THIS ROUND: a view outside the token scope', () => {
	/**
	 * The `--tn-*` block is declared on a fixed list of selectors. Anything that
	 * is a root of its own — a view's contentEl, a modal's, a popover's — must be
	 * on that list, or every token inside it is undefined and every declaration
	 * that used one is silently dropped.
	 */
	const tokenScope = (): string[] => {
		const i = withoutComments.indexOf('--tn-radius-s');
		const head = withoutComments.slice(0, withoutComments.lastIndexOf('{', i));
		return head
			.slice(head.lastIndexOf('}') + 1)
			.split(',')
			.map((sel) => sel.trim().replace(/^\./, ''))
			.filter(Boolean);
	};

	it('every contentEl.addClass in src/ is inside the token scope', () => {
		// TaskPropertiesView added `task-notes-properties-view` to its own leaf and
		// was on nobody's list, so 21 of its declarations were dead: the panel's
		// padding and gaps, .tn-input's border, radius, height and font, the focus
		// ring, the Apply button's radius. That is why it looked unstyled.
		const scope = new Set(tokenScope());
		const roots: string[] = [];
		for (const { path, text } of SOURCES) {
			for (const m of text.matchAll(/contentEl\.addClass\(['"]([\w-]+)['"]\)/g)) {
				if (!scope.has(m[1])) roots.push(`${path}: .${m[1]}`);
			}
		}
		expect(roots, `add these to the --tn-* selector list in styles.css`).toEqual([]);
	});
});

describe('one vocabulary, enforced', () => {
	it('states every font-size through a token, or inherits one', () => {
		// `inherit` is allowed and is not a loophole: it is the opposite of picking
		// a size. Rendered-Markdown children inside a block (Obsidian emits <h1>,
		// <strong>, <p>) must take the grid's size rather than their own, and
		// naming a token there would be a second place to keep in step.
		const raw = [...withoutComments.matchAll(/font-size:\s*([^;]+);/g)]
			.map((m) => m[1].trim())
			.filter((value) => value !== 'inherit')
			.filter((value) => !/^var\(--(tn|font)-/.test(value));
		expect(raw).toEqual([]);
	});

	it('states every opacity as 0, 1, a token or a computation', () => {
		// Seven distinct hand-picked values across 18 declarations meant "muted"
		// had four spellings, and .tn-day-note stacked two of them.
		const raw = [...withoutComments.matchAll(/[^-]opacity:\s*([^;]+);/g)]
			.map((m) => m[1].trim())
			.filter((value) => !/^(0|1|var\(--tn-|calc\()/.test(value));
		expect(raw).toEqual([]);
	});

	it('never restates the focus ring WIDTH — one weight, from --tn-ring', () => {
		// Otherwise "focused" is 2px here and 1px there. Only the ring itself is in
		// scope: `.tn-block:hover, .tn-block:focus-visible` raises an elevation, not
		// a ring, and correctly states no width at all.
		const focus = RULES.filter((r) => r.selector.includes(':focus-visible'));
		expect(focus.length).toBeGreaterThan(0); // the check is not vacuous
		const raw = focus
			.flatMap((r) => [...r.body.matchAll(/(?:outline|box-shadow):([^;]+);/g)].map((m) => m[1]))
			.filter((value) => /\b\d+px\b/.test(value));
		expect(raw).toEqual([]);
	});
});

describe('reduced motion, derived rather than hand-listed', () => {
	it('every rule that animates also opts out', () => {
		// It covered 4 of 10 transitions, because the list was maintained by hand
		// and every new transition was one somebody had to remember.
		const block = withoutComments.slice(
			withoutComments.indexOf('@media (prefers-reduced-motion: reduce)'),
		);
		const optedOut = block.slice(0, block.indexOf('transition: none'));

		// `[^-]` so the token block's own `--tn-transition:` is not a transition.
		const animated = RULES.filter((r) => /[^-]transition:\s*(?!none)/.test(r.body)).flatMap((r) =>
			r.selector.split(',').map((sel) => sel.trim()),
		);
		expect(animated.length).toBeGreaterThan(0); // the check is not vacuous
		expect(animated.filter((sel) => !optedOut.includes(sel))).toEqual([]);
	});
});

describe('no class exists on only one side', () => {
	/** The `tn-*` / `task-notes-*` / `task-modal-*` classes styles.css mentions. */
	const OURS = /^(?:tn-|task-notes-|task-modal-)/;
	const styled = new Set(
		[...withoutComments.matchAll(/\.([\w-]+)/g)].map((m) => m[1]).filter((c) => OURS.test(c)),
	);

	it('every class the source emits is styled by something', () => {
		// .tn-allday-fixed was toggled on every drag and styled by nothing, and
		// .tn-range-more-label was rendered with no rule at all.
		const emitted = new Set<string>();
		const add = (raw: string): void => {
			for (const cls of raw.split(/\s+/)) if (OURS.test(cls)) emitted.add(cls);
		};
		for (const m of ALL_SOURCE.matchAll(/class:([\w-]+)/g)) add(m[1]);
		for (const m of ALL_SOURCE.matchAll(/class=["']([\w\s-]+)["']/g)) add(m[1]);
		for (const m of ALL_SOURCE.matchAll(/cls: ?['"]([\w\s-]+)['"]/g)) add(m[1]);
		// Built by concatenation — TimeGrid's `classesFor` composes the entire
		// block-state vocabulary this way (`cls += ' tn-block-now'`), so without
		// this the thirteen states a block can be in were outside the guard.
		for (const m of ALL_SOURCE.matchAll(/\+=\s*['"`]\s*([\w\s-]+)['"`]/g)) add(m[1]);
		expect([...emitted].filter((cls) => !styled.has(cls)).sort()).toEqual([]);
	});

	it('every class styles.css styles is emitted by something', () => {
		// The other direction: a rule for a class nothing renders is dead weight
		// that reads as live code.
		//
		// The exception is a class name completed at runtime — `tn-dot-{kind}`,
		// `tn-cal-v-{variant}`, `tn-input-${type}`. Those prefixes are DERIVED from
		// the source rather than listed, so a new one is covered automatically and
		// an old one stops being an excuse the moment its interpolation is deleted.
		const interpolated = [...ALL_SOURCE.matchAll(/\b((?:tn|task)[\w-]*-)[{$]/g)].map((m) => m[1]);
		const builtAtRuntime = (cls: string): boolean =>
			interpolated.some((prefix) => cls.startsWith(prefix));

		const orphans = [...styled]
			.filter((cls) => !builtAtRuntime(cls))
			.filter((cls) => !new RegExp(`\\b${cls}\\b`).test(ALL_SOURCE))
			.sort();
		expect(orphans).toEqual([]);
	});
});

describe('a <button> rule must outrank Obsidian\'s own', () => {
	/**
	 * app.css has, with no @layer anywhere in it:
	 *
	 *   button:not(.clickable-icon) {
	 *     color: var(--text-color);
	 *     background-color: var(--interactive-normal);
	 *   }
	 *
	 * `button:not(.clickable-icon)` is specificity (0,1,1) — the `:not()` argument
	 * counts. A lone class is (0,1,0), so Obsidian wins and source order never gets
	 * a say. Every one of our buttons was silently rendering in Obsidian's grey
	 * instead of the colour we set; the Apply button was the one that showed.
	 *
	 * `button.x` is (0,1,1) too, and plugin CSS is injected after app.css, so it
	 * ties and wins on order. Anything with a pseudo-class or an ancestor is
	 * already (0,2,0) or better and needs nothing.
	 */
	const OBSIDIAN_BUTTON_SPECIFICITY = { classes: 1, elements: 1 };

	/** Every class `src/**` puts on a real `<button>`. */
	const MINE = /^(?:tn-|task-notes-|task-modal-)/;
	function buttonClasses(): Set<string> {
		const out = new Set<string>();
		const keep = (raw: string): void => {
			for (const cls of raw.split(/\s+/)) if (MINE.test(cls)) out.add(cls);
		};
		for (const { text } of SOURCES) {
			for (const m of text.matchAll(/<button\b[^>]*?class="([^"]*)"/gs)) keep(m[1]);
			for (const m of text.matchAll(/createEl\(\s*'button'[^)]*?cls:\s*'([^']+)'/gs)) keep(m[1]);
		}
		return out;
	}

	/** Rough specificity of one selector — enough to compare against (0,1,1). */
	function specificity(selector: string): { classes: number; elements: number } {
		const classes =
			(selector.match(/\.[\w-]+/g) ?? []).length +
			(selector.match(/:(?!:)[\w-]+/g) ?? []).length +
			(selector.match(/\[[^\]]+\]/g) ?? []).length;
		const elements = (selector.match(/(?:^|[\s>+~])[a-z][\w-]*/g) ?? []).length;
		return { classes, elements };
	}

	const outranks = (a: { classes: number; elements: number }): boolean =>
		a.classes > OBSIDIAN_BUTTON_SPECIFICITY.classes ||
		(a.classes === OBSIDIAN_BUTTON_SPECIFICITY.classes &&
			a.elements >= OBSIDIAN_BUTTON_SPECIFICITY.elements);

	it('the check is not vacuous — we do render buttons', () => {
		expect(buttonClasses().size).toBeGreaterThan(5);
	});

	it('no button rule that sets background or color loses to app.css', () => {
		const buttons = buttonClasses();
		const losers: string[] = [];
		for (const rule of RULES) {
			if (!/(?:^|[;\s])(background|color)\s*:/.test(rule.body)) continue;
			for (const selector of rule.selector.split(',').map((x) => x.trim())) {
				const owns = [...buttons].some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(selector));
				if (!owns) continue;
				if (!outranks(specificity(selector))) losers.push(selector);
			}
		}
		expect(
			losers,
			'prefix these with `button` (or use Obsidian\'s mod-cta) — a lone class ' +
				'loses to `button:not(.clickable-icon)` in app.css',
		).toEqual([]);
	});
});

describe("a rendered-Markdown surface must carry Obsidian's own class", () => {
	/**
	 * THE BUG THIS EXISTS FOR — it took three attempts to find.
	 *
	 * app.css styles `b`/`strong` and `i`/`em` as BARE element selectors, so they
	 * work anywhere. It styles `mark` as `.markdown-rendered mark` — scoped. So a
	 * `<mark>` we build ourselves is in the DOM, correct, and completely unstyled:
	 * `**bold**` appeared to work while `==highlight==` could never show, and every
	 * investigation went looking in the rendering pipeline, which was fine.
	 *
	 * Any element we render Markdown into must therefore carry the class.
	 */
	const RENDER_TARGETS = ['tn-block-title', 'tn-row-title', 'tn-chip-label'];

	it('every Markdown target is rendered with `markdown-rendered` beside it', () => {
		const missing: string[] = [];
		for (const cls of RENDER_TARGETS) {
			// The class list as written in the markup, wherever that class appears.
			const written = [...ALL_SOURCE.matchAll(new RegExp(`class="([^"]*\\b${cls}\\b[^"]*)"`, 'g'))].map(
				(m) => m[1],
			);
			expect(written.length, `${cls} is not rendered anywhere`).toBeGreaterThan(0);
			// A plain-text fallback copy is allowed; at least one must be rendered.
			if (!written.some((list) => list.split(/\s+/).includes('markdown-rendered'))) missing.push(cls);
		}
		expect(
			missing,
			'without `markdown-rendered`, Obsidian never styles <mark> and the highlight is invisible',
		).toEqual([]);
	});

	it('nothing re-kills the highlight in our own CSS', () => {
		// A rule that neutralises `mark` was exactly the second half of this bug:
		// `.tn-body-row mark { background: none }` deleted the highlight on every
		// indented sub-row, on purpose, in an earlier round.
		const killers = RULES.filter(
			(r) => /\bmark\b/.test(r.selector) && /background:\s*(none|transparent)/.test(r.body),
		);
		expect(killers.map((r) => r.selector)).toEqual([]);
	});
});
