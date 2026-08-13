import { describe, it, expect } from 'vitest';
import { formatFields, isLegacyFormat, applyFieldValues, missingFields } from '../src/core/format-fields';
import { parseTaskProperties, generateTaskName } from '../src/core/task-name';
import { migrateSettings, DEFAULT_SETTINGS, LEGACY_TARGET_FORMAT } from '../src/settings/settings';
import type { PropKey } from '../src/core/format-fields';
import type { TaskProperties } from '../src/types';

const LEGACY = '{action} - {amount} - {outcome}';
const GOAL = '{identity} - {action} - {amount} - {outcome}';
const ROUTINE = '{action} - {amount} - {outcome} - {cycle}';
const AREA = '{identity} - {name}';
const SCHEDULED = 'By {date} (at {time} - {range}), {action} - {amount} - {outcome}';

describe('formatFields', () => {
	it('reads the legacy three slots', () => {
		expect(formatFields(LEGACY).map((f) => f.propKey)).toEqual(['actionWords', 'amount', 'amountOutcome']);
	});

	it('excludes date/time/range — they are not text inputs', () => {
		expect(formatFields(SCHEDULED).map((f) => f.placeholder)).toEqual(['action', 'amount', 'outcome']);
	});

	it('maps the named fields to their own properties, in template order', () => {
		expect(formatFields(GOAL).map((f) => f.propKey)).toEqual([
			'identity',
			'actionWords',
			'amount',
			'amountOutcome',
		]);
		expect(formatFields(ROUTINE).map((f) => f.propKey)).toEqual([
			'actionWords',
			'amount',
			'amountOutcome',
			'cycle',
		]);
		expect(formatFields(AREA).map((f) => f.propKey)).toEqual(['identity', 'name']);
	});

	it('fills legacy slots positionally for custom placeholders', () => {
		expect(formatFields('{task} - {qty} - {result}').map((f) => f.propKey)).toEqual([
			'actionWords',
			'amount',
			'amountOutcome',
		]);
		expect(formatFields('{identity} - {task} - {qty}').map((f) => f.propKey)).toEqual([
			'identity',
			'actionWords',
			'amount',
		]);
	});

	it('labels fields from their placeholder', () => {
		expect(formatFields(GOAL).map((f) => f.label)).toEqual(['Identity', 'Action', 'Amount', 'Outcome']);
	});

	it('classifies only the exact canonical shape as legacy', () => {
		// The frozen grammar always maps positionally to action/amount/outcome, so
		// anything that omits, adds or reorders those must not use it.
		expect(isLegacyFormat(LEGACY)).toBe(true);
		expect(isLegacyFormat(SCHEDULED)).toBe(true);
		expect(isLegacyFormat('{task} - {qty} - {result}')).toBe(true); // custom labels, same shape
		expect(isLegacyFormat(GOAL)).toBe(false);
		expect(isLegacyFormat(ROUTINE)).toBe(false);
		expect(isLegacyFormat(AREA)).toBe(false);
		expect(isLegacyFormat('{action} - {outcome}')).toBe(false); // omits a field
		expect(isLegacyFormat('{outcome} - {action} - {amount}')).toBe(false); // reordered
	});
});

describe("the user's real templates round-trip", () => {
	const cases: { label: string; name: string; format: string; isEvent: boolean }[] = [
		{
			label: 'goal',
			name: 'Top engineer - Get hired at - 1 company - which is leading, prestigious (FAANG, ...) or well paid',
			format: GOAL,
			isEvent: false,
		},
		{ label: 'routine', name: 'Consume - 0mg - of caffeine after 14.00h - per day ☕', format: ROUTINE, isEvent: false },
		{ label: 'project', name: 'Complete - 1 application - for BAföG', format: LEGACY, isEvent: false },
		{ label: 'task', name: 'Fix - 3 naming errors - of the amount property', format: LEGACY, isEvent: false },
		{ label: 'area', name: 'English speaker - English language', format: AREA, isEvent: false },
		{
			label: 'event',
			name: 'By 2025-10-04 at 10.00h, attend about - 3h - of the Munich street food market with Sarah',
			format: SCHEDULED,
			isEvent: true,
		},
		{
			label: 'event with range',
			name: 'By 2025-10-04 at 12.00h - 2025-10-14, attend - 10d - of the techno festival in Munich',
			format: SCHEDULED,
			isEvent: true,
		},
	];

	for (const c of cases) {
		it(`${c.label} regenerates byte-identically`, () => {
			const props = parseTaskProperties(c.name, c.isEvent, c.format);
			expect(generateTaskName(props, c.format)).toBe(c.name);
		});
	}

	it('parses the goal into its four fields', () => {
		const props = parseTaskProperties(cases[0].name, false, GOAL);
		expect(props.identity).toBe('Top engineer');
		expect(props.actionWords).toBe('Get hired at');
		expect(props.amount).toBe('1 company');
		expect(props.amountOutcome).toBe('which is leading, prestigious (FAANG, ...) or well paid');
	});

	it('parses the routine cycle as its own field', () => {
		const props = parseTaskProperties(cases[1].name, false, ROUTINE);
		expect(props.actionWords).toBe('Consume');
		expect(props.amount).toBe('0mg');
		expect(props.amountOutcome).toBe('of caffeine after 14.00h');
		expect(props.cycle).toBe('per day ☕');
	});
});

