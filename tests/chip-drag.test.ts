import { describe, it, expect } from 'vitest';
import {
	chipDropDate,
	isClickGesture,
	slopFor,
	CLICK_SLOP_PX,
	TOUCH_SLOP_PX,
} from '../src/core/chip-drag';
import { columnIndex, dayAt, ownsPointer } from '../src/core/interaction';
import { dayBlocks } from '../src/ui/views/svelte/layout';
import type { LocalEvent } from '../src/types';

const SLOT = { dayStartHour: 8, defaultEventDurationMinutes: 60 };

describe('chipDropDate — a chip moves RELATIVE to the day it was grabbed on', () => {
	it('is a no-op when dropped on the day it came from', () => {
		expect(chipDropDate('2026-07-25', '2026-07-25', '2026-07-25')).toBe('2026-07-25');
	});

	it('moves a single-day event by the drop delta', () => {
		expect(chipDropDate('2026-07-25', '2026-07-25', '2026-07-27')).toBe('2026-07-27');
		expect(chipDropDate('2026-07-25', '2026-07-25', '2026-07-22')).toBe('2026-07-22');
	});

	it('THE REGRESSION: a multi-day event grabbed on a later day moves by the delta, not to the drop day', () => {
		// A conference running 07-25 → 07-27 renders a chip under all three days.
		// Grabbing the 07-27 chip and dropping it one column right must move the
		// whole event to 07-26, NOT teleport its start to 07-28. Using the drop day
		// directly is what renamed the file and moved the line between notes.
		expect(chipDropDate('2026-07-25', '2026-07-27', '2026-07-28')).toBe('2026-07-26');
		expect(chipDropDate('2026-07-25', '2026-07-26', '2026-07-25')).toBe('2026-07-24');
	});

	it('crosses month and year boundaries', () => {
		expect(chipDropDate('2026-07-31', '2026-07-31', '2026-08-01')).toBe('2026-08-01');
		expect(chipDropDate('2026-12-31', '2026-12-31', '2027-01-01')).toBe('2027-01-01');
	});
});

describe('isClickGesture', () => {
	const at = (x: number, y: number) => ({ x, y });

	it('treats a motionless press as a click', () => {
		expect(isClickGesture(at(100, 100), at(100, 100))).toBe(true);
	});

	it('tolerates jitter up to the slop', () => {
		expect(isClickGesture(at(100, 100), at(100 + CLICK_SLOP_PX, 100))).toBe(true);
		expect(isClickGesture(at(100, 100), at(100, 100 - CLICK_SLOP_PX))).toBe(true);
	});

	it('is a drag past the slop, in either axis', () => {
		expect(isClickGesture(at(100, 100), at(100 + CLICK_SLOP_PX + 1, 100))).toBe(false);
		expect(isClickGesture(at(100, 100), at(100, 100 + CLICK_SLOP_PX + 1))).toBe(false);
	});
});

describe('all-day chips carry the day they are rendered under', () => {
	const conference: LocalEvent = {
		kind: 'local',
		id: 'conf',
		title: 'conference',
		date: '2026-07-25',
		endDate: '2026-07-27',
		startMinutes: null,
		endMinutes: null,
		checked: false,
		linked: true,
	};

	it('renders one chip per spanned day, each with its own day and a unique key', () => {
		const days = ['2026-07-25', '2026-07-26', '2026-07-27'];
		const chips = days.map((d) => dayBlocks(d, [conference], SLOT).allDay[0]);

		expect(chips.map((c) => c.dayKey)).toEqual(days);
		// Same event id on every chip — which is exactly why the day must be carried
		// separately for the drop to be relative.
		expect(chips.every((c) => c.id === 'conf')).toBe(true);
		expect(new Set(chips.map((c) => c.key)).size).toBe(3);
	});

	it('gives a single-day untimed item its own day', () => {
		const plain: LocalEvent = {
			kind: 'local',
			id: 'plain',
			title: 'Water the plants',
			date: '2026-07-27',
			startMinutes: null,
			endMinutes: null,
			checked: false,
			linked: true,
		};
		const chip = dayBlocks('2026-07-27', [plain], SLOT).allDay[0];
		expect(chip.dayKey).toBe('2026-07-27');
		// The trailing index makes the key unique even against a duplicate event
		// id, which a bare `id::day` was not — see tests/block-keys.test.ts.
		expect(chip.key).toBe('plain::2026-07-27::0');
	});
});

