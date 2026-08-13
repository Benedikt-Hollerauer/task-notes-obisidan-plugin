// Whether an event belongs on screen right now. Pure (no Obsidian imports).
//
// "Done" means two different things depending on where an event comes from: a
// local one carries a ticked checkbox in your note, a remote one can't be
// written to at all, so its tick is a local mark. One predicate, so the two
// can never drift apart — and so `showCompleted` governs both.

import type { TaskEvent } from '../types';

/** True when the user has ticked this event off, whatever kind it is. */
export function isEventDone(ev: TaskEvent, hiddenRemote: ReadonlySet<string>): boolean {
	return ev.kind === 'local' ? ev.checked : hiddenRemote.has(ev.id);
}

/** True when the event should be drawn, given the show-completed setting. */
export function isEventVisible(
	ev: TaskEvent,
	showCompleted: boolean,
	hiddenRemote: ReadonlySet<string>,
): boolean {
	return showCompleted || !isEventDone(ev, hiddenRemote);
}
