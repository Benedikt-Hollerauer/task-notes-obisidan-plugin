// CONVERTING A NOTE IS A RENAME, AND ONLY A RENAME.
//
// Reported as "when i create a event and its in the inbox but not planned yet
// anywhere it just sets a default time of 08.00h" and "its somehow linked to
// todays daily note even though i didnt do that". One cause, three writes:
//
//   `TaskMenus.doConvert` linked the note into a day plan whenever it had a DATE.
//   The guard never looked at the TIME, and the start expression was degenerate —
//   `props.time ? dotToMinutes(props.time) ?? dayStartHour*60 : dayStartHour*60`
//   is `dayStartHour*60` on both branches when the time is blank. So it
//     1. created or opened that day's daily note (`getOrCreateBare`),
//     2. wrote `- [ ] 08:00 - 09:00 [[the note]]` into it,
//     3. and the resulting index change made `reconcile` rename the FILE to match
//        the line, stamping `at 08.00h` onto a name that never had a time and
//        rewriting every wikilink to it.
//
// Planning is a deliberate gesture — the dashed "not in plan" block and its ➕.
// Conversion must not do it, with or without a time.
//
// `doConvert` is Obsidian-coupled and the dependency that was removed is exactly
// what a fake would have injected, so this reads the real source instead — the
// same approach `tests/adopt-template.test.ts` uses for `applyTemplate`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateTaskName } from '../src/core/task-name';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { renameTimeIntent } from '../src/core/event-filename';
import { decideReconcile } from '../src/core/sync-decisions';

const SOURCE = readFileSync(fileURLToPath(new URL('../src/ui/menus.ts', import.meta.url)), 'utf8');

/**
 * The file with its comments removed.
 *
 * Load-bearing: the comments in `doConvert` explain the bug by NAME — they say
 * `getOrCreateBare`, `dayStartHour`, `08:00`. Asserting against the raw text made
 * the guard fail on its own documentation, which would have pushed the next person
 * to delete the explanation to get the test green.
 */
const MENUS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the conversion path cannot write to a daily note', () => {
	it('THE FIX: menus.ts never links a note into a day plan', () => {
		expect(MENUS).not.toContain('linkFileIntoDay');
	});

	it('and cannot reach one: it does not depend on SyncEngine at all', () => {
		// The dependency is gone from the constructor, not merely unused — so a
		// future edit has to consciously re-add it rather than find it lying there.
		expect(MENUS).not.toContain('SyncEngine');
		expect(MENUS).not.toContain('syncEngine');
	});

	it('nor can it invent a time: dayStartHour is not reachable from here', () => {
		expect(MENUS).not.toContain('dayStartHour');
		expect(MENUS).not.toContain('dotToMinutes');
	});

	it('doConvert ends by delegating to the rename and nothing else', () => {
		const from = MENUS.indexOf('private async doConvert(');
		expect(from, 'doConvert must exist').toBeGreaterThan(-1);
		const body = MENUS.slice(from, MENUS.indexOf('\n\tprivate promptCustomEmoji', from));
		expect(body).toContain('await this.taskFiles.convert(item, emoji, props);');
		// The daily-note confirmation added earlier is still the only other await.
		expect(body).toContain('this.isDailyNote(item)');
		expect(body).not.toContain('getOrCreateBare');
	});
});

describe('a scheduled name with no time carries no time', () => {
	const format = DEFAULT_SETTINGS.scheduledTaskFormat;

	it('THE SYMPTOM: no "at …h" clause is generated for a blank time', () => {
		const name = generateTaskName(
			{ actionWords: 'write', amount: '1 message', amountOutcome: 'to the office', startDate: '2026-08-14' },
			format,
		);
		expect(name).toContain('2026-08-14');
		expect(name).not.toContain('at ');
		expect(name).not.toMatch(/\d\d\.\d\dh/);
	});

	it('…and a time that WAS given still appears', () => {
		const name = generateTaskName(
			{
				actionWords: 'attend',
				amount: '1 trip',
				amountOutcome: 'to Echelon',
				startDate: '2026-08-15',
				time: '12.00h',
			},
			format,
		);
		expect(name).toContain('at 12.00h');
	});
});

// THE CLEANUP ORDER, for notes already stamped with `at 08.00h` by the old bug.
//
// The filename and the planner line sync to each other, so the order matters and
// is not obvious. These pin what the user is told to do.
describe('undoing an unwanted 08.00h: delete the line first, then rename', () => {
	const format = DEFAULT_SETTINGS.scheduledTaskFormat;

	it('renaming FIRST only clears the line’s time — the note stays planned', () => {
		// `updateLineFromFilename` acts on this intent: the file lost its time, so
		// the LINE loses its time too. The line itself remains, so the note is still
		// linked to that day — as an untimed (all-day) item.
		const intent = renameTimeIntent(
			'📅 By 2026-08-14 at 08.00h, write - 1 message - to the office',
			'📅 By 2026-08-14, write - 1 message - to the office',
			format,
		);
		expect(intent).toEqual({ action: 'clear' });
	});

	it('deleting the line FIRST leaves nothing to rename the file back', () => {
		// With no planner line claiming the note, reconcile has no decision to make,
		// so the filename is never rewritten…
		expect(decideReconcile('2026-08-14', [], format)).toEqual([]);
	});

	it('…and renaming it afterwards syncs nothing, because no line refers to it', () => {
		// Same intent as above, but now there is no line for it to act on — which is
		// exactly why this order leaves the note dated, timeless and unplanned.
		const intent = renameTimeIntent(
			'📅 By 2026-08-14 at 08.00h, write - 1 message - to the office',
			'📅 By 2026-08-14, write - 1 message - to the office',
			format,
		);
		expect(intent.action).toBe('clear');
		expect(decideReconcile('2026-08-14', [], format)).toEqual([]);
	});
});
