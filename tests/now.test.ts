import { describe, it, expect } from 'vitest';
import { isHappeningNow, minutesOfDay } from '../src/core/now';

const block = (startMin: number, endMin: number) => ({ startMin, endMin });
const TODAY = '2026-08-11';

describe('isHappeningNow', () => {
	it('marks the block the clock is inside', () => {
		expect(isHappeningNow(block(540, 600), TODAY, TODAY, 570)).toBe(true);
		expect(isHappeningNow(block(540, 600), TODAY, TODAY, 540)).toBe(true); // its first minute
	});

	it('THE RULE: the end is exclusive, so two adjacent blocks are never both now', () => {
		// At exactly 10:00 the 09:00-10:00 block is over and the next has started.
		expect(isHappeningNow(block(540, 600), TODAY, TODAY, 600)).toBe(false);
		expect(isHappeningNow(block(600, 660), TODAY, TODAY, 600)).toBe(true);
	});

	it('marks nothing before or after', () => {
		expect(isHappeningNow(block(540, 600), TODAY, TODAY, 539)).toBe(false);
		expect(isHappeningNow(block(540, 600), TODAY, TODAY, 601)).toBe(false);
	});

	it('never marks a block on another day, whatever the time says', () => {
		// A week view draws seven columns; only today's can be current.
		expect(isHappeningNow(block(540, 600), '2026-08-12', TODAY, 570)).toBe(false);
		expect(isHappeningNow(block(540, 600), '2026-08-10', TODAY, 570)).toBe(false);
	});

	it('covers a full-day continuation block of a multi-day event', () => {
		expect(isHappeningNow(block(0, 1440), TODAY, TODAY, 0)).toBe(true);
		expect(isHappeningNow(block(0, 1440), TODAY, TODAY, 1439)).toBe(true);
	});

	it('never marks a zero-length block', () => {
		expect(isHappeningNow(block(600, 600), TODAY, TODAY, 600)).toBe(false);
	});
});

describe('minutesOfDay', () => {
	it('reads local wall-clock minutes, not UTC', () => {
		// Constructed without a Z suffix, so this IS local time by definition —
		// the same basis the grid draws on.
		expect(minutesOfDay(new Date('2026-08-11T09:30:00').getTime())).toBe(570);
		expect(minutesOfDay(new Date('2026-08-11T00:00:00').getTime())).toBe(0);
		expect(minutesOfDay(new Date('2026-08-11T23:59:00').getTime())).toBe(1439);
	});
});
