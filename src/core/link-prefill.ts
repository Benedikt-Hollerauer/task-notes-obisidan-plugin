// What the "add to the day plan" dialog starts from. Pure (no Obsidian imports).
//
// An unlinked 📅 note already knows almost everything — its name was parsed to
// produce the block you are looking at. So the dialog is a CONFIRMATION, not an
// interrogation: every field arrives filled, and you change the ones you want.
//
// THE BUG THIS REPLACES. Clicking the badge used to write immediately, and when
// the filename carried no time it silently invented `dayStartHour` (08:00) — then
// `syncFilenameOnReschedule` renamed the note to match, rewriting every wikilink
// to it across the vault. Four writes, none of them announced. Now the time it
// would use is shown before anything happens.

import type { LocalEvent, TaskProperties } from '../types';

/** `HH.MMh`, the filename grammar's time form. */
function dotHoursOf(minutes: number): string {
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${pad(Math.floor(minutes / 60))}.${pad(minutes % 60)}h`;
}

export interface LinkPrefill {
	/** Seeds the dialog's fields. */
	props: Partial<TaskProperties>;
	/** Minutes; seeds the Duration field. */
	durationMinutes: number;
	/**
	 * True when the note's own name carries no time, so the start below is a
	 * DEFAULT this dialog is proposing rather than something the note already
	 * said. The dialog says so out loud — silently inventing it is the bug.
	 */
	timeWasMissing: boolean;
}

/**
 * Seed values for linking `event` into its day.
 *
 * `parsed` is the note's own properties (already parsed from its filename by the
 * index), so the name fields round-trip unchanged unless you edit them.
 */
export function linkPrefill(
	event: Pick<LocalEvent, 'date' | 'startMinutes' | 'endMinutes'>,
	parsed: TaskProperties,
	defaults: { dayStartHour: number; defaultEventDurationMinutes: number },
): LinkPrefill {
	const timeWasMissing = event.startMinutes == null;
	const start = event.startMinutes ?? defaults.dayStartHour * 60;

	// endMinutes is synthesised by the index as start + the default, so it carries
	// no information the note itself had. Only trust a real, positive span.
	const span = event.endMinutes != null ? event.endMinutes - start : null;
	const durationMinutes = span != null && span > 0 ? span : defaults.defaultEventDurationMinutes;

	return {
		props: { ...parsed, startDate: event.date, time: dotHoursOf(start) },
		durationMinutes,
		timeWasMissing,
	};
}
