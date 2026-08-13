// Pure helpers for the frozen emoji-filename convention. No Obsidian imports —
// fully unit-testable. Behaviour-preserving port from the original monolithic
// main.ts so existing filenames keep round-tripping identically, extended with
// active-marker (🅰️) tolerance.

import {
	EMOJI_REGISTRY,
	ACTIVE_MARKER,
	TASK_EMOJI_REGEX,
	ENTITY_EMOJI_STRIP_REGEX,
} from '../constants';

/** All recognised emoji prefixes, in registry order. */
const ALL_EMOJIS: readonly string[] = EMOJI_REGISTRY.map((s) => s.emoji);

/**
 * Invisible format characters (category Cf: zero-width space, BOM, word joiner,
 * soft hyphen, …) EXCEPT the zero-width joiner — stripping ZWJ would mangle
 * ZWJ emoji sequences (🏳️‍🌈, 👨‍👩‍👧) entered via the custom-emoji dialog.
 * Variation selectors are category Mn and are intentionally untouched here.
 */
const INVISIBLES = /(?!\u200D)\p{Cf}/gu;

/** Strip invisible format characters (keeps ZWJ and variation selectors). */
export function normalizeEmoji(emoji: string): string {
	return emoji.replace(INVISIBLES, '');
}

/** Strip Unicode variation selectors (U+FE00–U+FE0F). */
function stripVariationSelectors(s: string): string {
	return s.replace(/[\uFE00-\uFE0F]/g, '');
}

/**
 * Split an optional leading active marker (`🅰️ `) off a basename.
 * `rest` is the basename without the marker; `active` records its presence.
 *
 * THERE IS NO ACTIVE-TASK FEATURE. It was removed in v3.9 — a ring with no
 * workflow behind it, for a concept the user's system does not have. What
 * remains is BACKWARD-COMPATIBILITY SAFETY, and it has to remain: a file
 * already named `🅰️ 📅 …` must still parse as a 📅 note (every other function
 * here reads `rest`, not the raw basename), and every rename must put the prefix
 * back (`activePrefixOf`, used by the sync engine, the properties panel and the
 * status changer). Delete these and the plugin silently renames such a file to
 * one without its prefix, which is a write the user never asked for.
 */
export function splitActiveMarker(basename: string): { active: boolean; rest: string } {
	for (const form of [ACTIVE_MARKER, stripVariationSelectors(ACTIVE_MARKER)]) {
		if (basename.startsWith(form + ' ')) {
			return { active: true, rest: basename.slice(form.length + 1).replace(/^\s+/, '') };
		}
	}
	return { active: false, rest: basename };
}

/** True if the basename carries the active marker prefix. */
export function hasActiveMarker(basename: string): boolean {
	return splitActiveMarker(basename).active;
}

/** The rename prefix that preserves a basename's active marker ('' or '🅰️ '). */
export function activePrefixOf(basename: string): string {
	return hasActiveMarker(basename) ? `${ACTIVE_MARKER} ` : '';
}

/**
 * Assemble a task note's basename: `[🅰️ ]<emoji> <name>`, normalised and squeezed.
 *
 * THE ONE PLACE THIS IS SPELLED OUT. It used to be written inline at four call
 * sites, and they disagreed: `changeStatus` and the properties panel passed
 * `activePrefixOf(...)`, while `convert` and `createTaskNote` did not. So a note
 * called `🅰️ 📅 By 2026-08-20, …` kept its marker through a status change and
 * lost it through "Link into day plan" — an unrequested rename that also rewrote
 * every wikilink pointing at it. The comment above says every rename must put the
 * prefix back; making it a PARAMETER is what lets the compiler care.
 *
 * `prefix` is explicit rather than derived here because two callers legitimately
 * have no previous name to derive it from: `createTaskNote` is making a file that
 * does not exist yet.
 */
