// @vitest-environment happy-dom
//
// The shared "pick one of these" row. It exists in two places now — the drag
// dialog's "Create as" and the properties panel's type switcher — which is
// exactly why it is one widget rather than two copies five files apart.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { choiceRow } from '../../src/ui/widgets/choice-row';

/**
 * Obsidian adds `createDiv`/`createEl`/`createSpan`/`toggleClass` to HTMLElement
 * at runtime. happy-dom does not, so the widget's own DOM calls need them here —
 * the same shims the plugin relies on in the app.
 */
function installObsidianDom(): void {
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
	proto.createEl = function (
		this: HTMLElement,
		tag: string,
		o: { text?: string; cls?: string; attr?: Record<string, string> } = {},
	) {
		const el = document.createElement(tag);
		if (o.text) el.textContent = o.text;
		if (o.cls) el.className = o.cls;
		for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
		this.appendChild(el);
		return el;
	};
	proto.createDiv = function (this: HTMLElement, o = {}) {
		return (this as unknown as { createEl: (t: string, o: unknown) => HTMLElement }).createEl('div', o);
	};
	proto.createSpan = function (this: HTMLElement, o = {}) {
		return (this as unknown as { createEl: (t: string, o: unknown) => HTMLElement }).createEl('span', o);
	};
	proto.toggleClass = function (this: HTMLElement, cls: string, on: boolean) {
		this.classList.toggle(cls, on);
	};
}

describe('choiceRow', () => {
	let host: HTMLElement;
	const OPTIONS = [
		{ value: 'a', label: 'A', title: 'the first' },
		{ value: 'b', label: 'B' },
		{ value: 'c', label: 'C' },
	];
	const buttons = () => [...host.querySelectorAll('button')];
	const active = () => buttons().filter((b) => b.classList.contains('tn-active')).map((b) => b.textContent);

	beforeEach(() => {
		installObsidianDom();
		host = document.createElement('div');
		document.body.appendChild(host);
		host.empty?.();
		host.innerHTML = '';
	});

	it('marks exactly the initial option, and never more than one', () => {
		choiceRow(host, { label: 'Pick', options: OPTIONS, initial: 'b' });
		expect(active()).toEqual(['B']);
	});

	it('reports a pick once, and moves the mark with it', () => {
		const picks: string[] = [];
		const row = choiceRow(host, {
			label: 'Pick',
			options: OPTIONS,
			initial: 'a',
			onPick: (v) => picks.push(v),
		});
		buttons()[2].click();
		expect(picks).toEqual(['c']);
		expect(row.value()).toBe('c');
		expect(active()).toEqual(['C']);
	});

	it('does NOT fire for re-picking what is already selected', () => {
		// The properties panel turns a pick into a file RENAME. Re-firing for a
		// click on the current type would rename a note to the name it already has.
		const picks: string[] = [];
		choiceRow(host, { label: 'Pick', options: OPTIONS, initial: 'a', onPick: (v) => picks.push(v) });
		buttons()[0].click();
		buttons()[0].click();
		expect(picks).toEqual([]);
	});

	it('`set` repaints without firing — for a state change that came from outside', () => {
		const picks: string[] = [];
		const row = choiceRow(host, {
			label: 'Pick',
			options: OPTIONS,
			initial: 'a',
			onPick: (v) => picks.push(v),
		});
		row.set('c');
		expect(row.value()).toBe('c');
		expect(active()).toEqual(['C']);
		expect(picks).toEqual([]);
	});

	it('is announced as a radiogroup, with the state on every option', () => {
		choiceRow(host, { label: 'Type', options: OPTIONS, initial: 'b' });
		expect(host.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Type');
		expect(buttons().map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
		expect(buttons().every((b) => b.getAttribute('role') === 'radio')).toBe(true);
	});

	it('never submits the form it sits in', () => {
		// Inside a <form> an unqualified button is type=submit, so picking a type
		// would fire the dialog's primary action instead of changing the choice.
		choiceRow(host, { label: 'Pick', options: OPTIONS, initial: 'a' });
		expect(buttons().every((b) => b.type === 'button')).toBe(true);
	});

	it('carries a tooltip only where one was given', () => {
		choiceRow(host, { label: 'Pick', options: OPTIONS, initial: 'a' });
		expect(buttons()[0].title).toBe('the first');
		expect(buttons()[1].title).toBe('');
	});
});

describe('keyboard: the row is ONE tab stop and arrows move inside it', () => {
	// The file's header promised "arrow-navigable" from the day it was written and
	// implemented nothing — every option was its own tab stop inside a
	// `role="radiogroup"`, which is the one pattern AT expects arrows for.
	let host: HTMLElement;
	const build = (onPick?: (v: string) => void) =>
		choiceRow(host, {
			label: 'Type',
			options: [
				{ value: 'a', label: 'A', ariaLabel: 'Alpha' },
				{ value: 'b', label: 'B' },
				{ value: 'c', label: 'C' },
			],
			initial: 'a',
			onPick,
		});
	const buttons = () => [...host.querySelectorAll('button')];
	const press = (key: string) =>
		buttons()
			.find((b) => b.tabIndex === 0)!
			.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

	beforeEach(() => {
		host = document.createElement('div');
		document.body.appendChild(host);
	});
	afterEach(() => host.remove());

	it('gives exactly one button tabIndex 0 — the selected one', () => {
		build();
		expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
	});

	it('ArrowRight moves the selection and the tab stop with it', () => {
		const row = build();
		press('ArrowRight');
		expect(row.value()).toBe('b');
		expect(buttons().map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
	});

	it('wraps at both ends, so the group is a loop', () => {
		const row = build();
		press('ArrowLeft');
		expect(row.value()).toBe('c');
		press('ArrowRight');
		expect(row.value()).toBe('a');
	});

	it('fires onPick exactly once per move, like a click', () => {
		const picked: string[] = [];
		build((v) => picked.push(v));
		press('ArrowRight');
		press('ArrowDown');
		expect(picked).toEqual(['b', 'c']);
	});

	it('ignores keys that are not arrows, and does not swallow them', () => {
		const row = build();
		const btn = buttons()[0];
		const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
		btn.dispatchEvent(ev);
		expect(row.value()).toBe('a');
		expect(ev.defaultPrevented).toBe(false);
	});

	it('uses ariaLabel as the accessible name when the label is a bare glyph', () => {
		build();
		expect(buttons()[0].getAttribute('aria-label')).toBe('Alpha');
		// …and leaves it alone when the label already reads as words.
		expect(buttons()[1].hasAttribute('aria-label')).toBe(false);
	});
});
