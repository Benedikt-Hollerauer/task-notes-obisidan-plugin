// Whether a 📅 note's "not in the day plan yet" ghost should be drawn. Pure.
//
// THE BUG THIS EXISTS FOR. The rule used to be "is this file referenced by any
// daily note at all?", which is date-blind. A note named for 2026-08-25 that was
// linked from the 2026-07-24 daily note therefore had its ghost suppressed on
// August 25 — while its only block was built on July 24, because a linked event
// takes `date` from the PLAN. Net effect: the note appeared on a day it does not
// belong to, and nothing at all appeared on the day it names. It looked, exactly,
// like the timeline had lost the note.
//
// A reference means "I planned this note into THAT day". That is a real thing to
// draw on that day, and it says nothing about the note's own date — so it must
// not silence the note on its own date.

/**
 * True when the ghost on `fileDate` should be suppressed.
 *
 * Suppress only when some daily note references this file **on the file's own
 * date** — that is the case where a ghost would sit on top of the very block the
 * reference already draws.
 *
 * `fileDate` is null for a 📅 note whose name carries no parseable date; such a
 * note has no day to be a ghost on, and the caller drops it before reaching here.
 */
export function suppressGhost(fileDate: string, referencedDates: Iterable<string>): boolean {
	for (const date of referencedDates) {
		if (date === fileDate) return true;
	}
	return false;
}
