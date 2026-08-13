// Regressions for bugs found by the adversarial review of the v2.1 quality round.
import { describe, it, expect } from 'vitest';
import { EMOJI_REGISTRY, ACTIVE_MARKER } from '../src/constants';
import { extractTaskEmoji, hasTaskEmoji } from '../src/core/emoji';
import { eventSpan, eventTouchesDay } from '../src/core/event-range';
import { decideReconcile } from '../src/core/sync-decisions';
import { snap } from '../src/core/timestamps';
import type { LocalEvent } from '../src/types';

const SCHEDULED_FORMAT = 'By {date} (at {time} - {range}), {action} - {amount} - {outcome}';

describe('regression: hasTaskEmoji implies extractTaskEmoji', () => {
	it('never matches a variation-selector form the extractor cannot resolve', () => {
		// The regex used to append an optional U+FE0F to EVERY emoji, so "✅️ x"
		// matched but extractTaskEmoji returned null — emoji would then double up.
		for (const spec of EMOJI_REGISTRY) {
			for (const candidate of [
				`${spec.emoji} name`,
				`${spec.emoji}️ name`,
				`${ACTIVE_MARKER} ${spec.emoji} name`,
			]) {
				if (hasTaskEmoji(candidate)) {
					expect(extractTaskEmoji(candidate), candidate).not.toBeNull();
				}
			}
		}
	});

	it('still accepts the bare white square (no variation selector)', () => {
		expect(hasTaskEmoji('◻ bare - 1 - x')).toBe(true);
		expect(extractTaskEmoji('◻ bare - 1 - x')).toBe('◻️');
	});
});

describe('regression: inverted multi-day spans stay visible', () => {
	function ev(date: string, endDate?: string): LocalEvent {
		return {
			kind: 'local',
			id: 'x',
			title: 'x',
			date,
			endDate,
			startMinutes: 600,
			endMinutes: 660,
			checked: false,
			linked: true,
		};
	}

	it('clamps an end date that precedes the start instead of hiding the event', () => {
		const broken = ev('2026-07-27', '2026-07-25');
		expect(eventSpan(broken)).toEqual({ from: '2026-07-27', to: '2026-07-27' });
		expect(eventTouchesDay(broken, '2026-07-27')).toBe(true);
	});

	it('reconcile drops a stale range rather than writing a backwards span', () => {
		// The file still carries its old range; the line has moved past it.
		const basename = '📅 By 2026-07-20 (at 09.00h - 2026-07-21), attend - 1 - conference';
		const decisions = decideReconcile(
			'2026-07-30',
			[{ lineNo: 1, startMinutes: 540, targetBasename: basename }],
			SCHEDULED_FORMAT,
		);
		expect(decisions).toHaveLength(1);
		expect(decisions[0].toBasename).toContain('2026-07-30');
		expect(decisions[0].toBasename).not.toContain('2026-07-21');

		// And the result is a fixpoint.
		const again = decideReconcile(
			'2026-07-30',
			[{ lineNo: 1, startMinutes: 540, targetBasename: decisions[0].toBasename }],
			SCHEDULED_FORMAT,
		);
		expect(again).toEqual([]);
	});

	it('preserves a valid forward range (normalising the legacy paren form once)', () => {
		const basename = '📅 By 2026-07-25 (at 09.00h - 2026-07-26), attend - 1 - conference';
		const decisions = decideReconcile(
			'2026-07-25',
			[{ lineNo: 1, startMinutes: 540, targetBasename: basename }],
			SCHEDULED_FORMAT,
		);
		// The legacy parenthesised form is rewritten to the canonical one, but the
		// range itself must survive.
		expect(decisions).toHaveLength(1);
		expect(decisions[0].toBasename).toContain('2026-07-26');

		// One normalisation only — the canonical form is a fixpoint.
		const again = decideReconcile(
			'2026-07-25',
			[{ lineNo: 1, startMinutes: 540, targetBasename: decisions[0].toBasename }],
			SCHEDULED_FORMAT,
		);
		expect(again).toEqual([]);
	});
});

describe('regression: no-move click detection', () => {
	// The drag code snaps the moving value; the origin must be snapped the same way
	// or a motionless click on a 09:07 block would compare 540 !== 547 and write.
	it('a snapped origin equals the snapped result of a zero-distance move', () => {
		const step = 15;
		const blockStart = 547; // 09:07 — deliberately off the snap grid
		const originStart = snap(blockStart, step);
		const rawMin = blockStart; // pointer exactly where it was pressed
		const grabOffset = rawMin - originStart;
		const movedStart = snap(rawMin - grabOffset, step);
		expect(movedStart).toBe(originStart);
	});
});
