// The single reader of a name-format template. Pure (no Obsidian imports).
//
// A format like `{identity} - {action} - {amount} - {outcome}` declares both the
// FIELDS a name carries and their ORDER. Parsing and the input forms both derive
// from this, so adding a placeholder to a format is all it takes to support it.

import type { TaskProperties } from '../types';

/** Placeholders that carry a machine value, not user text. */
const DATE_PLACEHOLDERS = ['date', 'time', 'range'];

/**
 * Placeholders with a FIXED property. These must match generateTaskName's
 * substitution table exactly: if the two disagree, a format that omits or
 * reorders one of them would read and write different fields and silently drop
 * part of the name.
 */
const NAMED_FIELDS: Record<string, PropKey> = {
	identity: 'identity',
	name: 'name',
	cycle: 'cycle',
	action: 'actionWords',
	amount: 'amount',
	outcome: 'amountOutcome',
};

/** The slots a CUSTOM placeholder (e.g. `{task}`) fills, in order. */
const LEGACY_SLOTS: PropKey[] = ['actionWords', 'amount', 'amountOutcome'];

export type PropKey = 'identity' | 'name' | 'actionWords' | 'amount' | 'amountOutcome' | 'cycle';

export interface FormatField {
	/** The placeholder without braces, e.g. 'action'. */
	placeholder: string;
	/** Where the value lives on TaskProperties. */
	propKey: PropKey;
	/** Human label for an input, e.g. 'Action'. */
	label: string;
}

/** The one copy: settings-tab and the field engine both label placeholders. */
export function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The ordered, de-duplicated text fields a format declares.
 * Date/time/range are excluded — they are not free-text inputs.
 *
 * Unknown placeholders (a user writing `{task} - {qty} - {result}`) fill the
 * legacy slots in order, which is how custom labels have always worked.
 */
export function formatFields(format: string): FormatField[] {
	const seen = new Set<string>();
	const fields: FormatField[] = [];
	let nextLegacy = 0;

	for (const match of format.matchAll(/\{(\w+)\}/g)) {
		const placeholder = match[1];
		if (seen.has(placeholder) || DATE_PLACEHOLDERS.includes(placeholder)) continue;
		seen.add(placeholder);

		// hasOwnProperty, not a bare lookup: a placeholder named `toString` or
		// `constructor` would otherwise resolve to an inherited function.
		const named = Object.prototype.hasOwnProperty.call(NAMED_FIELDS, placeholder)
			? NAMED_FIELDS[placeholder]
			: undefined;
		if (named) {
			fields.push({ placeholder, propKey: named, label: capitalize(placeholder) });
			continue;
		}
		if (nextLegacy < LEGACY_SLOTS.length) {
			fields.push({ placeholder, propKey: LEGACY_SLOTS[nextLegacy++], label: capitalize(placeholder) });
		}
	}

	return fields;
}

/** The exact shape the frozen grammar understands: three fields, in this order. */
const CANONICAL_SLOTS: PropKey[] = ['actionWords', 'amount', 'amountOutcome'];

/**
 * True when a format has exactly the classic three-slot shape — three text
 * fields mapping to action / amount / outcome, in that order. Only these keep
 * using the original parser, which is what guarantees existing filenames never
 * change meaning.
 *
 * A format that omits, adds or REORDERS one of the three is not something the
 * frozen grammar can read (it always maps positionally to action/amount/outcome),
 * so it takes the format-driven path instead — otherwise parsing and generation
 * would disagree and a plain Apply could drop a field.
 */
export function isLegacyFormat(format: string): boolean {
	const keys = formatFields(format).map((f) => f.propKey);
	return keys.length === CANONICAL_SLOTS.length && keys.every((k, i) => k === CANONICAL_SLOTS[i]);
}

/** Apply edited values onto a copy of the parsed properties. */
export function applyFieldValues(
	props: TaskProperties,
	values: Map<PropKey, string>,
): TaskProperties {
	// Spread first so fields the format doesn't expose (dates, or an identity the
	// user hasn't opted into) are preserved rather than silently dropped.
	const next: TaskProperties = { ...props };
	for (const [key, value] of values) next[key] = value;
	return next;
}

/** Fields declared by the format that have no value yet. */
export function missingFields(fields: FormatField[], values: Map<PropKey, string>): FormatField[] {
	return fields.filter((f) => !(values.get(f.propKey) ?? '').trim());
}
