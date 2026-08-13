import { describe, it, expect } from 'vitest';
import { linkPrefill } from '../src/core/link-prefill';
import type { TaskProperties } from '../src/types';

const DEFAULTS = { dayStartHour: 8, defaultEventDurationMinutes: 60 };

const parsed = (over: Partial<TaskProperties> = {}): TaskProperties => ({
	actionWords: 'prepare',
	amount: '1',
	amountOutcome: 'deck',
	startDate: '2026-08-25',
	time: '10.00h',
	...over,
});

describe('linkPrefill — the dialog confirms, it does not interrogate', () => {
	it('carries the note’s own date and time through unchanged', () => {
		const out = linkPrefill(
			{ date: '2026-08-25', startMinutes: 600, endMinutes: 660 },
			parsed(),
			DEFAULTS,
		);
		expect(out.props.startDate).toBe('2026-08-25');
		expect(out.props.time).toBe('10.00h');
		expect(out.timeWasMissing).toBe(false);
	});

	it('keeps every name field, so the name round-trips untouched', () => {
		// The dialog also renames the note, so anything it does not seed correctly
		// would be silently rewritten the moment you press Add.
		const out = linkPrefill({ date: '2026-08-25', startMinutes: 600, endMinutes: 660 }, parsed(), DEFAULTS);
		expect(out.props.actionWords).toBe('prepare');
		expect(out.props.amount).toBe('1');
		expect(out.props.amountOutcome).toBe('deck');
	});

	it('THE BUG: says so when the name carries no time, instead of inventing one', () => {
		// This is the case that used to write 08:00 into the planner line AND into
		// the filename, renaming the note and every wikilink to it, with no prompt.
		const out = linkPrefill(
			{ date: '2026-08-25', startMinutes: null, endMinutes: null },
			parsed({ time: undefined }),
			DEFAULTS,
		);
		expect(out.timeWasMissing).toBe(true);
		expect(out.props.time).toBe('08.00h'); // proposed, and the dialog says so
	});

	it('pads the proposed time', () => {
		const out = linkPrefill(
			{ date: '2026-08-25', startMinutes: null, endMinutes: null },
			parsed({ time: undefined }),
			{ dayStartHour: 9, defaultEventDurationMinutes: 60 },
		);
		expect(out.props.time).toBe('09.00h');
	});

	it('uses the event’s real span as the duration when there is one', () => {
		const out = linkPrefill(
			{ date: '2026-08-25', startMinutes: 600, endMinutes: 690 },
			parsed(),
			DEFAULTS,
		);
		expect(out.durationMinutes).toBe(90);
	});

	it('falls back to the default duration for a span that carries no information', () => {
		// The index synthesises endMinutes as start + the default, so a zero or
		// negative span means "nothing was known", not "a zero-length event".
		for (const endMinutes of [null, 600, 540]) {
			const out = linkPrefill(
				{ date: '2026-08-25', startMinutes: 600, endMinutes },
				parsed(),
				DEFAULTS,
			);
			expect(out.durationMinutes).toBe(60);
		}
	});

	it('never returns a duration of zero or less', () => {
		for (const endMinutes of [null, 0, 599, 600]) {
			const out = linkPrefill({ date: '2026-08-25', startMinutes: 600, endMinutes }, parsed(), DEFAULTS);
			expect(out.durationMinutes).toBeGreaterThan(0);
		}
	});
});