describe('columnIndex — never guess a day', () => {
	it('reads a real column', () => {
		expect(columnIndex('0', 7)).toBe(0);
		expect(columnIndex('6', 7)).toBe(6);
	});

	it('THE RULE: refuses rather than defaulting to day 0', () => {
		// `?? 0` here made a motionless click compute originDayIndex = 0, report
		// "moved" once the pointer found the real column, and perform a write.
		expect(columnIndex(null, 7)).toBeNull();
		expect(columnIndex('7', 7)).toBeNull();
		expect(columnIndex('-1', 7)).toBeNull();
		expect(columnIndex('abc', 7)).toBeNull();
		expect(columnIndex('1.5', 7)).toBeNull();
		expect(columnIndex('', 7)).toBeNull();
	});

	it('refuses everything when there are no days', () => {
		expect(columnIndex('0', 0)).toBeNull();
	});
});

describe('dayAt — THE ONLY route from a column attribute to a date', () => {
	const DAYS = ['2026-07-20', '2026-07-21', '2026-07-22'];

	it('reads a real column', () => {
		expect(dayAt('0', DAYS)).toEqual({ index: 0, key: '2026-07-20' });
		expect(dayAt('2', DAYS)).toEqual({ index: 2, key: '2026-07-22' });
	});

	it('THE RULE: every refusal here is a cross-day write that does not happen', () => {
		// The grid used to hit-test with its own `Number(el.getAttribute(...))`,
		// three lines from the guard written to prevent exactly this. Each of these
		// resolved to a day under that code; each would have moved a line between
		// two daily notes on a gesture the user never made.
		expect(dayAt(null, DAYS)).toBeNull();
		expect(dayAt('', DAYS)).toBeNull(); // Number('') === 0
		expect(dayAt('abc', DAYS)).toBeNull();
		expect(dayAt('1.5', DAYS)).toBeNull();
		expect(dayAt('-1', DAYS)).toBeNull();
		expect(dayAt('3', DAYS)).toBeNull();
	});

	it('refuses a stale index when the range changed mid-drag', () => {
		expect(dayAt('6', DAYS)).toBeNull();
		expect(dayAt('0', [])).toBeNull();
	});
});

describe('ownsPointer — one finger cannot drive another finger\'s gesture', () => {
	const gesture = { pointerId: 7, id: 'chip' };

	it('accepts the pointer that started it', () => {
		expect(ownsPointer(gesture, { pointerId: 7 })).toBe(true);
	});

	it('THE RULE: every refusal here is a write that does not happen', () => {
		// The lane divider and the all-day chip both capture on the same element
		// and are dispatched from one handler pair. Without this, lifting the
		// finger resting on the divider ran the CHIP's pointerup at that finger's
		// coordinates and rescheduled the event — a file write and a rename.
		expect(ownsPointer(gesture, { pointerId: 8 })).toBe(false);
		expect(ownsPointer(null, { pointerId: 7 })).toBe(false);
		expect(ownsPointer(undefined, { pointerId: 7 })).toBe(false);
	});

	it('treats pointer id 0 as a real pointer, not as absent', () => {
		expect(ownsPointer({ pointerId: 0 }, { pointerId: 0 })).toBe(true);
		expect(ownsPointer({ pointerId: 0 }, { pointerId: 1 })).toBe(false);
	});
});

describe('slop follows the POINTER, not the code that wrote it', () => {
	const at = (x: number, y: number) => ({ x, y });

	it('keeps the mouse threshold when no pointer type is given', () => {
		// Every pre-existing caller passes two points and nothing else; none of them
		// may change behaviour because a third parameter now exists.
		expect(isClickGesture(at(0, 0), at(CLICK_SLOP_PX, 0))).toBe(true);
		expect(isClickGesture(at(0, 0), at(CLICK_SLOP_PX + 1, 0))).toBe(false);
		expect(slopFor(undefined)).toBe(CLICK_SLOP_PX);
		expect(slopFor('mouse')).toBe(CLICK_SLOP_PX);
	});

	it('THE PHONE BUG: a finger that drifts 8px was still tapping', () => {
		// 4px is a mouse number. A finger's contact patch shifts as it lifts, so on
		// a phone half the taps on a chip were read as drags.
		expect(isClickGesture(at(0, 0), at(8, 5), 'touch')).toBe(true);
		expect(isClickGesture(at(0, 0), at(8, 5))).toBe(false); // …as a mouse, a drag
	});

	it('treats a pen like a finger, and still calls a real drag a drag', () => {
		expect(slopFor('pen')).toBe(TOUCH_SLOP_PX);
		expect(isClickGesture(at(0, 0), at(TOUCH_SLOP_PX + 1, 0), 'touch')).toBe(false);
	});
});
