// @vitest-environment happy-dom
//
// The blank-label bug: chips, block titles and body rows that showed NOTHING —
// "sometimes even if there is stuff it wont be shown in the timeline or no text
// at all". Reproduced here rather than argued about.
//
// The mechanism was a latch, not a race. `renderMarkdown` is injected (these
// components hold no Obsidian imports), it is asynchronous, and the old code
// did three things that combined badly:
//
//   1. stamped `data-tn-md` BEFORE the render, so the stamp recorded an attempt;
//   2. skipped on the stamp alone, so a node that ended up empty was never
//      retried — blank forever, across every redraw;
//   3. emptied the element unconditionally when the render resolved, so a render
//      that produced NOTHING wiped the text that was already on screen.
//
// Each test below removes one of those and fails without its fix.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import EventChip from '../../src/ui/views/svelte/EventChip.svelte';
import Harness from './ChipLabelHarness.svelte';
import type { LocalEvent, TaskEvent } from '../../src/types';

const EVENT: LocalEvent = {
	id: 'local::x',
	kind: 'local',
	title: 'prepare - 1 - deck',
	date: '2026-08-25',
	startMinutes: null,
	endMinutes: null,
	filePath: '📅 By 2026-08-25, prepare - 1 - deck.md',
	linked: false,
	checked: false,
	body: [],
};

describe('EventChip — a label is never allowed to be blank', () => {
	let host: HTMLElement;

	const chip = (): HTMLElement => {
		const el = host.querySelector<HTMLElement>('.tn-chip-label');
		if (!el) throw new Error('no chip label rendered');
		return el;
	};

	const render = (renderMarkdown: ((el: HTMLElement, text: string) => (() => void) | void) | null) =>
		mount(EventChip, {
			target: host,
			props: { event: EVENT, variant: 'allday' as const, hiddenRemote: new Set<string>(), renderMarkdown },
		});

	beforeEach(() => {
		host = document.createElement('div');
		document.body.appendChild(host);
	});
	afterEach(() => host.remove());

	it('shows its text with no renderer at all', () => {
		const app = render(null);
		expect(chip().textContent).toBe('prepare - 1 - deck');
		unmount(app);
	});

	it('THE BUG: shows its text when the renderer is injected but has not resolved yet', () => {
		// The whole content used to live in an async callback, so between mount
		// and resolve the chip was an empty span. On a slow vault that IS the
		// steady state. The plain text now sits in the markup and the renderer
		// upgrades it in place.
		const app = render(() => {
			/* never resolves — the renderer is async and may never come back */
		});
		expect(chip().textContent).toBe('prepare - 1 - deck');
		unmount(app);
	});

	it('THE BUG: keeps its text when the renderer resolves with nothing', () => {
		// MarkdownRenderer.render CAN produce an empty tree. The old swap emptied
		// the element first and appended nothing, leaving a blank chip.
		const app = render((el) => {
			// Exactly what the guarded swap in main.ts now does: an empty holder
			// means keep what is on screen.
			const holder = document.createElement('div');
			if (!holder.firstChild) return;
			el.replaceChildren(...Array.from(holder.childNodes));
		});
		flushSync();
		expect(chip().textContent).toBe('prepare - 1 - deck');
		unmount(app);
	});

	it('lets a real render replace the plain text', () => {
		const app = render((el, text) => {
			const strong = document.createElement('strong');
			strong.textContent = text.toUpperCase();
			el.replaceChildren(strong);
		});
		flushSync();
		expect(chip().querySelector('strong')?.textContent).toBe('PREPARE - 1 - DECK');
		// Replaced, not appended — the label must not end up saying it twice.
		expect(chip().textContent).toBe('PREPARE - 1 - DECK');
		unmount(app);
	});

	it('THE LATCH: re-renders a node an earlier attempt left empty', () => {
		// The stamp records an ATTEMPT, and an attempt can produce nothing. Skipping
		// on the stamp alone made that first empty result permanent: blank forever,
		// across every redraw, which is exactly what was on screen.
		//
		// Swapping the renderer (rather than the title) is deliberate — see the
		// harness. Same text, so only the `&& node.firstChild` half of the guard
		// can decide whether this renders again.
		const app = mount(Harness, {
			target: host,
			props: {
				event: EVENT as TaskEvent,
				initial: (el: HTMLElement) => el.replaceChildren(), // wipes it
			},
		});
		flushSync();
		expect(chip().firstChild).toBeNull();
		expect(chip().dataset.tnMd).toBe('prepare - 1 - deck');

		app.setRenderer((el: HTMLElement, text: string) => el.replaceChildren(text));
		flushSync();
		expect(chip().textContent).toBe('prepare - 1 - deck');
		unmount(app);
	});

	it('marks the label so Obsidian styles what it renders inside it', () => {
		// Obsidian scopes `mark`, `code` and friends to `.markdown-rendered`; a
		// highlight rendered outside that class is invisible, which is how "cant
		// see the highlighting in the timeline" happened.
		const app = render(() => {});
		expect(chip().classList.contains('markdown-rendered')).toBe(true);
		unmount(app);
	});

	it('releases renderer resources on replacement and destruction', () => {
		const firstCleanup = vi.fn();
		const secondCleanup = vi.fn();
		const app = mount(Harness, {
			target: host,
			props: {
				event: EVENT as TaskEvent,
				initial: () => firstCleanup,
			},
		});
		flushSync();
		app.setRenderer(() => secondCleanup);
		flushSync();
		expect(firstCleanup).toHaveBeenCalledOnce();
		expect(secondCleanup).not.toHaveBeenCalled();
		unmount(app);
		expect(secondCleanup).toHaveBeenCalledOnce();
	});
});
