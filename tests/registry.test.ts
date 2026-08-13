import { describe, it, expect } from 'vitest';
import {
	EMOJI_REGISTRY,
	ACTIVE_MARKER,
	TASK_EMOJI_REGEX,
	TASK_EMOJIS,
	specByEmoji,
	isDoneRole,
	formatKeyFor,
	templateKeyFor,
	specsFor,
	templateKeyOf,
	formatKeyOf,
} from '../src/constants';
import { DEFAULT_SETTINGS, SETTINGS_SECTIONS } from '../src/settings/settings';
import {
	extractTaskEmoji,
	extractTaskName,
	hasTaskEmoji,
	splitActiveMarker,
	hasActiveMarker,
	activePrefixOf,
	normalizeEmoji,
} from '../src/core/emoji';
import { expectedEventBasename, parseEventBasename } from '../src/core/event-filename';
import { decideReconcile } from '../src/core/sync-decisions';

const SCHEDULED_FORMAT = 'By {date} (at {time} - {range}), {action} - {amount} - {outcome}';

describe('emoji registry', () => {
	it('derives the legacy constant groups from the registry', () => {
		expect(TASK_EMOJIS.UNCHECKED).toBe('◻️');
		expect(TASK_EMOJIS.SCHEDULED).toBe('📅');
		expect(TASK_EMOJIS.CHECKED).toBe('✅');
		expect(TASK_EMOJIS.UNIMPORTANT).toBe('❌');
		expect(specByEmoji('🚀')?.key).toBe('project');
		expect(specByEmoji('🎯')?.key).toBe('target');
		expect(EMOJI_REGISTRY.map((s) => s.key)).toEqual([
			'unchecked',
			'scheduled',
			'routine',
			'checked',
			'unimportant',
			'project',
			'target',
		]);
	});

	it('matches every registered emoji, with the variation selector optional', () => {
		for (const spec of EMOJI_REGISTRY) {
			expect(TASK_EMOJI_REGEX.test(`${spec.emoji} name`)).toBe(true);
		}
		expect(TASK_EMOJI_REGEX.test('◻ bare selector - 1 - x')).toBe(true);
		expect(TASK_EMOJI_REGEX.test('♻️ not in the vocabulary')).toBe(false);
		expect(TASK_EMOJI_REGEX.test('no emoji at all')).toBe(false);
	});

	it('maps emoji to roles, formats and templates', () => {
		expect(isDoneRole('✅')).toBe(true);
		expect(isDoneRole('❌')).toBe(true);
		expect(isDoneRole('◻️')).toBe(false);
		expect(isDoneRole('📅')).toBe(false);
		expect(formatKeyFor('📅')).toBe('scheduledTaskFormat');
		expect(formatKeyFor('🎯')).toBe('targetFolderFormat');
		expect(formatKeyFor('❓unknown')).toBe('uncheckedTaskFormat');
		expect(templateKeyFor('📅')).toBe('scheduledTaskTemplate');
		expect(templateKeyFor('❌')).toBeUndefined();
		expect(specByEmoji('✅')?.key).toBe('checked');
	});

	it('offers folder emojis for folders and file emojis for files, plus shared done states', () => {
		const fileKeys = specsFor('file').map((s) => s.key);
		const folderKeys = specsFor('folder').map((s) => s.key);
		expect(fileKeys).toContain('unchecked');
		expect(fileKeys).toContain('scheduled');
		expect(fileKeys).not.toContain('project');
		expect(folderKeys).toContain('project');
		expect(folderKeys).toContain('target');
		expect(folderKeys).not.toContain('scheduled');
		// done/dropped apply to both
		for (const keys of [fileKeys, folderKeys]) {
			expect(keys).toContain('checked');
			expect(keys).toContain('unimportant');
		}
	});
});