export function taskBasename(emoji: string, name: string, prefix = ''): string {
	return `${prefix}${normalizeEmoji(emoji)} ${cleanupTaskName(name)}`.replace(/\s+/g, ' ').trim();
}

/**
 * Extract the recognised emoji prefix from a filename, or null. An active
 * marker before the emoji is tolerated. Matches the canonical form, the
 * invisible-stripped form, and the variation-selector-stripped form — so both
 * `◻️ name` and the bare `◻ name` are detected. Always returns the canonical
 * constant (e.g. `◻️`) so downstream naming stays stable.
 */
export function extractTaskEmoji(filename: string): string | null {
	const { rest } = splitActiveMarker(filename);
	for (const emoji of ALL_EMOJIS) {
		const normalized = normalizeEmoji(emoji);
		const bare = stripVariationSelectors(emoji);
		if (
			rest.startsWith(emoji + ' ') ||
			rest.startsWith(normalized + ' ') ||
			rest.startsWith(bare + ' ')
		) {
			return emoji;
		}
	}
	return null;
}

/**
 * Extract the task name: filename minus the (optional) active marker, the
 * emoji prefix, and stray invisibles.
 */
export function extractTaskName(filename: string): string {
	const { rest } = splitActiveMarker(filename);
	const emoji = extractTaskEmoji(rest);
	if (!emoji) return rest;

	let taskName = rest.replace(TASK_EMOJI_REGEX, '');
	// Remove leading invisible characters and spaces.
	taskName = taskName.replace(/^[\p{Cf}\s]+/u, '').trim();
	// Strip any additional emoji that may have been accidentally prepended.
	taskName = taskName.replace(ENTITY_EMOJI_STRIP_REGEX, '');
	return taskName.trim();
}

/** True if the filename starts with a recognised emoji prefix (marker tolerated). */
export function hasTaskEmoji(filename: string): boolean {
	return TASK_EMOJI_REGEX.test(filename);
}

/** Remove embedded invisible characters (keeps regular spaces). */
export function cleanupTaskName(taskName: string): string {
	return taskName.replace(INVISIBLES, '').trim();
}

/** Extract and normalize the emoji from a filename in one step (empty string if none). */
export function getNormalizedEmoji(filename: string): string {
	return normalizeEmoji(extractTaskEmoji(filename) || '');
}

/**
 * Should converting `filename` to `newEmoji` also apply that type's template?
 *
 * THE BUG THIS EXISTS FOR. `TaskFileService.convert` is the "rename this file to
 * these properties" routine, and it applied the template on every call while the
 * setting was on. But it is reached two ways: converting a PLAIN note into a task
 * (where a template is the whole point), and the ➕ "add to the day plan" flow,
 * which renames a note that is ALREADY a 📅 note. `applyTemplate(…, forceApply)`
 * APPENDS to a non-empty file, so the second route pasted the template into the
 * note a second time — reported as "the template for it applied 2 times" after
 * converting a calendar event and then adding it to the day.
 *
 * The rule is the one `convert`'s own doc comment always claimed: a template
 * belongs to becoming a NEW type. Already being that type is a rename.
 */
export function shouldApplyConvertTemplate(
	filename: string,
	newEmoji: string,
	settingEnabled: boolean,
): boolean {
	if (!settingEnabled) return false;
	// No task emoji at all — a genuinely plain note becoming a task.
	if (!hasTaskEmoji(filename)) return true;
	// Otherwise only when the type actually changes.
	//
	// Variation selectors stripped on BOTH sides as well as invisibles: `◻️`
	// carries U+FE0F in the registry and `📅` does not, and a filename may have
	// been written either way by an older version or by hand. Comparing them raw
	// reads as a type change and pastes the template again — the same bug back
	// through a Unicode side door.
	const same = (e: string): string => stripVariationSelectors(normalizeEmoji(e));
	return same(getNormalizedEmoji(filename)) !== same(newEmoji);
}
