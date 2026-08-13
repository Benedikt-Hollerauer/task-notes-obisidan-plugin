// Where a dragged chip lands, and what counts as a click. Pure (no Obsidian).
//
// A multi-day event is rendered once per day it spans, so "the day the chip was
// grabbed on" is NOT the event's start date. Moving must therefore be RELATIVE:
// grabbing the third day of a conference and dropping it one column right moves
// the whole event by one day, rather than teleporting its start to the drop day.

import { addDays, diffDays } from './date-key';

/** The event's new start date after a chip grabbed on `originDay` is dropped on `targetDay`. */
export function chipDropDate(eventDate: string, originDay: string, targetDay: string): string {
	return addDays(eventDate, diffDays(targetDay, originDay));
}

/** Pointer travel below this is a click, not a drag — for a MOUSE. */
export const CLICK_SLOP_PX = 4;

/**
 * The same threshold for a finger.
 *
 * 4px is a mouse number. A finger routinely travels 5–10px during what the user
 * experienced as a tap — the contact patch shifts as it lifts — so on a phone
 * every other tap on a chip was read as a drag and silently rescheduled nothing
 * (or, worse, something).
 */
export const TOUCH_SLOP_PX = 12;

export interface Point {
	x: number;
	y: number;
}

/** How far this kind of pointer may travel and still count as a click. */
export function slopFor(pointerType: string | undefined): number {
	return pointerType === 'touch' || pointerType === 'pen' ? TOUCH_SLOP_PX : CLICK_SLOP_PX;
}

/**
 * True when the pointer barely moved — the gesture was a click.
 *
 * `pointerType` comes straight from the PointerEvent; omitting it keeps the
 * mouse threshold, so every existing caller behaves exactly as before.
 */
export function isClickGesture(from: Point, to: Point, pointerType?: string): boolean {
	const slop = slopFor(pointerType);
	return Math.abs(to.x - from.x) <= slop && Math.abs(to.y - from.y) <= slop;
}