describe('active marker (🅰️)', () => {
	it('splits the marker off a basename', () => {
		expect(splitActiveMarker(`${ACTIVE_MARKER} 🎯 Goal`)).toEqual({ active: true, rest: '🎯 Goal' });
		expect(splitActiveMarker('🎯 Goal')).toEqual({ active: false, rest: '🎯 Goal' });
		expect(hasActiveMarker(`${ACTIVE_MARKER} 📅 By 2026-07-27, x - 1 - y`)).toBe(true);
		expect(activePrefixOf('📅 By 2026-07-27, x - 1 - y')).toBe('');
		expect(activePrefixOf(`${ACTIVE_MARKER} 📅 x`)).toBe(`${ACTIVE_MARKER} `);
	});

	it('parses marker-prefixed filenames like unmarked ones', () => {
		const marked = `${ACTIVE_MARKER} 📅 By 2026-07-27 at 15.00h, focus - 1 - deepwork`;
		expect(hasTaskEmoji(marked)).toBe(true);
		expect(extractTaskEmoji(marked)).toBe('📅');
		expect(extractTaskName(marked)).toBe('By 2026-07-27 at 15.00h, focus - 1 - deepwork');

		const props = parseEventBasename(marked);
		expect(props.startDate).toBe('2026-07-27');
		expect(props.time).toBe('15.00h');
		expect(props.actionWords).toBe('focus');
		expect(props.amountOutcome).toBe('deepwork');
	});

	it('preserves the marker when generating the expected basename', () => {
		const props = parseEventBasename(`${ACTIVE_MARKER} 📅 By 2026-07-27 at 15.00h, focus - 1 - deepwork`);
		const withMarker = expectedEventBasename(props, '2026-07-28', 600, SCHEDULED_FORMAT, `${ACTIVE_MARKER} `);
		expect(withMarker.startsWith(`${ACTIVE_MARKER} 📅 `)).toBe(true);
		expect(withMarker).toContain('2026-07-28');
		expect(withMarker).toContain('10.00h');

		// Default (no prefix) keeps the historical output byte-identical.
		const without = expectedEventBasename(props, '2026-07-28', 600, SCHEDULED_FORMAT);
		expect(without.startsWith('📅 ')).toBe(true);
	});

	it('reconcile is a fixpoint for a marked file and never strips the marker', () => {
		const basename = `${ACTIVE_MARKER} 📅 By 2026-07-27 at 15.00h, focus - 1 - deepwork`;
		// Line time matches the filename → no rename at all.
		const none = decideReconcile(
			'2026-07-27',
			[{ lineNo: 3, startMinutes: 15 * 60, targetBasename: basename }],
			SCHEDULED_FORMAT,
		);
		expect(none).toEqual([]);

		// Line moved to 09:30 → renames, but keeps the marker.
		const renamed = decideReconcile(
			'2026-07-27',
			[{ lineNo: 3, startMinutes: 9 * 60 + 30, targetBasename: basename }],
			SCHEDULED_FORMAT,
		);
		expect(renamed).toHaveLength(1);
		expect(renamed[0].toBasename.startsWith(`${ACTIVE_MARKER} 📅 `)).toBe(true);
		expect(renamed[0].toBasename).toContain('09.30h');

		// And the result is itself a fixpoint (no rename ping-pong).
		const second = decideReconcile(
			'2026-07-27',
			[{ lineNo: 3, startMinutes: 9 * 60 + 30, targetBasename: renamed[0].toBasename }],
			SCHEDULED_FORMAT,
		);
		expect(second).toEqual([]);
	});
});

describe('normalizeEmoji', () => {
	it('strips invisible format characters but keeps ZWJ sequences intact', () => {
		expect(normalizeEmoji('✅​')).toBe('✅');
		expect(normalizeEmoji('﻿❌')).toBe('❌');
		// 🏳️‍🌈 is flag + VS16 + ZWJ + rainbow — the ZWJ must survive.
		const rainbow = '🏳️‍🌈';
		expect(normalizeEmoji(rainbow)).toContain('‍');
	});
});

