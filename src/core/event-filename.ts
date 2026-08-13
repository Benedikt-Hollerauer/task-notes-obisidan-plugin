// 📅 scheduled-event filename helpers built on the frozen task-name grammar.
// Pure (no Obsidian imports).

import type { TaskProperties } from '../types';
import { TASK_EMOJIS } from '../constants';
import { normalizeEmoji, extractTaskName, getNormalizedEmoji } from './emoji';
import { parseTaskProperties, generateTaskName } from './task-name';
import { minutesToDot, dotToMinutes } from './timestamps';

const SCHEDULED = normalizeEmoji(TASK_EMOJIS.SCHEDULED);

/** True if the basename is a scheduled (📅) event. */
export function isScheduledBasename(basename: string): boolean {
	return getNormalizedEmoji(basename) === SCHEDULED;
}

/**
 * Parse a 📅 basename into its properties (or a plain parse if not scheduled).
 * Pass the scheduled format so parsing and generation agree: without it a format
 * carrying named fields would be READ with the legacy grammar and WRITTEN with
 * the new one, which would rename files nobody asked to rename.
 */
export function parseEventBasename(basename: string, scheduledFormat?: string): TaskProperties {
	const name = extractTaskName(basename);
	const isEvent = isScheduledBasename(basename) || /^By\s+\d{4}-\d{2}-\d{2}/.test(name);
	return parseTaskProperties(name, isEvent, scheduledFormat);
}

/**
 * True when a 📅 basename ALREADY uses the scheduled grammar (`By <date>, …`).
 *
 * The emoji alone is not consent to be renamed. A note called
 * `📅 Attend - 1h - monthly planning at Logisitsy - First mon at 08.00h ✍️` is a
 * perfectly good event note that simply doesn't use the date grammar, and the
 * plugin must never impose it: reconcile would rewrite the name, and Obsidian
 * would then rewrite every link to it — including ones inside a template.
 */
export function hasScheduledDatePart(basename: string, scheduledFormat?: string): boolean {
	return parseEventBasename(basename, scheduledFormat).startDate != null;
}

/** Start minutes encoded in a 📅 filename, or null. */
export function filenameStartMinutes(basename: string, scheduledFormat?: string): number | null {
	const props = parseEventBasename(basename, scheduledFormat);
	return props.time ? dotToMinutes(props.time) : null;
}

/**
 * The canonical basename (emoji + name, no extension) a linked 📅 event should have,
 * given the daily note's date and the planner line's start time. The filename never
 * carries an end time — only the start — so end/duration lives solely on the line.
 * `activePrefix` ('' or '🅰️ ') preserves the active marker across renames.
 */
export function expectedEventBasename(
	props: TaskProperties,
	dailyDate: string,
	startMinutes: number | null,
	scheduledFormat: string,
	activePrefix = '',
): string {
	const time = startMinutes != null ? minutesToDot(startMinutes) : props.time;
	const nextProps: TaskProperties = {
		...props,
		startDate: dailyDate,
		time,
	};
	const name = generateTaskName(nextProps, scheduledFormat);
	return `${activePrefix}${SCHEDULED} ${name}`.replace(/\s+/g, ' ').trim();
}


/** What a rename of a 📅 note should do to its planner line's time. */
export type RenameTimeIntent =
	/** Write this start onto the line. */
	| { action: 'set'; minutes: number }
	/** The name lost its time: make the line untimed (all-day). */
	| { action: 'clear' }
	/** Nothing to mirror. */
	| { action: 'none' };

/**
 * Read a rename as an instruction about the planner line's time.
 *
 * The OLD name is what makes "clear" expressible. Without it, a name with no
 * time is indistinguishable from a name that never had one — so deleting
 * `at 08.00h` did nothing to the line, reconcile then rebuilt the name FROM that
 * line, and the time you had just deleted reappeared a second later. There was
 * no way to say "this has no time any more" by editing the name.
 *
 * The reverse case must stay `none`: a note that never carried a time sitting on
 * a line the user deliberately dragged into the all-day lane has nothing to
 * mirror, and clearing there would undo the drop.
 */
export function renameTimeIntent(
	oldBasename: string,
	newBasename: string,
	scheduledFormat: string,
): RenameTimeIntent {
	const next = filenameStartMinutes(newBasename, scheduledFormat);
	if (next != null) return { action: 'set', minutes: next };
	const before = filenameStartMinutes(oldBasename, scheduledFormat);
	return before != null ? { action: 'clear' } : { action: 'none' };
}