describe('generateTaskName no longer damages user text', () => {
	it('keeps the word "at" inside user content', () => {
		// The cosmetic "drop an orphaned at" cleanup used to delete this.
		expect(generateTaskName({ actionWords: 'Meet at', amount: '1', amountOutcome: 'Bob' }, LEGACY)).toBe(
			'Meet at - 1 - Bob',
		);
	});

	it('keeps user parentheses', () => {
		expect(
			generateTaskName({ actionWords: 'Work', amount: '2h', amountOutcome: '(at home) focus' }, LEGACY),
		).toBe('Work - 2h - (at home) focus');
	});

	it('keeps regex substitution patterns literal', () => {
		expect(generateTaskName({ actionWords: '$&', amount: "$'", amountOutcome: '$1 $$' }, LEGACY)).toBe(
			"$& - $' - $1 $$",
		);
	});

	it('keeps private-use characters that appear in user text', () => {
		// The generator uses private-use chars as scaffolding; text that happens to
		// contain them must still come out intact, never re-substituted.
		const evil = 'pre\uE0000\uE001post\uE002end';
		expect(generateTaskName({ actionWords: evil, amount: '1', amountOutcome: 'x' }, LEGACY)).toBe(
			`${evil.charAt(0).toUpperCase()}${evil.slice(1)} - 1 - x`,
		);
	});

	it('keeps unicode and emoji', () => {
		expect(
			generateTaskName({ actionWords: 'Zahle', amount: '1 Antrag', amountOutcome: 'für BAföG ☕' }, LEGACY),
		).toBe('Zahle - 1 Antrag - für BAföG ☕');
	});

	it('still collapses an empty field and its separator', () => {
		expect(generateTaskName({ actionWords: '', amount: '1', amountOutcome: 'x' }, LEGACY)).toBe('1 - x');
		expect(
			generateTaskName({ actionWords: 'Do', amount: '1', amountOutcome: 'x', identity: '' }, GOAL),
		).toBe('Do - 1 - x');
	});

	it('still strips the date scaffolding when there is no date', () => {
		expect(generateTaskName({ actionWords: 'buy', amount: '3', amountOutcome: 'things' }, SCHEDULED)).toBe(
			'buy - 3 - things',
		);
	});
});

describe('parse, forms and generate agree on every field mapping', () => {
	// The three views of a format must never disagree: if formatFields says the
	// third input writes `amount` but generateTaskName reads `amountOutcome` for
	// {outcome}, a plain Apply silently drops part of the name.
	const FORMATS = [
		LEGACY,
		GOAL,
		ROUTINE,
		AREA,
		'{identity} - {action} - {outcome}',
		'{action} - {outcome}',
		'{outcome} - {action} - {amount}',
		'{task} - {qty} - {result}',
		'{identity} - {task} - {qty}',
	];

	for (const format of FORMATS) {
		it(`round-trips every declared field for "${format}"`, () => {
			const fields = formatFields(format);
			// Distinct values, already capitalised so the action-capitalisation rule
			// doesn't change them, and none a substring of another.
			const props: TaskProperties = { actionWords: '', amount: '', amountOutcome: '' };
			fields.forEach((f, i) => {
				props[f.propKey] = `Val${i}x`;
			});
			const name = generateTaskName(props, format);
			for (const f of fields) {
				expect(name, `${format} must contain ${f.propKey}`).toContain(props[f.propKey]);
			}
			const reparsed = parseTaskProperties(name, false, format);
			for (const f of fields) {
				expect(reparsed[f.propKey], `${format} → ${f.placeholder}`).toBe(props[f.propKey]);
			}
		});
	}

	it('never resolves a placeholder to an inherited Object property', () => {
		// `{toString}` used to yield Object.prototype.toString as the prop key.
		const fields = formatFields('{toString} - {qty}');
		expect(fields.map((f) => f.propKey)).toEqual(['actionWords', 'amount']);
		expect(generateTaskName({ actionWords: 'A', amount: 'B', amountOutcome: '' }, '{toString} - {qty}')).toBe(
			'A - B',
		);
	});
});