describe("a spec's template key is a setting the tab actually renders", () => {
	// Adding 🔁's template took four edits, and three of them were in files a
	// registry entry does not mention. Two of the three fail silently: a key with
	// no default never loads from data.json, and a key missing from its settings
	// section never gets a row — the feature just quietly does not exist.
	const withTemplates = EMOJI_REGISTRY.filter((spec) => spec.templateSettingKey);

	it('covers the statuses that can carry one', () => {
		expect(withTemplates.map((spec) => spec.key)).toEqual([
			'unchecked',
			'scheduled',
			'routine',
			'checked',
		]);
	});

	for (const spec of withTemplates) {
		const key = templateKeyOf(spec)!;

		it(`${spec.menuLabel}: ${key} has a default and a settings row`, () => {
			expect(DEFAULT_SETTINGS).toHaveProperty(key);
			// Empty, so migrateSettings fills it into an old data.json with no
			// version bump — an existing vault gains a setting, not a behaviour.
			expect(DEFAULT_SETTINGS[key]).toBe('');
			expect(SETTINGS_SECTIONS.advanced).toContain(key);
		});

		it(`${spec.menuLabel}: templateKeyFor finds it from the emoji alone`, () => {
			// This is what convert() calls, and why applying a routine template
			// needed no edit in the conversion path at all.
			expect(templateKeyFor(spec.emoji)).toBe(key);
		});
	}
});

describe('THE ONE-PLACE GUARANTEE: everything a type needs derives from its entry', () => {
	// "Adding a type = one registry entry" is a promise this file has to keep,
	// because the compiler only checks what is typed — a spec that forgets a
	// field the UI reads would surface as a blank settings row, not an error.

	it('every spec carries the full contract', () => {
		for (const spec of EMOJI_REGISTRY) {
			expect(spec.emoji.length, spec.key).toBeGreaterThan(0);
			expect(spec.menuLabel, spec.key).toBeTruthy();
			expect(spec.menuIcon, spec.key).toBeTruthy();
			expect(spec.formatSettingKey, spec.key).toBeTruthy();
			// The default format must parse as a format: at minimum the action.
			expect(spec.defaultFormat, spec.key).toContain('{action}');
		}
	});

	it('DEFAULT_SETTINGS has every derived key, with the registry value', () => {
		for (const spec of EMOJI_REGISTRY) {
			expect(DEFAULT_SETTINGS[formatKeyOf(spec)], spec.key).toBe(spec.defaultFormat);
			const tpl = templateKeyOf(spec);
			if (tpl) expect(DEFAULT_SETTINGS[tpl], spec.key).toBe('');
		}
	});

	it('keys are unique — two entries sharing a settings key would fight over it', () => {
		const formats = EMOJI_REGISTRY.map((s) => s.formatSettingKey);
		expect(new Set(formats).size).toBe(formats.length);
		const keys = EMOJI_REGISTRY.map((s) => s.key);
		expect(new Set(keys).size).toBe(keys.length);
		const emojis = EMOJI_REGISTRY.map((s) => normalizeEmoji(s.emoji));
		expect(new Set(emojis).size).toBe(emojis.length);
	});

	it('a format with {cycle} declares allowsCycle — the validator reads the spec', () => {
		for (const spec of EMOJI_REGISTRY) {
			if (spec.defaultFormat.includes('{cycle}')) {
				expect(spec.allowsCycle, `${spec.key} must declare allowsCycle`).toBe(true);
			}
		}
	});

	it('a dated default format declares its anchor — parsing depends on the prefix', () => {
		for (const spec of EMOJI_REGISTRY) {
			if (spec.defaultFormat.includes('{date}')) {
				expect(spec.requiredPrefix, `${spec.key} is dated and needs a requiredPrefix`).toBeTruthy();
				expect(spec.requiredPrefix?.pattern.test(spec.defaultFormat), spec.key).toBe(true);
			}
		}
	});
});
