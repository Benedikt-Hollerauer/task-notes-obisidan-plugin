// Which hours the time grid draws. Pure (no Obsidian imports).
//
// A day is 24 hours, but most people only ever plan inside a slice of it, and a
// grid that devotes half its height to 00:00–07:00 wastes the space the actual
// day needs. The window narrows what is drawn — WITHOUT ever hiding anything:
// if a day on screen holds something outside the window, the window stretches to
// contain it. Something you scheduled must never be undrawable.

import { MINUTES_PER_DAY } from './timestamps';

export interface WindowSettings {
	/** First hour the grid draws (0–23). */
	visibleStartHour: number;
	/** Last hour the grid draws (1–24). */
	visibleEndHour: number;
}

export interface DayWindow {
	/** First minute drawn. */
	startMin: number;
	/** Last minute drawn (exclusive). */
	endMin: number;
}

/** An interval that has to stay visible. */
export interface Occupied {
	startMin: number;
	endMin: number;
}

const HOUR = 60;

/** The configured window, clamped and never inverted. */
export function configuredWindow(settings: WindowSettings): DayWindow {
	const rawStart = clampHour(settings.visibleStartHour, 0, 23);
	const rawEnd = clampHour(settings.visibleEndHour, 1, 24);
	// A window the user has inverted (end before start) shows the whole day rather
	// than nothing: an empty grid would look like the plugin had broken.
	if (rawEnd <= rawStart) return { startMin: 0, endMin: MINUTES_PER_DAY };
	return { startMin: rawStart * HOUR, endMin: rawEnd * HOUR };
}

function clampHour(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * The window to draw: the configured one, widened to contain everything on the
 * days currently on screen, and snapped out to whole hours so the ruler is
 * always labelled at the top and bottom.
 */
export function dayWindow(occupied: Iterable<Occupied>, settings: WindowSettings): DayWindow {
	const base = configuredWindow(settings);
	let { startMin, endMin } = base;

	for (const item of occupied) {
		if (item.startMin < startMin) startMin = Math.floor(item.startMin / HOUR) * HOUR;
		if (item.endMin > endMin) endMin = Math.ceil(item.endMin / HOUR) * HOUR;
	}

	return {
		startMin: Math.max(0, startMin),
		endMin: Math.min(MINUTES_PER_DAY, Math.max(endMin, startMin + HOUR)),
	};
}

/** The hours to label, one per ruler cell. */
export function windowHours(win: DayWindow): number[] {
	const first = Math.floor(win.startMin / HOUR);
	const count = Math.ceil((win.endMin - win.startMin) / HOUR);
	return Array.from({ length: count }, (_, i) => first + i);
}

/**
 * Place a block of `duration` minutes at `start` inside `win`, keeping its
 * LENGTH: a drop near the bottom slides the block up rather than shortening it.
 *
 * Clamping the end alone is what wrote a 15-minute event — and renamed the file
 * to match — when a one-hour chip was dropped near the end of the day. Only a
 * block longer than the whole drawn window is shortened, and then to exactly it.
 */
export function fitBlockInWindow(
	win: DayWindow,
	start: number,
	duration: number,
): { start: number; end: number } {
	const span = Math.max(1, Math.min(Math.round(duration), win.endMin - win.startMin));
	const from = Math.min(Math.max(Math.round(start), win.startMin), win.endMin - span);
	return { start: from, end: from + span };
}
