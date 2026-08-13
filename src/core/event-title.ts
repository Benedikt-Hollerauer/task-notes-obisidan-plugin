// The tooltip that explains every state an event can be in. Pure.
//
// It was written three times — once for a block, once for an all-day chip, once
// for a month chip — and the copies had already drifted: one said "not in the
// day plan", another "Not in the day plan — click the badge to add it".

import type { TaskEvent } from '../types';

export interface TitleContext {
	/** Occurrences the user has ticked off locally (remote events only). */
	hiddenRemote: ReadonlySet<string>;
	/** Extra notes the caller knows and this module cannot (geometry, overlap). */
	extra?: (string | false | null | undefined)[];
	/** Chips can be dragged onto the grid to gain a time; blocks cannot. */
	draggableToGrid?: boolean;
}

/** One `·`-separated sentence naming the event and everything true about it. */
export function eventTitle(ev: TaskEvent, ctx: TitleContext): string {
	const parts: (string | false | null | undefined)[] = [ev.title, ...(ctx.extra ?? [])];

	if (ev.kind === 'remote') {
		parts.push(`Calendar: ${ev.calendarName}`);
		parts.push(ctx.hiddenRemote.has(ev.id) && 'Hidden here — untick to show it again');
	} else {
		parts.push(!ev.linked && 'Not in the day plan — click the badge to add it');
		parts.push(ev.duplicate && 'This note is linked from more than one day');
		parts.push(ev.checked && 'Completed');
		parts.push(ctx.draggableToGrid && 'Drag onto the grid to give it a time');
	}

	return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' · ');
}
