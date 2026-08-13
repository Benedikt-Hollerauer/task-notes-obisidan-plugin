// THE FROZEN GRID: a title saying "Tuesday, August 11" over a header saying
// "2026-08-10", with the right day's blocks drawn underneath it.
//
// The mechanism: a keyed `{#each}` item is immutable in compiled Svelte — it can
// only change by destroy-and-recreate — and when anything throws mid-update,
// Svelte marks the effect clean BEFORE running it, so that subtree is never
// retried. One exception freezes that DOM permanently, and with no error
// boundary anywhere, silently. The likeliest thrower was `each_key_duplicate`:
// timed blocks keyed on the bare event id while all-day items already carried a
// composed key, so two blocks sharing an id — an index hiccup, an ICS feed
// emitting one UID twice — threw in production.
//
// The key is now unique by construction, which is what this file pins.

import { describe, it, expect } from 'vitest';
import { dayBlocks } from '../src/ui/views/svelte/layout';
import type { LocalEvent, RemoteEvent } from '../src/types';

const SLOT = { dayStartHour: 8, defaultEventDurationMinutes: 60 };
const DAY = '2026-08-11';

const timed = (id: string, start: number): LocalEvent => ({
	kind: 'local',
	id,
	title: `block ${id}`,
	date: DAY,
	startMinutes: start,
	endMinutes: start + 60,
	checked: false,
	linked: true,
});

const untimed = (id: string): LocalEvent => ({
	kind: 'local',
	id,
	title: `chip ${id}`,
	date: DAY,
	startMinutes: null,
	endMinutes: null,
	checked: false,
	linked: true,
});

describe('block keys — a duplicate id must not be able to freeze the grid', () => {
	it('THE BUG: two blocks with the SAME id still get distinct keys', () => {
		// Keyed on `id`, this threw each_key_duplicate and froze the column.
		const { timed: blocks } = dayBlocks(DAY, [timed('dup', 600), timed('dup', 780)], SLOT);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.key).not.toBe(blocks[1]?.key);
	});

	it('keeps the domain id intact while display lookups use the unique key', () => {
		// Persistence/reminders still identify the occurrence by its domain id;
		// layout and interaction state use the key so duplicates cannot alias.
		const { timed: blocks } = dayBlocks(DAY, [timed('dup', 600), timed('dup', 780)], SLOT);
		expect(blocks.map((b) => b.id)).toEqual(['dup', 'dup']);
	});

	it('lays duplicate ids into separate overlap columns', () => {
		const day = dayBlocks(DAY, [timed('dup', 600), timed('dup', 600)], SLOT);
		expect(day.overlapping).toEqual(new Set(day.timed.map((block) => block.key)));
		expect(day.timed.map((block) => block.left)).toEqual([0, 0.5]);
		expect(day.timed.map((block) => block.width)).toEqual([0.5, 0.5]);
	});

	it('separates the same event drawn on two different days', () => {
		const spanning: LocalEvent = { ...timed('span', 600), endDate: '2026-08-12' };
		const first = dayBlocks('2026-08-11', [spanning], SLOT).timed[0];
		const second = dayBlocks('2026-08-12', [spanning], SLOT).timed[0];
		expect(first?.key).not.toBe(second?.key);
		expect(first?.id).toBe(second?.id);
	});

	it('keys are unique across a realistic day, timed and all-day alike', () => {
		const events: (LocalEvent | RemoteEvent)[] = [
			timed('a', 540),
			timed('b', 540), // overlapping, same start
			timed('a', 600), // a duplicate id, the case that threw
			untimed('c'),
			untimed('c'), // and a duplicate in the lane
		];
		const day = dayBlocks(DAY, events, SLOT);
		const keys = [...day.timed.map((b) => b.key), ...day.allDay.map((i) => i.key)];
		expect(keys).toHaveLength(5);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('is stable across identical renders — a changing key would rebuild the DOM', () => {
		// Uniqueness is worthless if it comes from a counter that moves: the whole
		// column would be destroyed and recreated on every tick, losing focus,
		// scroll and any open editor inside a block.
		const events = [timed('a', 540), timed('a', 600), untimed('c')];
		const first = dayBlocks(DAY, events, SLOT);
		const second = dayBlocks(DAY, events, SLOT);
		expect(second.timed.map((b) => b.key)).toEqual(first.timed.map((b) => b.key));
		expect(second.allDay.map((i) => i.key)).toEqual(first.allDay.map((i) => i.key));
	});
});
