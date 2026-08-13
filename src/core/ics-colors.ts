// Which colour a remote calendar is drawn in. Pure (no Obsidian imports).
//
// Split out of the service so the SETTINGS can show the colour a calendar is
// actually using. A blank colour used to be auto-assigned deep inside the fetch
// loop, which meant the swatch the user saw was empty while the grid was
// already drawing that calendar in orange.

import { DEFAULT_EVENT_COLOR } from '../constants';

/** The palette a calendar falls back to, in assignment order. */
export const DEFAULT_COLORS = [
	DEFAULT_EVENT_COLOR,
	'#f58518',
	'#54a24b',
	'#e45756',
	'#72b7b2',
	'#b279a2',
] as const;

/**
 * The colour assigned to the calendar at `index` when the user has not picked
 * one. Indexed against the FULL settings list, so disabling one calendar never
 * recolours the others.
 */
export function autoCalendarColor(index: number): string {
	const i = Number.isInteger(index) && index >= 0 ? index : 0;
	return DEFAULT_COLORS[i % DEFAULT_COLORS.length];
}

/**
 * The colour a calendar is drawn in: the user's choice if they made one, else
 * its automatic slot. Never written back into settings — the plugin does not
 * change your configuration to record a decision you did not make.
 */
export function calendarColor(chosen: string | undefined, index: number): string {
	const trimmed = chosen?.trim();
	return trimmed ? trimmed : autoCalendarColor(index);
}
