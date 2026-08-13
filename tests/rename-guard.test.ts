import { describe, it, expect } from 'vitest';
import {
	allowRename,
	createRenameLog,
	LOOP_MAX,
	LOOP_WINDOW_MS,
} from '../src/core/rename-guard';
import { decideReconcile } from '../src/core/sync-decisions';

const SCHEDULED_FORMAT = 'By {date} (at {time} - {range}), {action} - {amount} - {outcome}';

describe('rename circuit breaker', () => {
	it('allows normal renames', () => {
		const log = createRenameLog();
		expect(allowRename(log, 'file-1', 1000)).toBe(true);
		expect(allowRename(log, 'file-1', 5000)).toBe(true);
	});

	it('stops after LOOP_MAX renames inside the window', () => {
		const log = createRenameLog();
		for (let i = 0; i < LOOP_MAX; i++) {
			expect(allowRename(log, 'file-1', 1000 + i)).toBe(true);
		}
		expect(allowRename(log, 'file-1', 1000 + LOOP_MAX)).toBe(false);
	});

	it('tracks files independently', () => {
		const log = createRenameLog();
		for (let i = 0; i < LOOP_MAX; i++) allowRename(log, 'file-1', 1000 + i);
		expect(allowRename(log, 'file-1', 1100)).toBe(false);
		expect(allowRename(log, 'file-2', 1100)).toBe(true);
	});

	it('LATCHES once tripped — waiting does not resume the loop', () => {
		// A loop that keeps producing new names would slip through a sliding window
		// forever, so the breaker stays closed until the plugin reloads.
		const log = createRenameLog();
		for (let i = 0; i < LOOP_MAX; i++) allowRename(log, 'file-1', 1000 + i);
		expect(allowRename(log, 'file-1', 1100)).toBe(false);
		expect(allowRename(log, 'file-1', 1000 + LOOP_WINDOW_MS + 1)).toBe(false);
		// …and only that file: the breaker is per-key, not global.
		expect(allowRename(log, 'file-2', 1000 + LOOP_WINDOW_MS + 1)).toBe(true);
	});

	it('counts one FILE across changing names (a stable key)', () => {
		// Keyed on identity, so a back-and-forth rename loop is counted as one file.
		const log = createRenameLog();
		for (let i = 0; i < LOOP_MAX; i++) expect(allowRename(log, 'file-1', 1000 + i * 10)).toBe(true);
		expect(allowRename(log, 'file-1', 1060)).toBe(false);
	});
});

describe('reconcile skips files claimed by more than one planner line', () => {
	const basename = '📅 By 2026-07-24 at 10.00h, prepare - 1 - deck';

	it('renames a singly-claimed file whose line moved', () => {
		const decisions = decideReconcile(
			'2026-07-24',
			[{ lineNo: 1, startMinutes: 11 * 60, targetBasename: basename, duplicate: false }],
			SCHEDULED_FORMAT,
		);
		expect(decisions).toHaveLength(1);
		expect(decisions[0].toBasename).toContain('11.00h');
	});

	it('leaves a doubly-claimed file alone, from BOTH notes', () => {
		// Monday says 10:00, Tuesday says 15:00 — no filename satisfies both, so
		// renaming from either side would start a rename/rewrite loop.
		const fromMonday = decideReconcile(
			'2026-07-24',
			[{ lineNo: 1, startMinutes: 10 * 60, targetBasename: basename, duplicate: true }],
			SCHEDULED_FORMAT,
		);
		const fromTuesday = decideReconcile(
			'2026-07-25',
			[{ lineNo: 4, startMinutes: 15 * 60, targetBasename: basename, duplicate: true }],
			SCHEDULED_FORMAT,
		);
		expect(fromMonday).toEqual([]);
		expect(fromTuesday).toEqual([]);
	});

	it('treats a missing duplicate flag as not duplicated (back-compat)', () => {
		const decisions = decideReconcile(
			'2026-07-24',
			[{ lineNo: 1, startMinutes: 11 * 60, targetBasename: basename }],
			SCHEDULED_FORMAT,
		);
		expect(decisions).toHaveLength(1);
	});
});
