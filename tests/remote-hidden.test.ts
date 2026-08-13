import { describe, it, expect } from 'vitest';
import {
	normalizeHidden,
	flattenHidden,
	toggleHidden,
	pruneHidden,
	occurrenceStart,
} from '../src/core/remote-hidden';
import { expandIcs, ICS_WINDOW_BACK_DAYS } from '../src/core/ics-expand';

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-12T12:00:00Z');
const LIVE = new Set(['cal-a', 'cal-b']);

describe('normalizeHidden — data.json is not to be trusted', () => {
	it('accepts nothing at all', () => {
		expect(normalizeHidden(undefined)).toEqual({});
		expect(normalizeHidden(null)).toEqual({});
		expect(normalizeHidden([])).toEqual({});
		expect(normalizeHidden('nope')).toEqual({});
	});

	it('drops junk without throwing, and keeps what is usable', () => {
		expect(normalizeHidden({ 'cal-a': 'not-an-array' })).toEqual({});
		expect(normalizeHidden({ 'cal-a': [1, null, 'keep', ''] })).toEqual({ 'cal-a': ['keep'] });
		expect(normalizeHidden({ 'cal-a': [] })).toEqual({});
	});

	it('de-duplicates', () => {
		expect(normalizeHidden({ 'cal-a': ['x', 'x', 'y'] })).toEqual({ 'cal-a': ['x', 'y'] });
	});
});

describe('flattenHidden', () => {
	it('is the flat membership set the views filter against', () => {
		expect(flattenHidden({ 'cal-a': ['x', 'y'], 'cal-b': ['z'] })).toEqual(new Set(['x', 'y', 'z']));
		expect(flattenHidden({})).toEqual(new Set());
	});
});

describe('toggleHidden', () => {
	it('hides and shows one occurrence', () => {
		const first = toggleHidden({}, 'cal-a', 'cal-a::uid::1', true);
		expect(first.changed).toBe(true);
		expect(first.map).toEqual({ 'cal-a': ['cal-a::uid::1'] });

		const back = toggleHidden(first.map, 'cal-a', 'cal-a::uid::1', false);
		expect(back.changed).toBe(true);
		expect(back.map).toEqual({});
	});

	it('THE WRITE GUARD: a second identical toggle changes nothing', () => {
		// Without this, an idempotent click would rewrite data.json every time.
		const once = toggleHidden({}, 'cal-a', 'x', true);
		const twice = toggleHidden(once.map, 'cal-a', 'x', true);
		expect(twice.changed).toBe(false);
		expect(twice.map).toBe(once.map);
		expect(toggleHidden({}, 'cal-a', 'x', false).changed).toBe(false);
	});

	it('never mutates the map it was given', () => {
		const before = { 'cal-a': ['x'] };
		toggleHidden(before, 'cal-a', 'y', true);
		expect(before).toEqual({ 'cal-a': ['x'] });
	});

	it('deletes an emptied bucket rather than leaving []', () => {
		const map = { 'cal-a': ['x'], 'cal-b': ['y'] };
		expect(toggleHidden(map, 'cal-a', 'x', false).map).toEqual({ 'cal-b': ['y'] });
	});
});

describe('pruneHidden — forget only what can never match again', () => {
	const recent = `cal-a::uid::${NOW - DAY}`;
	const ancient = `cal-a::uid::${NOW - (ICS_WINDOW_BACK_DAYS + 1) * DAY}`;
	const future = `cal-a::uid::${NOW + 30 * DAY}`;

	it('drops a calendar that is gone from settings', () => {
		const out = pruneHidden({ 'cal-gone': ['x'], 'cal-a': [recent] }, LIVE, NOW);
		expect(out.changed).toBe(true);
		expect(out.map).toEqual({ 'cal-a': [recent] });
	});

	it('KEEPS a calendar that is merely disabled', () => {
		// The live set is built from the FULL calendar list, exactly like the ICS
		// cache prune — switching a calendar off must not forget your marks.
		expect(pruneHidden({ 'cal-b': [`cal-b::u::${NOW}`] }, LIVE, NOW).changed).toBe(false);
	});

	it('drops an occurrence older than the expansion window can reach', () => {
		const out = pruneHidden({ 'cal-a': [ancient, recent] }, LIVE, NOW);
		expect(out.map).toEqual({ 'cal-a': [recent] });
		expect(out.changed).toBe(true);
	});

	it('keeps the boundary and everything ahead of it', () => {
		const boundary = `cal-a::uid::${NOW - ICS_WINDOW_BACK_DAYS * DAY}`;
		expect(pruneHidden({ 'cal-a': [boundary, future] }, LIVE, NOW).changed).toBe(false);
	});

	it('keeps an id whose trailing segment is not a timestamp', () => {
		// A prune must never quietly eat data it does not understand.
		expect(pruneHidden({ 'cal-a': ['cal-a::uid::not-a-time'] }, LIVE, NOW).changed).toBe(false);
		expect(pruneHidden({ 'cal-a': ['no-separators-at-all'] }, LIVE, NOW).changed).toBe(false);
	});

	it('survives a UID that itself contains ::', () => {
		const id = `cal-a::weird::uid::${NOW}`;
		expect(occurrenceStart(id)).toBe(NOW);
		expect(pruneHidden({ 'cal-a': [id] }, LIVE, NOW).changed).toBe(false);
	});

	it('returns the same object when nothing changed', () => {
		const map = { 'cal-a': [recent] };
		expect(pruneHidden(map, LIVE, NOW).map).toBe(map);
	});
});

describe('the prune is bound to the ids expansion actually produces', () => {
	// The one test tying the two together: if either the id format or the window
	// changes, this fails rather than silently forgetting somebody's marks.
	const ICS = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//test//EN',
		'BEGIN:VEVENT',
		'UID:standup@example.com',
		'SUMMARY:Standup',
		'DTSTART:20260812T090000Z',
		'DTEND:20260812T093000Z',
		'END:VEVENT',
		'END:VCALENDAR',
	].join('\n');

	const [event] = expandIcs(ICS, { id: 'cal-a', name: 'A' }, '#fff', NOW);

	it('keeps a mark on an occurrence that is still in the window', () => {
		expect(pruneHidden({ 'cal-a': [event.id] }, LIVE, NOW).changed).toBe(false);
	});

	it('forgets it once expansion can no longer reach that far back', () => {
		const later = NOW + (ICS_WINDOW_BACK_DAYS + 1) * DAY;
		expect(pruneHidden({ 'cal-a': [event.id] }, LIVE, later).map).toEqual({});
	});
});
