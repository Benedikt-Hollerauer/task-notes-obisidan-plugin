// THE BUG: an event with a time drawn as an all-day chip.
//
// `dayBlocks` sorted on "does it have an end date" before it ever looked at the
// start time, so any multi-day event was shunted into the all-day lane however
// precisely it had been scheduled. The user reported it as "its in all day view
// but its not shown at its appropriate time".

import { describe, it, expect } from 'vitest';
import { spanSlot } from '../src/core/event-slot';
import { dayBlocks } from '../src/ui/views/svelte/layout';
import { MINUTES_PER_DAY } from '../src/core/timestamps';
import type { LocalEvent, RemoteEvent } from '../src/types';

const SLOT = { dayStartHour: 8, defaultEventDurationMinutes: 60 };

const localMidnight = (day: string) => new Date(`${day}T00:00:00`).getTime();

/** The real vault file, and the planner line that claims it. */
const CONFERENCE: LocalEvent = {
	kind: 'local',
	id: 'conference',
	title: '📅 By 2026-07-28 at 20.00h - 2026-07-29, attend - 1 - conference',
	date: '2026-07-28',
	endDate: '2026-07-29',
	startMinutes: 20 * 60,
	endMinutes: 21 * 60,
	checked: false,
	linked: true,
};

describe('THE BUG: a multi-day event keeps its time', () => {
	it('draws the real vault conference at 20:00, not as a chip', () => {
		const day = dayBlocks('2026-07-28', [CONFERENCE], SLOT);
		expect(day.allDay).toHaveLength(0);
		expect(day.timed).toHaveLength(1);
		expect(day.timed[0].startMin).toBe(20 * 60);
	});

	it('runs it to midnight on the first day and fills the second', () => {
		const first = dayBlocks('2026-07-28', [CONFERENCE], SLOT).timed[0];
		expect(first.endMin).toBe(MINUTES_PER_DAY);
		expect(first.continuesBefore).toBe(false);
		expect(first.continuesAfter).toBe(true);

		const second = dayBlocks('2026-07-29', [CONFERENCE], SLOT).timed[0];
		expect([second.startMin, second.endMin]).toEqual([0, MINUTES_PER_DAY]);
		expect(second.continuesBefore).toBe(true);
		expect(second.continuesAfter).toBe(false);
	});

	it('fills every day in between', () => {
		const long = { ...CONFERENCE, endDate: '2026-07-31' };
		const middle = dayBlocks('2026-07-30', [long], SLOT).timed[0];
		expect([middle.startMin, middle.endMin]).toEqual([0, MINUTES_PER_DAY]);
		expect([middle.continuesBefore, middle.continuesAfter]).toEqual([true, true]);
	});

	it('draws nothing on days the event does not touch', () => {
		expect(dayBlocks('2026-07-27', [CONFERENCE], SLOT).timed).toHaveLength(0);
		expect(dayBlocks('2026-07-30', [CONFERENCE], SLOT).timed).toHaveLength(0);
		expect(spanSlot(CONFERENCE, '2026-07-27', SLOT)).toBeNull();
	});

	it('THE RULE: no day of a span may be dragged', () => {
		// The block's geometry is the DAY, not the duration. Dragging it would
		// write the drawn shape back and destroy the real span.
		for (const day of ['2026-07-28', '2026-07-29']) {
			expect(dayBlocks(day, [CONFERENCE], SLOT).timed[0].draggable).toBe(false);
		}
	});
});

describe('an untimed event is still an all-day chip', () => {
	const untimed: LocalEvent = { ...CONFERENCE, id: 'untimed', startMinutes: null, endMinutes: null };

	it('goes to the lane on every day it spans', () => {
		for (const day of ['2026-07-28', '2026-07-29']) {
			const blocks = dayBlocks(day, [untimed], SLOT);
			expect(blocks.timed).toHaveLength(0);
			expect(blocks.allDay.map((a) => a.dayKey)).toEqual([day]);
		}
	});

	it('and so does a single-day untimed item', () => {
		const plain: LocalEvent = { ...untimed, endDate: undefined };
		expect(dayBlocks('2026-07-28', [plain], SLOT).allDay).toHaveLength(1);
	});
});

describe('single-day events are untouched', () => {
	it('still uses daySlot, wrap handling included', () => {
		const wrap: LocalEvent = {
			kind: 'local',
			id: 'night',
			title: 'night shift',
			date: '2026-07-24',
			startMinutes: 23 * 60,
			endMinutes: 60, // 01:00 the next morning — a wrap, not a span
			checked: false,
			linked: true,
		};
		const block = dayBlocks('2026-07-24', [wrap], SLOT).timed[0];
		expect(block.startMin).toBe(23 * 60);
		expect(block.endMin).toBe(MINUTES_PER_DAY);
		expect(block.crossesMidnight).toBe(true);
		// A wrap is not a span: it says so once, not twice.
		expect([block.continuesBefore, block.continuesAfter]).toEqual([false, false]);
		expect(block.draggable).toBe(false);
	});

	it('keeps an ordinary block draggable', () => {
		const ok: LocalEvent = {
			kind: 'local',
			id: 'ok',
			title: 'standup',
			date: '2026-07-24',
			startMinutes: 540,
			endMinutes: 600,
			checked: false,
			linked: true,
		};
		expect(dayBlocks('2026-07-24', [ok], SLOT).timed[0].draggable).toBe(true);
	});

	it('never inverts a span whose end date precedes its start', () => {
		// A hand-edited filename can say `- 2020-01-01`. Collapsing to one day is
		// what keeps it visible at all; inverting would hide it from every view.
		const inverted: LocalEvent = { ...CONFERENCE, id: 'inverted', endDate: '2020-01-01' };
		const block = dayBlocks('2026-07-28', [inverted], SLOT).timed[0];
		expect([block.continuesBefore, block.continuesAfter]).toEqual([false, false]);
		expect(block.startMin).toBe(20 * 60);
		expect(block.draggable).toBe(true);
	});
});

describe('remote events span the same way', () => {
	const threeDay: RemoteEvent = {
		kind: 'remote',
		id: 'r-conf',
		calendarId: 'c1',
		calendarName: 'Work',
		title: 'Offsite',
		startTs: localMidnight('2026-07-24') + 14 * 60 * 60_000,
		endTs: localMidnight('2026-07-26') + 11 * 60 * 60_000,
		allDay: false,
		color: '#123456',
	};

	it('starts at its real time, fills the middle, ends at its real time', () => {
		const first = dayBlocks('2026-07-24', [threeDay], SLOT).timed[0];
		expect([first.startMin, first.endMin]).toEqual([14 * 60, MINUTES_PER_DAY]);
		expect(first.continuesAfter).toBe(true);

		const middle = dayBlocks('2026-07-25', [threeDay], SLOT).timed[0];
		expect([middle.startMin, middle.endMin]).toEqual([0, MINUTES_PER_DAY]);

		// Unlike a local span, a remote event carries a real end timestamp.
		const last = dayBlocks('2026-07-26', [threeDay], SLOT).timed[0];
		expect([last.startMin, last.endMin]).toEqual([0, 11 * 60]);
		expect(last.continuesAfter).toBe(false);
	});

	it('is never draggable — a subscribed calendar is read-only', () => {
		expect(dayBlocks('2026-07-24', [threeDay], SLOT).timed[0].draggable).toBe(false);
	});
});
