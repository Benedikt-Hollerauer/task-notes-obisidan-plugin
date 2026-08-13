// Pure time conversions between the three representations used by the plugin:
//   • filename time  "HH.MMh"  (e.g. "14.30h")
//   • planner time   "HH:MM"   (e.g. "14:30")
//   • minutes since midnight   (e.g. 870)

export const MINUTES_PER_DAY = 24 * 60;

/** Parse "HH:MM" (or "H:MM") into minutes since midnight, or null. */
export function colonToMinutes(value: string): number | null {
	const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
	if (!m) return null;
	return toMinutes(Number(m[1]), Number(m[2]));
}

/** Parse "HH.MMh" (filename form) into minutes since midnight, or null. */
export function dotToMinutes(value: string): number | null {
	const m = value.trim().match(/^(\d{1,2})\.(\d{2})h?$/);
	if (!m) return null;
	return toMinutes(Number(m[1]), Number(m[2]));
}

function toMinutes(h: number, m: number): number | null {
	if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
	if (h < 0 || h > 23 || m < 0 || m > 59) return null;
	return h * 60 + m;
}

/** Minutes since midnight → "HH:MM" (planner form). */
export function minutesToColon(minutes: number): string {
	const { h, m } = split(minutes);
	return `${pad(h)}:${pad(m)}`;
}

/** Minutes since midnight → "HH.MMh" (filename form). */
export function minutesToDot(minutes: number): string {
	const { h, m } = split(minutes);
	return `${pad(h)}.${pad(m)}h`;
}

function split(minutes: number): { h: number; m: number } {
	const rounded = Math.round(minutes);
	// MIDNIGHT IS 00:00, NOT 23:59. The day window's `endMin` is exactly 1440, so a
	// block dragged to the bottom of the day was written one minute short — and the
	// redraw made that short end the next drag's origin, so every drag shaved
	// another minute off: 23:59, then 23:58, then 23:57.
	//
	// End-of-day already has a representation the parser round-trips: `- [ ] 23:00
	// - 00:00` reads back as end 0. Wrapping 1440 to it makes what is DRAWN and what
	// is WRITTEN the same value, which is what stops the ratchet. Clamping still
	// catches anything genuinely out of range.
	const wrapped = rounded === MINUTES_PER_DAY ? 0 : rounded;
	const clamped = clamp(wrapped, 0, MINUTES_PER_DAY - 1);
	return { h: Math.floor(clamped / 60), m: clamped % 60 };
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/** Round to the nearest `step` minutes. */
export function snap(minutes: number, step: number): number {
	if (step <= 0) return Math.round(minutes);
	return Math.round(minutes / step) * step;
}
