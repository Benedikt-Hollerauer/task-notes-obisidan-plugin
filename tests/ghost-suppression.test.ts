import { describe, it, expect } from 'vitest';
import { suppressGhost } from '../src/core/ghost-suppression';

describe('suppressGhost — a reference only silences the day it lands on', () => {
	it('THE BUG: a reference from ANOTHER day leaves the ghost standing', () => {
		// The real case: `📅 By 2026-08-25 at 10.00h, prepare - 1 - deck` was linked
		// from Daily/2026-07-24.md. The old rule was "referenced anywhere at all?",
		// so the ghost on Aug 25 was suppressed — while the note's only block was
		// built on Jul 24, because a linked event takes its date from the PLAN.
		// Nothing appeared on the day the note is named for.
		expect(suppressGhost('2026-08-25', ['2026-07-24'])).toBe(false);
	});

	it('suppresses when a reference lands on the file’s own date', () => {
		// There the ghost would sit on top of the block that reference already
		// draws, which is the duplicate this rule exists to prevent.
		expect(suppressGhost('2026-08-25', ['2026-08-25'])).toBe(true);
	});

	it('is unmoved by a note referenced from several wrong days', () => {
		expect(suppressGhost('2026-08-25', ['2026-07-24', '2026-07-23', '2026-11-20'])).toBe(false);
	});

	it('suppresses as soon as ONE of many references matches', () => {
		expect(suppressGhost('2026-08-25', ['2026-07-24', '2026-08-25', '2026-11-20'])).toBe(true);
	});

	it('never suppresses a note nothing references', () => {
		expect(suppressGhost('2026-08-25', [])).toBe(false);
		expect(suppressGhost('2026-08-25', new Set())).toBe(false);
	});

	it('takes any iterable, because the caller holds a Set', () => {
		expect(suppressGhost('2026-08-25', new Set(['2026-08-25']))).toBe(true);
		expect(suppressGhost('2026-08-25', new Set(['2026-07-24']))).toBe(false);
	});

	it('compares dates exactly — no prefix or month matching', () => {
		// Guards against a "same month is close enough" shortcut creeping in.
		expect(suppressGhost('2026-08-25', ['2026-08-26'])).toBe(false);
		expect(suppressGhost('2026-08-25', ['2026-08'])).toBe(false);
		expect(suppressGhost('2026-08-25', ['2026-08-250'])).toBe(false);
	});
});
