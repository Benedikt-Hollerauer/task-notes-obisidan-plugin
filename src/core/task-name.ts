// Pure parse/generate/format logic for the FROZEN emoji-filename grammar.
// Behaviour ported verbatim from the original main.ts (lines 152–403) so every
// existing filename round-trips identically. Do not change this grammar — it is
// the plain-markdown contract the whole plugin is built around.

import type { TaskProperties, TaskFormatSettings } from '../types';
import { ENTITY_EMOJI_STRIP_REGEX, formatKeyFor } from '../constants';
import { cleanupTaskName } from './emoji';
import { formatFields, isLegacyFormat } from './format-fields';

/**
 * Parse a task name (emoji already stripped) into properties.
 * `isEvent` selects the scheduled/event grammar (leading `By <date>`).
 *
 * `format` is optional: without it — or with any of the classic three-slot
 * templates — the FROZEN legacy grammar runs unchanged, which is what keeps
 * every existing filename in every vault parsing exactly as before. Only a
 * format that declares {identity}/{name}/{cycle} takes the positional path.
 */
export function parseTaskProperties(
	taskName: string,
	isEvent: boolean,
	format?: string,
): TaskProperties {
	if (!format || isLegacyFormat(format)) return parseLegacy(taskName, isEvent);
	return parseExtended(taskName, isEvent, format);
}

/**
 * THE FROZEN GRAMMAR. Ported verbatim from the original main.ts and never
 * edited again — every new code path falls back into it.
 */
function parseLegacy(taskName: string, isEvent: boolean): TaskProperties {
	taskName = cleanupTaskName(taskName);

	const cleanPlaceholder = (value: string): string => {
		if (value && /\{[^}]+\}/.test(value)) return '';
		return value;
	};

	const props: TaskProperties = {
		actionWords: '',
		amount: '',
		amountOutcome: '',
	};

	if (isEvent) {
		const parseRemainder = (remainder: string): void => {
			const partRegex = /^(.+?)\s*-\s*(.+?)\s*-\s*(.+)$/;
			const partMatch = remainder.match(partRegex);
			if (partMatch) {
				props.actionWords = cleanPlaceholder(partMatch[1].trim());
				props.amount = cleanPlaceholder(partMatch[2].trim());
				props.amountOutcome = cleanPlaceholder(partMatch[3].trim());
			} else {
				props.actionWords = cleanPlaceholder(remainder.trim());
			}
		};

		// 1. Legacy parens: By YYYY-MM-DD (at HH.MMh - YYYY-MM-DD), action - amount - outcome
		const eventParenRegex = /^By\s+(\d{4}-\d{2}-\d{2})\s*\(\s*(?:at\s+)?(\d{2}\.\d{2}h)?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*\)\s*,?\s*(.+)$/;
		const matchParen = taskName.match(eventParenRegex);
		if (matchParen) {
			props.startDate = cleanPlaceholder(matchParen[1]);
			props.time = matchParen[2] ? cleanPlaceholder(matchParen[2]) : undefined;
			props.endDate = matchParen[3] ? cleanPlaceholder(matchParen[3]) : undefined;
			parseRemainder(matchParen[4]);
			return props;
		}

		// 2. No-parens, date + time + range: By YYYY-MM-DD at HH.MMh - YYYY-MM-DD, ...
		const eventTimeRangeRegex = /^By\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{2}\.\d{2}h)\s*-\s*(\d{4}-\d{2}-\d{2})\s*,\s*(.+)$/;
		const matchTimeRange = taskName.match(eventTimeRangeRegex);
		if (matchTimeRange) {
			props.startDate = cleanPlaceholder(matchTimeRange[1]);
			props.time = cleanPlaceholder(matchTimeRange[2]);
			props.endDate = cleanPlaceholder(matchTimeRange[3]);
			parseRemainder(matchTimeRange[4]);
			return props;
		}

		// 3. No-parens, date + time only: By YYYY-MM-DD at HH.MMh, ...
		const eventTimeOnlyRegex = /^By\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{2}\.\d{2}h)\s*,\s*(.+)$/;
		const matchTimeOnly = taskName.match(eventTimeOnlyRegex);
		if (matchTimeOnly) {
			props.startDate = cleanPlaceholder(matchTimeOnly[1]);
			props.time = cleanPlaceholder(matchTimeOnly[2]);
			parseRemainder(matchTimeOnly[3]);
			return props;
		}

		// 4. No-parens, date + range only: By YYYY-MM-DD - YYYY-MM-DD, ...
		const eventRangeOnlyRegex = /^By\s+(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})\s*,\s*(.+)$/;
		const matchRangeOnly = taskName.match(eventRangeOnlyRegex);
		if (matchRangeOnly) {
			props.startDate = cleanPlaceholder(matchRangeOnly[1]);
			props.endDate = cleanPlaceholder(matchRangeOnly[2]);
			parseRemainder(matchRangeOnly[3]);
			return props;
		}

		// 5. Date only: By YYYY-MM-DD, action - amount - outcome
		const eventDateOnlyRegex = /^By\s+(\d{4}-\d{2}-\d{2})\s*,\s*(.+?)\s*-\s*(.+?)\s*-\s*(.+)$/;
		const matchDateOnly = taskName.match(eventDateOnlyRegex);
		if (matchDateOnly) {
			props.startDate = cleanPlaceholder(matchDateOnly[1]);
			props.actionWords = cleanPlaceholder(matchDateOnly[2]);
			props.amount = cleanPlaceholder(matchDateOnly[3]);
			props.amountOutcome = cleanPlaceholder(matchDateOnly[4]);
			return props;
		}
	}

	// Regular task: action - amount - outcome
	const partRegex = /^(.+?)\s*-\s*(.+?)\s*-\s*(.+)$/;
	const match = taskName.match(partRegex);
	if (match) {
		props.actionWords = cleanPlaceholder(match[1].trim());
		props.amount = cleanPlaceholder(match[2].trim());
		props.amountOutcome = cleanPlaceholder(match[3].trim());
		return props;
	}

	// Fallback: just action.
	props.actionWords = cleanPlaceholder(taskName.trim());
	return props;
}