describe('extended parsing falls back rather than guessing', () => {
	it('uses the legacy grammar when the part count does not match the format', () => {
		// 3 parts under a 4-field goal format: ambiguous, so nothing is re-mapped.
		const props = parseTaskProperties('Get hired at - 1 company - somewhere', false, GOAL);
		expect(props.identity).toBeUndefined();
		expect(props.actionWords).toBe('Get hired at');
		expect(props.amount).toBe('1 company');
		expect(props.amountOutcome).toBe('somewhere');
	});

	it('never splits a hyphenated date', () => {
		const props = parseTaskProperties(
			'By 2026-07-25 at 09.00h - 2026-07-26, attend - 1 - conference',
			true,
			SCHEDULED,
		);
		expect(props.startDate).toBe('2026-07-25');
		expect(props.endDate).toBe('2026-07-26');
		expect(props.actionWords).toBe('attend');
	});

	it('is identical to the no-format call for every legacy format', () => {
		const names = [
			'Fix - 3 naming errors - of the amount property',
			'By 2026 - 01 - 13, moin - 2026 - 01-14, buy - 2 - thing',
			'single part',
		];
		for (const name of names) {
			expect(parseTaskProperties(name, false, LEGACY)).toEqual(parseTaskProperties(name, false));
		}
	});
});

describe('field value helpers', () => {
	it('preserves fields the format does not expose', () => {
		const props = { actionWords: 'a', amount: 'b', amountOutcome: 'c', startDate: '2026-07-24' };
		const values = new Map<PropKey, string>([['actionWords', 'z']]);
		const next = applyFieldValues(props, values);
		expect(next.actionWords).toBe('z');
		expect(next.startDate).toBe('2026-07-24'); // not dropped
	});

	it('reports which declared fields are still empty', () => {
		const fields = formatFields(GOAL);
		const values = new Map<PropKey, string>([
			['identity', 'Top engineer'],
			['actionWords', ''],
			['amount', '  '],
			['amountOutcome', 'x'],
		]);
		expect(missingFields(fields, values).map((f) => f.propKey)).toEqual(['actionWords', 'amount']);
	});
});

describe('settings migration is opt-in for existing installs', () => {
	it('keeps the legacy goal format for an existing vault', () => {
		const merged = migrateSettings({ plannerHeading: '## Day planner' }, false);
		expect(merged.targetFolderFormat).toBe(LEGACY_TARGET_FORMAT);
		expect(merged.settingsVersion).toBe(DEFAULT_SETTINGS.settingsVersion);
	});

	it('gives a fresh install the identity-first goal format', () => {
		expect(migrateSettings(null, true).targetFolderFormat).toBe(DEFAULT_SETTINGS.targetFolderFormat);
	});

	it('a data.json holding only an ICS cache is NOT a fresh vault', () => {
		// loadSettings strips icsCache and hiddenRemoteEvents before calling this, so
		// an existing install arrives here as `{}`. Freshness has to come from the
		// flag, not from the shape of what is left.
		expect(migrateSettings({}, false).targetFolderFormat).toBe(LEGACY_TARGET_FORMAT);
		expect(migrateSettings({}, true).targetFolderFormat).toBe(DEFAULT_SETTINGS.targetFolderFormat);
	});

	it('never overwrites a format the user chose', () => {
		const custom = '{identity} - {action} - {amount} - {outcome}';
		expect(migrateSettings({ targetFolderFormat: custom }, false).targetFolderFormat).toBe(custom);
	});

	it('adds the routine format to every install', () => {
		expect(migrateSettings({ plannerHeading: 'x' }, false).routineTaskFormat).toBe(
			DEFAULT_SETTINGS.routineTaskFormat,
		);
	});

	it('does not re-apply the gate once the version is stored', () => {
		const once = migrateSettings({ plannerHeading: 'x' }, false);
		once.targetFolderFormat = '{identity} - {action} - {amount} - {outcome}';
		const twice = migrateSettings(once, false);
		expect(twice.targetFolderFormat).toBe('{identity} - {action} - {amount} - {outcome}');
	});
});
