// Date-key ('YYYY-MM-DD') helpers and calendar-grid math.
// Uses the bundled moment instance (aliased in tests) — otherwise pure.

import { moment, type Moment } from '../lib/moment';
import { RANGE_DAY_SPAN, type TimelineRange } from '../constants';
import { MINUTES_PER_DAY } from './timestamps';

export type FirstDayOfWeek = 'locale' | 'monday' | 'sunday';

export function dateKey(m: Moment): string {
	return m.format('YYYY-MM-DD');
}

export function keyToMoment(key: string): Moment {
	return moment(key, 'YYYY-MM-DD', true);
}

export function todayKey(): string {
	return dateKey(moment());
}

/** Local (not UTC) day key for an epoch-millis timestamp. */
export function tsToLocalKey(ts: number): string {
	return dateKey(moment(ts));
}

export function addDays(key: string, n: number): string {
	return dateKey(keyToMoment(key).add(n, 'days'));
}

/** Whole-day difference `a - b` (positive when `a` is later). */
export function diffDays(a: string, b: string): number {
	return keyToMoment(a).diff(keyToMoment(b), 'days');
}

/** Local start-of-day epoch millis for a day key (DST-safe). */
export function dayStartTs(key: string): number {
	return keyToMoment(key).startOf('day').valueOf();
}

/**
 * Epoch millis for a WALL-CLOCK time on a day.
 *
 * `.add(n, 'minutes')` is an absolute duration, so this used to be
 * `midnight + n × 60000` — an hour wrong on both DST transition days, every
 * year, in opposite directions. `.add(days, 'days')` IS calendar-aware, and
 * setting the hour and minute afterwards asks for the clock reading rather than
 * the elapsed time.
 *
 * `timeOnDayTs(k, MINUTES_PER_DAY)` therefore equals `dayStartTs(addDays(k, 1))`
 * exactly, which is what callers use as the day's exclusive end.
 *
 * A clock time that does not exist (02:30 on a spring-forward day) normalises
 * forward; one that happens twice resolves to its first occurrence.
 */
export function timeOnDayTs(key: string, minutes: number): number {
	const days = Math.floor(minutes / MINUTES_PER_DAY);
	const rest = minutes - days * MINUTES_PER_DAY;
	return keyToMoment(key)
		.startOf('day')
		.add(days, 'days')
		.hour(Math.floor(rest / 60))
		.minute(rest % 60)
		.valueOf();
}

export function isSameMonth(key: string, anchorKey: string): boolean {
	return keyToMoment(key).isSame(keyToMoment(anchorKey), 'month');
}

/** Start-of-week moment honouring the first-day-of-week preference. */
export function weekStart(m: Moment, firstDay: FirstDayOfWeek): Moment {
	if (firstDay === 'locale') return m.clone().startOf('week');
	const dow = firstDay === 'monday' ? 1 : 0;
	const copy = m.clone().startOf('day');
	const diff = (copy.day() - dow + 7) % 7;
	return copy.subtract(diff, 'days');
}

/** The day keys shown for a time-grid range (day / 3days / week). */
export function timelineDays(anchorKey: string, range: 'day' | '3days' | 'week', firstDay: FirstDayOfWeek): string[] {
	const anchor = keyToMoment(anchorKey);
	if (range === 'week') {
		const start = weekStart(anchor, firstDay);
		return Array.from({ length: 7 }, (_, i) => dateKey(start.clone().add(i, 'days')));
	}
	const span = RANGE_DAY_SPAN[range];
	return Array.from({ length: span }, (_, i) => dateKey(anchor.clone().add(i, 'days')));
}

/** 42 day keys (6 weeks) covering the month that contains `anchorKey`. */
export function monthGridDays(anchorKey: string, firstDay: FirstDayOfWeek): string[] {
	const first = keyToMoment(anchorKey).startOf('month');
	const gridStart = weekStart(first, firstDay);
	return Array.from({ length: 42 }, (_, i) => dateKey(gridStart.clone().add(i, 'days')));
}

/** Month anchor keys for a 6-month or year overview. */
export function monthsInOverview(anchorKey: string, count: 6 | 12): string[] {
	const start = keyToMoment(anchorKey).startOf(count === 12 ? 'year' : 'month');
	return Array.from({ length: count }, (_, i) => dateKey(start.clone().add(i, 'months')));
}

/** Inclusive [from, to] day-key bounds visible for any timeline range. */
export function rangeBounds(anchorKey: string, range: TimelineRange, firstDay: FirstDayOfWeek): { from: string; to: string } {
	switch (range) {
		case 'day':
		case '3days':
		case 'week': {
			const days = timelineDays(anchorKey, range, firstDay);
			return { from: days[0], to: days[days.length - 1] };
		}
		case 'month': {
			const days = monthGridDays(anchorKey, firstDay);
			return { from: days[0], to: days[days.length - 1] };
		}
		case '6months':
		case 'year': {
			const count = range === 'year' ? 12 : 6;
			const months = monthsInOverview(anchorKey, count);
			const first = monthGridDays(months[0], firstDay);
			const last = monthGridDays(months[months.length - 1], firstDay);
			return { from: first[0], to: last[last.length - 1] };
		}
	}
}

function weekOffset(firstDay: FirstDayOfWeek): number {
	if (firstDay === 'monday') return 1;
	if (firstDay === 'sunday') return 0;
	return moment.localeData().firstDayOfWeek();
}

function rotate(labels: string[], offset: number): string[] {
	return labels.slice(offset).concat(labels.slice(0, offset));
}

/** Localised weekday short labels rotated to the first-day preference. */
export function weekdayShortLabels(firstDay: FirstDayOfWeek): string[] {
	return rotate(moment.weekdaysShort(), weekOffset(firstDay)); // Sunday-first source
}

/**
 * Localised minimal weekday labels ("Mo", "Tu", …). Uses moment's locale data
 * rather than slicing the first letter, which is ambiguous in many locales
 * (German would render M D M D F S S).
 */
export function weekdayMinLabels(firstDay: FirstDayOfWeek): string[] {
	return rotate(moment.weekdaysMin(), weekOffset(firstDay));
}

/**
 * A day header's label: the daily note's BASENAME, never its folders.
 *
 * The core Daily Notes format may legitimately contain `/` for sub-foldered
 * notes (`YYYY/MM-MMMM/YYYY-MM-DD`), which `pathFor` joins straight into the
 * path. Rendering it whole made every header read `2026/08-August/2026-08-11`,
 * ellipsised to nothing. Split the RENDERED string rather than the format: an
 * escaped `[/]` is a real path separator by the time normalizePath sees it.
 */
export function dayNoteLabel(key: string, format: string): string {
	const rendered = keyToMoment(key).format(format || 'YYYY-MM-DD');
	const slash = rendered.lastIndexOf('/');
	return slash < 0 ? rendered : rendered.slice(slash + 1);
}

/**
 * The narrow-column form — a localised weekday and day number ("Tu 11").
 *
 * A deliberate exception to "the header says exactly what its note is called".
 * In a 350px sidebar a week column is ~44px wide, where `2026-08-11` renders as
 * `2026-0…` — which is not the note's name either, it is nothing. The full name
 * stays in the tooltip.
 */
export function dayShortLabel(key: string): string {
	return keyToMoment(key).format('dd D');
}

/** Human month title, e.g. "July 2026". */
export function monthTitle(anchorKey: string): string {
	return keyToMoment(anchorKey).format('MMMM YYYY');
}
