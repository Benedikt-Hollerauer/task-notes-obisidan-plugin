import { describe, it, expect } from 'vitest';
import { remotePrefill } from '../src/core/remote-prefill';

// TZ is pinned to Europe/Berlin in vitest.config.ts — these assertions are about
// a WALL CLOCK, which is what a filename records.
const at = (iso: string): number => new Date(iso).getTime();

describe('remotePrefill — what a calendar event can honestly fill in', () => {
	// A calendar day is not always 86,400,000 ms. Europe/Berlin's 2026-03-29 is 23
	// hours long, and the old code stepped back a fixed day from the exclusive
	// DTEND — landing on 2026-03-28 for an event whose last day is the 29th. That
	// wrong date went straight into a filename.
	it('an all-day span across the spring-forward keeps its true last day', () => {
		expect(
			remotePrefill({
				title: 'Trip',
				startTs: at('2026-03-27T00:00:00'),
				endTs: at('2026-03-30T00:00:00'), // exclusive → last day is the 29th
				allDay: true,
			}),
		).toMatchObject({ startDate: '2026-03-27', endDate: '2026-03-29' });
	});

	it('and across the autumn 25-hour day', () => {
		expect(
			remotePrefill({
				title: 'Trip',
				startTs: at('2026-10-24T00:00:00'),
				endTs: at('2026-10-27T00:00:00'), // last day is the 26th
				allDay: true,
			}),
		).toMatchObject({ startDate: '2026-10-24', endDate: '2026-10-26' });
	});

	it('a single all-day event still reports no endDate at all', () => {
		expect(
			remotePrefill({
				title: 'Holiday',
				startTs: at('2026-08-25T00:00:00'),
				endTs: at('2026-08-26T00:00:00'),
				allDay: true,
			}),
		).not.toHaveProperty('endDate');
	});

	it('carries the date and the wall-clock time', () => {
		expect(
			remotePrefill({
				title: 'Design review',
				startTs: at('2026-08-25T14:00:00'),
				endTs: at('2026-08-25T15:00:00'),
				allDay: false,
			}),
		).toEqual({ startDate: '2026-08-25', time: '14.00h', actionWords: 'Design review' });
	});

	it('does NOT invent an amount or an outcome', () => {
		// A calendar title is arbitrary text; splitting "Design review" into
		// action/amount/outcome would write a name you would only have to fix.
		const out = remotePrefill({
			title: 'Design review',
			startTs: at('2026-08-25T14:00:00'),
			endTs: at('2026-08-25T15:00:00'),
			allDay: false,
		});
		expect(out.amount).toBeUndefined();
		expect(out.amountOutcome).toBeUndefined();
	});

	it('leaves an ordinary event with no end date', () => {
		// An event that ends the day it started is not a range; writing endDate
		// would turn every one-hour meeting into "2026-08-25 - 2026-08-25".
		const out = remotePrefill({
			title: 'Standup',
			startTs: at('2026-08-25T09:00:00'),
			endTs: at('2026-08-25T09:15:00'),
			allDay: false,
		});
		expect(out.endDate).toBeUndefined();
	});

	it('keeps the end date for an event that really spans days', () => {
		const out = remotePrefill({
			title: 'Conference',
			startTs: at('2026-08-25T09:00:00'),
			endTs: at('2026-08-27T17:00:00'),
			allDay: false,
		});
		expect(out.startDate).toBe('2026-08-25');
		expect(out.endDate).toBe('2026-08-27');
	});

	it('gives an all-day event no time', () => {
		const out = remotePrefill({
			title: 'Public holiday',
			startTs: at('2026-08-25T00:00:00'),
			endTs: at('2026-08-26T00:00:00'),
			allDay: true,
		});
		expect(out.time).toBeUndefined();
		expect(out.startDate).toBe('2026-08-25');
	});

	it('THE OFF-BY-ONE: an all-day DTEND is exclusive', () => {
		// A one-day all-day event ends at midnight the NEXT day. Taken literally
		// that makes every holiday a two-day range.
		const oneDay = remotePrefill({
			title: 'Public holiday',
			startTs: at('2026-08-25T00:00:00'),
			endTs: at('2026-08-26T00:00:00'),
			allDay: true,
		});
		expect(oneDay.endDate).toBeUndefined();

		const threeDays = remotePrefill({
			title: 'Conference',
			startTs: at('2026-08-25T00:00:00'),
			endTs: at('2026-08-28T00:00:00'),
			allDay: true,
		});
		expect(threeDays.endDate).toBe('2026-08-27');
	});

	it('trims a padded title rather than baking the spaces into a filename', () => {
		const out = remotePrefill({
			title: '  Design review  ',
			startTs: at('2026-08-25T14:00:00'),
			endTs: at('2026-08-25T15:00:00'),
			allDay: false,
		});
		expect(out.actionWords).toBe('Design review');
	});

	it('pads the clock, so 09:05 is 09.05h and never 9.5h', () => {
		const out = remotePrefill({
			title: 'Standup',
			startTs: at('2026-08-25T09:05:00'),
			endTs: at('2026-08-25T09:20:00'),
			allDay: false,
		});
		expect(out.time).toBe('09.05h');
	});
});
