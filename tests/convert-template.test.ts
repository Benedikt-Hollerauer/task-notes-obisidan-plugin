// THE TEMPLATE THAT APPLIED TWICE.
//
// Reported after converting a calendar event into a 📅 note and then pressing ➕
// to add it to the day plan: the note's template was in the file twice.
//
// `TaskFileService.convert` is reached two ways. Converting a PLAIN note into a
// task is a conversion, and applying that type's template is the whole point of
// `applyTemplateOnConvert`. But the ➕ flow (`main.ts` → `addToPlan`) also calls
// `convert`, on a note that is ALREADY a 📅 note, purely to rename it to the
// properties you just confirmed — and `applyTemplate(…, forceApply: true)`
// APPENDS to a non-empty file. Two calls, one template, twice in the note.

import { describe, it, expect } from 'vitest';
import {
	shouldApplyConvertTemplate,
	taskBasename,
	activePrefixOf,
	extractTaskName,
	normalizeEmoji,
} from '../src/core/emoji';
import { TASK_EMOJIS } from '../src/constants';

const SCHEDULED = TASK_EMOJIS.SCHEDULED; // 📅
const UNCHECKED = TASK_EMOJIS.UNCHECKED; // ◻️

describe('shouldApplyConvertTemplate — a template belongs to becoming a new type', () => {
	it('THE BUG: a note that is ALREADY that type gets no second template', () => {
		// This is the ➕ "add to the day plan" path exactly: a 📅 note being
		// renamed to 📅. Nothing is being converted, so nothing is templated.
		expect(
			shouldApplyConvertTemplate('📅 By 2026-08-25 at 10.00h, prepare - 1 - deck', SCHEDULED, true),
		).toBe(false);
	});

	it('a genuinely plain note becoming a task still gets its template', () => {
		expect(shouldApplyConvertTemplate('Meeting notes', SCHEDULED, true)).toBe(true);
		expect(shouldApplyConvertTemplate('2026-08-25', SCHEDULED, true)).toBe(true);
	});

	it('changing from one type to another is a conversion', () => {
		expect(shouldApplyConvertTemplate('◻️ prepare - 1 - deck', SCHEDULED, true)).toBe(true);
		expect(shouldApplyConvertTemplate('🔁 water - 1 - plants', SCHEDULED, true)).toBe(true);
	});

	it('the setting still wins over everything', () => {
		for (const name of ['Meeting notes', '◻️ prepare - 1 - deck', '📅 By 2026-08-25, a - 1 - b']) {
			expect(shouldApplyConvertTemplate(name, SCHEDULED, false), name).toBe(false);
		}
	});

	it('a variation selector is not a different type', () => {
		// ◻️ carries U+FE0F in the registry and older files spell it bare. Both
		// normalise to the same type, so neither re-applies the template — the bug
		// would otherwise return through a Unicode side door.
		expect(shouldApplyConvertTemplate('◻️ a - 1 - b', UNCHECKED, true)).toBe(false);
		expect(shouldApplyConvertTemplate('◻ a - 1 - b', UNCHECKED, true)).toBe(false);
		// …and both still count as a real conversion when the type does change.
		expect(shouldApplyConvertTemplate('◻ a - 1 - b', SCHEDULED, true)).toBe(true);
	});

	it('a name the plugin cannot read as a task counts as plain', () => {
		// `📅️` — 📅 with a trailing U+FE0F — is not matched by TASK_EMOJI_REGEX at
		// all, so `hasTaskEmoji` is false and nothing else in the plugin treats such
		// a file as a task note either. Converting it therefore IS turning a plain
		// note into a task, and it should get the template. Pinned because it looks
		// like a bug and is not one; the fix, if it is ever wanted, belongs in the
		// emoji regex, not here.
		expect(shouldApplyConvertTemplate('📅️ By 2026-08-25, a - 1 - b', SCHEDULED, true)).toBe(true);
	});

	it('survives the active marker, which rides in front of the emoji', () => {
		// 🅰️ 📅 … is still a 📅 note; the marker must not make it look plain.
		expect(shouldApplyConvertTemplate('🅰️ 📅 By 2026-08-25, a - 1 - b', SCHEDULED, true)).toBe(false);
	});

	it('is decided by the CURRENT name, not by the target', () => {
		// Both directions of the ◻️/📅 pair, so the predicate cannot be passing by
		// accident on a symmetric comparison.
		expect(shouldApplyConvertTemplate('📅 By 2026-08-25, a - 1 - b', UNCHECKED, true)).toBe(true);
		expect(shouldApplyConvertTemplate('◻️ a - 1 - b', UNCHECKED, true)).toBe(false);
	});
});

// THE 🅰️ MARKER SURVIVES EVERY RENAME PATH.
//
// `core/emoji.ts` states the rule: "every rename must put the prefix back". Two
// of the four basename-assembly sites did not — `convert` and `createTaskNote`
// spelled the expression out inline without `activePrefixOf`. Since `convert` is
// also how "Link into day plan" renames an existing 📅 note, using that feature on
// a `🅰️ 📅 …` note silently dropped the marker and rewrote every wikilink to it.
//
// `taskBasename` now takes the prefix as an argument, so the four sites cannot
// disagree again without saying so.
describe('taskBasename — one spelling of a task filename', () => {
	it('carries a prefix when given one, and omits it when not', () => {
		expect(taskBasename('📅', 'By 2026-08-20, a - 1 - b', '🅰️ ')).toBe(
			'🅰️ 📅 By 2026-08-20, a - 1 - b',
		);
		expect(taskBasename('📅', 'By 2026-08-20, a - 1 - b')).toBe('📅 By 2026-08-20, a - 1 - b');
	});

	it('round-trips a marked name through activePrefixOf', () => {
		const original = '🅰️ 📅 By 2026-08-20, prepare - 1 - deck';
		const rebuilt = taskBasename('📅', extractTaskName(original), activePrefixOf(original));
		expect(rebuilt).toBe(original);
	});

	it('squeezes whitespace and normalises the emoji exactly as the four sites did', () => {
		// `normalizeEmoji` strips variation selectors rather than adding them, so a
		// bare `◻` stays bare. Pinned because it looks like a normalisation bug and
		// is not one — this is the behaviour every rename path already had.
		expect(taskBasename(UNCHECKED, '  spaced   out  ')).toBe(`${normalizeEmoji(UNCHECKED)} spaced out`);
		expect(taskBasename('◻', 'x')).toBe('◻ x');
	});
});
