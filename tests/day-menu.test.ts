import { describe, it, expect } from 'vitest';
import { dayMenuItems } from '../src/core/day-menu';
import { APPLY_TEMPLATE_LABEL } from '../src/constants';
import { dayIntent } from '../src/core/interaction';

describe('dayMenuItems — what a day offers, and when', () => {
	it('offers two things when the daily note does not exist yet', () => {
		// A template can only be merged into a file that is already there, so the
		// third item is genuinely conditional — "a menu of three actions" is only
		// three once the note exists.
		const items = dayMenuItems(false);
		expect(items.map((i) => i.action)).toEqual(['open', 'open-new-tab']);
	});

	it('offers the template merge once the note exists, behind a separator', () => {
		const items = dayMenuItems(true);
		expect(items.map((i) => i.action)).toEqual(['open', 'open-new-tab', 'apply-template']);
		expect(items[2].separatorBefore).toBe(true);
		// The one label, not a re-typed copy — the palette and the file menu use
		// the same constant.
		expect(items[2].label).toBe(APPLY_TEMPLATE_LABEL);
	});

	it('never hides that opening a missing note CREATES it', () => {
		// Creating is a write. The button's own icon already makes the distinction
		// (a `+` page vs a lined one); the menu says it in words.
		for (const item of dayMenuItems(false)) expect(item.label).toMatch(/^Create and open/);
		for (const item of dayMenuItems(true)) expect(item.label).not.toMatch(/Create/);
	});

	it('gives every item an icon and a distinct action', () => {
		for (const hasNote of [false, true]) {
			const items = dayMenuItems(hasNote);
			expect(items.every((i) => i.icon.length > 0)).toBe(true);
			expect(new Set(items.map((i) => i.action)).size).toBe(items.length);
			expect(new Set(items.map((i) => i.label)).size).toBe(items.length);
		}
	});

	it('hands each caller its own array, so one cannot corrupt the other', () => {
		// Two entry points share this builder — the note button's left-click and the
		// day cell's right-click. A shared array instance would let whichever menu
		// was built first hand the second one a mutated list.
		const first = dayMenuItems(true);
		const second = dayMenuItems(true);
		expect(first).not.toBe(second);
		first.pop();
		expect(second).toHaveLength(3);
	});
});

describe('dayIntent — one rule for what a click on a day means', () => {
	const mods = (over: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		...over,
	});

	it('reads a plain click as "focus this day"', () => {
		expect(dayIntent(mods())).toBe('focus');
		// Shift alone is not a modifier this rule assigns meaning to.
		expect(dayIntent(mods({ shiftKey: true }))).toBe('focus');
	});

	it('reads Ctrl and Cmd the same, so the rule is not platform-specific', () => {
		expect(dayIntent(mods({ ctrlKey: true }))).toBe('open');
		expect(dayIntent(mods({ metaKey: true }))).toBe('open');
	});

	it('adds Shift for a new tab', () => {
		expect(dayIntent(mods({ ctrlKey: true, shiftKey: true }))).toBe('open-new-leaf');
		expect(dayIntent(mods({ metaKey: true, shiftKey: true }))).toBe('open-new-leaf');
	});

	it('lets Alt win outright', () => {
		// Alt is checked first on purpose: "show me this day in the timeline" is a
		// navigation, not a variant of opening a file.
		expect(dayIntent(mods({ altKey: true }))).toBe('timeline');
		expect(dayIntent(mods({ altKey: true, ctrlKey: true, shiftKey: true }))).toBe('timeline');
	});
});