/** The date/time prefix of an event name, and the text that follows it. */
interface EventPrefix {
	startDate?: string;
	endDate?: string;
	time?: string;
	remainder: string;
}

/**
 * Split `By <date> …,` off the front of an event name using the same patterns
 * the frozen grammar accepts. Returns null when the name has no event prefix.
 */
function splitEventPrefix(taskName: string): EventPrefix | null {
	const paren = taskName.match(
		/^By\s+(\d{4}-\d{2}-\d{2})\s*\(\s*(?:at\s+)?(\d{2}\.\d{2}h)?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*\)\s*,?\s*(.+)$/,
	);
	if (paren) return { startDate: paren[1], time: paren[2], endDate: paren[3], remainder: paren[4] };

	const timeRange = taskName.match(
		/^By\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{2}\.\d{2}h)\s*-\s*(\d{4}-\d{2}-\d{2})\s*,\s*(.+)$/,
	);
	if (timeRange) {
		return { startDate: timeRange[1], time: timeRange[2], endDate: timeRange[3], remainder: timeRange[4] };
	}

	const timeOnly = taskName.match(/^By\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{2}\.\d{2}h)\s*,\s*(.+)$/);
	if (timeOnly) return { startDate: timeOnly[1], time: timeOnly[2], remainder: timeOnly[3] };

	const rangeOnly = taskName.match(/^By\s+(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})\s*,\s*(.+)$/);
	if (rangeOnly) return { startDate: rangeOnly[1], endDate: rangeOnly[2], remainder: rangeOnly[3] };

	const dateOnly = taskName.match(/^By\s+(\d{4}-\d{2}-\d{2})\s*,\s*(.+)$/);
	if (dateOnly) return { startDate: dateOnly[1], remainder: dateOnly[2] };

	return null;
}

/**
 * Parse against a format that declares named fields ({identity}/{name}/{cycle}).
 *
 * Positional, and deliberately strict: the parts must match the declared fields
 * exactly, otherwise the frozen legacy grammar takes over. That rule is what
 * makes this safe — a name that doesn't fit the new shape is never re-interpreted.
 */
function parseExtended(taskName: string, isEvent: boolean, format: string): TaskProperties {
	const cleaned = cleanupTaskName(taskName);
	const fields = formatFields(format);

	let dates: EventPrefix | null = null;
	let remainder = cleaned;
	if (isEvent) {
		dates = splitEventPrefix(cleaned);
		if (!dates) return parseLegacy(taskName, isEvent);
		remainder = dates.remainder;
	}

	// Split on the SPACED dash only: a bare `-` would shred dates like 2026-07-25.
	const parts = remainder.split(/\s+-\s+/).map((p) => p.trim());
	if (parts.length !== fields.length) return parseLegacy(taskName, isEvent);

	const props: TaskProperties = { actionWords: '', amount: '', amountOutcome: '' };
	fields.forEach((field, i) => {
		const value = parts[i];
		// A leftover placeholder means the field was never filled in.
		props[field.propKey] = /\{[^}]+\}/.test(value) ? '' : value;
	});

	if (dates) {
		props.startDate = dates.startDate;
		props.time = dates.time;
		props.endDate = dates.endDate;
	}
	return props;
}

/**
 * Sentinels stand in for user text while the cosmetic cleanups below run.
 *
 * Those cleanups (dropping an orphaned "at", stripping the parens around a
 * time, tidying stray separators) are written for the TEMPLATE's own
 * punctuation, but they used to run over the substituted user text too —
 * deleting the word "at" from "Meet at - 1 - Bob" and eating real parentheses.
 * Private-use characters can't match any of them and survive the pipeline intact.
 */
const SENTINEL_START = '';
const SENTINEL_END = '';
const SENTINEL_EMPTY = '';

