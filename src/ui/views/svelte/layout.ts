// Pure helpers that turn events into positioned blocks for a given day.
import type { TaskEvent } from '../../../types';
import { overlapLayout } from '../../../core/overlap';
import { eventTouchesDay } from '../../../core/event-range';
import { spanSlot, type SlotSettings } from '../../../core/event-slot';

export interface TimedBlock {
	/**
	 * Unique per (event, rendered day) — the {#each} key. `id` alone is NOT
	 * guaranteed unique: a duplicate event id (an index hiccup, an ICS feed
	 * emitting two occurrences with one UID+start) used to make Svelte throw
	 * `each_key_duplicate` mid-update, which silently froze the grid's DOM —
	 * the "header says yesterday" bug. AllDayItem always had a composed key;
	 * this is the same guarantee for the timed lane.
	 */
	key: string;
	id: string;
	event: TaskEvent;
	startMin: number;
	endMin: number;
	left: number;
	width: number;
	/** Runs past midnight — drawn to the day edge and not draggable. */
	crossesMidnight: boolean;
	/** The event began before this day: the top edge is a continuation. */
	continuesBefore: boolean;
	/** The event runs past this day: the bottom edge is a continuation. */
	continuesAfter: boolean;
	/**
	 * Safe to move or resize by dragging.
	 *
	 * False whenever the block's GEOMETRY is not its duration — a line running
	 * past midnight, or one day of a multi-day span. Dragging those would write
	 * back the drawn shape and silently destroy the real times.
	 */
	draggable: boolean;
}

export interface AllDayItem {
	/**
	 * Unique per rendered chip — the {#each} key.
	 *
	 * Per (event, day) was not enough: two events sharing an id on ONE day still
	 * collided, and a duplicate key throws mid-update, which silently freezes the
	 * lane's DOM. The index suffix is what closes that, exactly as it does for
	 * TimedBlock. See tests/block-keys.test.ts.
	 */
	key: string;
	/** The event's own id — several chips can share it. */
	id: string;
	/** The day THIS chip is rendered under, which drives relative moves. */
	dayKey: string;
	event: TaskEvent;
}

export interface DayBlocks {
	timed: TimedBlock[];
	allDay: AllDayItem[];
	/** Render keys of timed blocks that overlap another block on this day. */
	overlapping: Set<string>;
}

/** Split events into timed (overlap-laid-out) blocks and all-day items for a day. */
export function dayBlocks(dayKey: string, events: TaskEvent[], settings: SlotSettings): DayBlocks {
	const timedRaw: Omit<TimedBlock, 'left' | 'width'>[] = [];
	const allDay: AllDayItem[] = [];

	for (const ev of events) {
		// The ONE question that decides the lane: does this event have a time?
		// It used to also ask whether the event had an end date, which sent every
		// multi-day event to the lane however precisely it had been scheduled.
		const untimed = ev.kind === 'remote' ? ev.allDay : ev.startMinutes == null;
		const slot = untimed ? null : spanSlot(ev, dayKey, settings);

		if (untimed) {
			if (eventTouchesDay(ev, dayKey)) {
				allDay.push({ key: `${ev.id}::${dayKey}::${allDay.length}`, id: ev.id, dayKey, event: ev });
			}
			continue;
		}
		if (!slot) continue;

		timedRaw.push({
			// The index suffix makes the key unique even against a duplicate id.
			key: `${ev.id}::${dayKey}::${timedRaw.length}`,
			id: ev.id,
			event: ev,
			startMin: slot.start,
			endMin: slot.end,
			crossesMidnight: slot.crossesMidnight,
			continuesBefore: slot.continuesBefore,
			continuesAfter: slot.continuesAfter,
			draggable:
				ev.kind === 'local' && !slot.crossesMidnight && !slot.continuesBefore && !slot.continuesAfter,
		});
	}

	// One clustering pass for both answers: which column a block sits in, and
	// whether it overlaps anything. They are the same traversal.
	const { placement, overlapping } = overlapLayout(
		timedRaw.map((b) => ({ id: b.key, start: b.startMin, end: b.endMin })),
	);
	const timed: TimedBlock[] = timedRaw.map((b) => {
		const p = placement.get(b.key);
		return { ...b, left: p?.left ?? 0, width: p?.width ?? 1 };
	});

	return { timed, allDay, overlapping };
}
