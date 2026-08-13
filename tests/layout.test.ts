import { describe, it, expect } from 'vitest';
import { overlapLayout, type Interval } from '../src/core/overlap';
import { dayBlocks } from '../src/ui/views/svelte/layout';
import type { RemoteEvent, LocalEvent } from '../src/types';

const SLOT = { dayStartHour: 8, defaultEventDurationMinutes: 60 };

// Local midnight for a given day (matches how the grid buckets time).
function localMidnight(day: string): number {
	return new Date(`${day}T00:00:00`).getTime();
}

function remote(partial: Partial<RemoteEvent>): RemoteEvent {
	return {
		kind: 'remote',
		id: 'r1',
		calendarId: 'c1',
		calendarName: 'Cal',
		title: 'Remote',
		startTs: 0,
		endTs: 0,
		allDay: false,
		color: '#123456',
		...partial,
	};
}

describe('dayBlocks — remote events use local day keys', () => {
	it('places a timed remote block on its local day', () => {
		const ev = remote({ startTs: localMidnight('2026-07-24') + 9 * 60 * 60_000, endTs: localMidnight('2026-07-24') + 10 * 60 * 60_000 });
		const onDay = dayBlocks('2026-07-24', [ev], SLOT);
		expect(onDay.timed).toHaveLength(1);
		expect(onDay.timed[0].startMin).toBe(540);
		expect(onDay.timed[0].endMin).toBe(600);
		expect(dayBlocks('2026-07-23', [ev], SLOT).timed).toHaveLength(0);
	});

	it('places an all-day remote event on the correct local day, not a UTC-shifted one', () => {
		const ev = remote({ allDay: true, startTs: localMidnight('2026-07-24'), endTs: localMidnight('2026-07-25') });
		expect(dayBlocks('2026-07-24', [ev], SLOT).allDay).toHaveLength(1);
		expect(dayBlocks('2026-07-23', [ev], SLOT).allDay).toHaveLength(0);
		expect(dayBlocks('2026-07-25', [ev], SLOT).allDay).toHaveLength(0);
	});

	it('spans a multi-day all-day remote event across each day', () => {
		const ev = remote({ allDay: true, startTs: localMidnight('2026-07-24'), endTs: localMidnight('2026-07-26') });
		expect(dayBlocks('2026-07-24', [ev], SLOT).allDay).toHaveLength(1);
		expect(dayBlocks('2026-07-25', [ev], SLOT).allDay).toHaveLength(1);
		expect(dayBlocks('2026-07-26', [ev], SLOT).allDay).toHaveLength(0); // end is exclusive midnight
	});

	it('renders a local timed event and a local all-day/multi-day event', () => {
		const timed: LocalEvent = {
			kind: 'local',
			id: 'a',
			title: 'A',
			date: '2026-07-24',
			startMinutes: 600,
			endMinutes: 660,
			checked: false,
			linked: true,
		};
		const multi: LocalEvent = {
			kind: 'local',
			id: 'b',
			title: 'B',
			date: '2026-07-24',
			endDate: '2026-07-26',
			startMinutes: null,
			endMinutes: null,
			checked: false,
			linked: false,
		};
		const day = dayBlocks('2026-07-25', [timed, multi], SLOT);
		expect(day.timed).toHaveLength(0); // timed is single-day 07-24
		expect(day.allDay.map((a) => a.id)).toEqual(['b']);
	});
});

describe('overlapLayout — the two answers come from ONE clustering pass', () => {
	it('THE INVARIANT: a block is flagged overlapping exactly when it shares a column set', () => {
		// findOverlaps and layoutOverlaps used to cluster the same array
		// independently, on the same line. This is what stops them disagreeing.
		const cases: Interval[][] = [
			[],
			[{ id: 'a', start: 540, end: 600 }],
			[
				{ id: 'a', start: 540, end: 660 },
				{ id: 'b', start: 600, end: 720 },
			],
			// A-B and B-C touch, A-C do not: one cluster of three all the same.
			[
				{ id: 'a', start: 540, end: 600 },
				{ id: 'b', start: 570, end: 660 },
				{ id: 'c', start: 630, end: 700 },
			],
			// Back-to-back is not an overlap.
			[
				{ id: 'a', start: 540, end: 600 },
				{ id: 'b', start: 600, end: 660 },
			],
			// Identical and zero-length blocks.
			[
				{ id: 'a', start: 540, end: 540 },
				{ id: 'b', start: 540, end: 540 },
			],
		];
		for (const items of cases) {
			const { placement, overlapping } = overlapLayout(items);
			for (const item of items) {
				expect(overlapping.has(item.id)).toBe((placement.get(item.id)?.columns ?? 1) > 1);
			}
		}
	});

	it('never widens blocks that share no time', () => {
		const { placement } = overlapLayout([
			{ id: 'morning', start: 540, end: 600 },
			{ id: 'evening', start: 1080, end: 1140 },
		]);
		expect(placement.get('morning')?.width).toBe(1);
		expect(placement.get('evening')?.width).toBe(1);
	});
});

describe('the lane transition — dragging between all-day and the grid', () => {
	/** One local event, timed or not, with everything else held constant. */
	const local = (startMinutes: number | null, endMinutes: number | null): LocalEvent => ({
		kind: 'local',
		id: 'deck',
		title: 'prepare - 1 - deck',
		date: '2026-08-25',
		startMinutes,
		endMinutes,
		checked: false,
		linked: true,
	});

	it('a timed event is in the grid, an untimed one is in the lane', () => {
		// The ONE question that decides the lane, asserted as a round trip rather
		// than as two unrelated states — dragging between them is now a gesture.
		const timed = dayBlocks('2026-08-25', [local(600, 660)], SLOT);
		expect(timed.timed).toHaveLength(1);
		expect(timed.allDay).toHaveLength(0);

		const untimed = dayBlocks('2026-08-25', [local(null, null)], SLOT);
		expect(untimed.allDay).toHaveLength(1);
		expect(untimed.timed).toHaveLength(0);
	});

	it('clearing only the START is enough to move it to the lane', () => {
		// What a lane drop writes is `applyBlockEdit(ev, day, null, null)`, but the
		// index rebuilds `end` from `start`, so the start is the load-bearing half.
		const out = dayBlocks('2026-08-25', [local(null, 660)], SLOT);
		expect(out.allDay).toHaveLength(1);
		expect(out.timed).toHaveLength(0);
	});

	it('a lane item keeps its day', () => {
		expect(dayBlocks('2026-08-25', [local(null, null)], SLOT).allDay).toHaveLength(1);
		expect(dayBlocks('2026-08-24', [local(null, null)], SLOT).allDay).toHaveLength(0);
		expect(dayBlocks('2026-08-26', [local(null, null)], SLOT).allDay).toHaveLength(0);
	});
});