/** Generate a task name from properties using a format template. */
export function generateTaskName(props: TaskProperties, format: string): string {
	let result = format.replace(ENTITY_EMOJI_STRIP_REGEX, '');

	// Capitalize action for regular tasks; lowercase for events (action follows the date).
	const isEvent = format.includes('{date}');
	let actionWords = props.actionWords;
	if (actionWords) {
		if (isEvent) {
			actionWords = actionWords.charAt(0).toLowerCase() + actionWords.slice(1);
		} else {
			actionWords = actionWords.charAt(0).toUpperCase() + actionWords.slice(1);
		}
	}

	// Replacer FUNCTIONS so `$&`/`$'` in user text is inert, never a substitution.
	if (props.startDate) {
		result = result.replace('{date}', () => props.startDate ?? '');
		result = result.replace('{time}', () => props.time || '');
		result = result.replace('{range}', () => props.endDate || '');
	} else {
		result = result.replace('{date}', '');
		result = result.replace('{time}', '');
		result = result.replace('{range}', '');
	}

	// User text goes in as sentinels so the cosmetic cleanups below can only ever
	// act on the template's own punctuation, never on what the user typed.
	const values: string[] = [];
	const put = (value: string): string => {
		if (!value) return SENTINEL_EMPTY;
		values.push(value);
		return `${SENTINEL_START}${values.length - 1}${SENTINEL_END}`;
	};

	// Substitution is driven by the SAME field mapping parsing and the input forms
	// use, so a format that omits or reorders a placeholder can never read one
	// property and write another.
	for (const field of formatFields(format)) {
		const value = field.propKey === 'actionWords' ? actionWords : props[field.propKey] ?? '';
		result = result.replace(`{${field.placeholder}}`, () => put(value));
	}

	result = result.replace(/\{[^}]+\}/g, '');

	// Strip parentheses around the time/range block — parens are never wanted.
	result = result.replace(/\((at[^)]*)\)/g, '$1');
	// Remove orphaned "at" when the time value is absent.
	result = result.replace(/\bat\s+(?=[-,])/g, '');
	// Remove trailing " - " immediately before a comma when the range is absent.
	result = result.replace(/\s*-\s*,/g, ',');

	result = result.replace(/\(\s*\)/g, '');
	result = result.replace(/\s+([,)])/g, '$1');
	result = result.replace(/-\s*-\s*/g, '-');
	result = result.replace(/\s+/g, ' ').trim();
	result = result.replace(/-\s*$/, '').trim();
	result = result.replace(/,\s*$/, '').trim();

	// Strip an orphaned "By," left when a date-prefixed format has no date. This
	// runs AFTER the separator cleanups: before them the paren block still sits
	// between "By" and the comma, so the pattern could never match.
	result = result.replace(/^By\s*,\s*/i, '').trim();

	// Drop empty fields together with one adjacent separator, so an unset
	// {identity} collapses cleanly instead of leaving a leading "- ".
	result = result.replace(new RegExp(`\\s*-\\s*${SENTINEL_EMPTY}`, 'g'), '');
	result = result.replace(new RegExp(`${SENTINEL_EMPTY}\\s*-\\s*`, 'g'), '');
	result = result.replace(new RegExp(SENTINEL_EMPTY, 'g'), '');
	result = result.replace(/^\s*[-,]\s*/, '');

	// Drop any stray sentinel BEFORE restoring, so this can only ever clean up our
	// own scaffolding — never characters that came from the user's text.
	result = result.replace(new RegExp(`${SENTINEL_START}(?!\\d+${SENTINEL_END})`, 'g'), '');

	// Restore the user's text verbatim (a replacer function, so `$&` stays literal).
	result = result.replace(
		new RegExp(`${SENTINEL_START}(\\d+)${SENTINEL_END}`, 'g'),
		(_m, i: string) => values[Number(i)] ?? '',
	);

	result = result.replace(/\s+/g, ' ').trim();
	result = result.replace(/-\s*$/, '').trim();
	result = result.replace(/,\s*$/, '').trim();

	return result;
}

/** Return the configured name format for a given emoji (registry-driven). */
export function getTaskFormatByEmoji(emoji: string, settings: TaskFormatSettings): string {
	return settings[formatKeyFor(emoji)];
}

/** Validate a format template for duplicate placeholders. Empty string = valid. */
export function validateFormatTemplate(format: string): string {
	const regex = /\{(\w+)\}/g;
	const placeholders: string[] = [];
	const duplicates: string[] = [];

	let match: RegExpExecArray | null;
	while ((match = regex.exec(format)) !== null) {
		const placeholder = match[1];
		if (placeholders.includes(placeholder)) {
			if (!duplicates.includes(placeholder)) duplicates.push(placeholder);
		} else {
			placeholders.push(placeholder);
		}
	}

	if (duplicates.length > 0) {
		return `Duplicate placeholders found: {${duplicates.join('}, {')}}`;
	}
	return '';
}
