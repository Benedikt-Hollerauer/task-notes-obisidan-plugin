// "Is this happening right now?" Pure (no Obsidian imports, no hidden clock).
//
// The grid drew a red needle at the current time and nothing else, so the one
// block you actually care about — the one you are in — looked like every other
// block on the day.

/** Minutes since midnight for a timestamp, in LOCAL time (the grid's time). */
export function minutesOfDay(ts: number): number {
	const d = new Date(ts);
	return d.getHours() * 60 + d.getMinutes();
}

/**
 * True when `now` falls inside a block drawn on `dayKey`.
 *
 * `now` is passed in rather than read here, so a test can put the clock
 * anywhere and the answer never depends on when the suite runs.
 *
 * The end is exclusive: at exactly 10:00 the 09:00–10:00 block is over and the
 * 10:00–11:00 one has started, so two adjacent blocks are never both current.
 */
export function isHappeningNow(
	block: { startMin: number; endMin: number },
	dayKey: string,
	todayKey: string,
	nowMinutes: number,
): boolean {
	if (dayKey !== todayKey) return false;
	return nowMinutes >= block.startMin && nowMinutes < block.endMin;
}
