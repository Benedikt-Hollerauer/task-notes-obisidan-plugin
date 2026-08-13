// THE REFUSAL WIRING AROUND THE ONE WRITE THAT REPLACES A WHOLE NOTE.
//
// `mergeTemplateIntoBareNote` is pure and well covered (template-merge.test.ts).
// What was NOT covered is the wiring in `DailyNoteService.applyTemplateIfBare`
// that decides whether to WRITE what the merge produced — and that wiring is the
// entire safety story: the merge hands back a complete replacement for the file,
// so a `dropped` list that goes unread deletes those blocks and everything nested
// under them.
//
// A pre-publish audit found the merge itself correct and this wiring untested.
// These tests pin the four properties that make the write safe:
//
//   1. a refusal leaves the file BYTE-identical, and reports what was in the way
//   2. bareness is re-checked INSIDE vault.process, so a note that gains content
//      between the read and the write is not clobbered
//   3. `merged` can never be true when anything was dropped
//   4. an unreadable or empty template writes nothing
//
// The vault is faked rather than mocked at the module level, because the thing
// under test is precisely the interplay between the callback's return value and
// what the vault does with it.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import moment from 'moment';
import { DailyNoteService } from '../src/services/daily-note-service';
import { HEADING } from './fixtures/user-note';

/** The template the merge is asked to weave in. */
const TEMPLATE = `${HEADING}\n- [ ] 07:00 - 08:00\n- [ ] 09:00 - 10:00\n`;

let templateRaw = TEMPLATE;
let templateThrows = false;

vi.mock('obsidian-daily-notes-interface', () => ({
	DEFAULT_DAILY_NOTE_FORMAT: 'YYYY-MM-DD',
	appHasDailyNotesPluginLoaded: () => true,
	getDailyNoteSettings: () => ({ folder: 'Daily', format: 'YYYY-MM-DD', template: 'tpl.md' }),
	// The basename IS the date in these fixtures.
	getDateFromFile: (file: { basename: string }) => {
		const m = moment(file.basename, 'YYYY-MM-DD', true);
		return m.isValid() ? m : null;
	},
	getTemplateInfo: () => {
		if (templateThrows) throw new Error('template unreadable');
		return Promise.resolve([templateRaw]);
	},
}));

/**
 * A vault that behaves like Obsidian's: `process` reads the CURRENT text, hands
 * it to the callback, and stores whatever comes back. `onRead` lets a test slip
 * an edit in between the service's `cachedRead` and its `process` — the race the
 * inner bareness check exists for.
 */
function fakeVault(initial: string, onRead?: () => void) {
	const state = { text: initial, writes: 0 };
	const file = { basename: '2026-08-20', path: 'Daily/2026-08-20.md', extension: 'md' };
	const app = {
		vault: {
			cachedRead: async () => {
				onRead?.();
				return state.text;
			},
			process: async (_f: unknown, fn: (c: string) => string) => {
				const next = fn(state.text);
				if (next !== state.text) state.writes++;
				state.text = next;
				return next;
			},
			getAbstractFileByPath: () => null,
			createFolder: async () => undefined,
			create: async () => file,
		},
	};
	// The service only needs these two settings for this path.
	const service = new DailyNoteService(
		app as never,
		() => HEADING,
		// Folder-strictness is not what these tests are about; switching it off
		// keeps `dateOf` from needing a real daily-notes path resolver.
		() => false,
	);
	return { service, file: file as never, state };
}

const BARE = `${HEADING}\n- [ ] 07:00 - 08:00\n\t- [ ] Document 1 dream\n`;

beforeEach(() => {
	templateRaw = TEMPLATE;
	templateThrows = false;
});

describe('applyTemplateIfBare — the write is refused, not attempted, when anything would be lost', () => {
	it('THE GUARD: a block the template already carries refuses the WHOLE write', () => {
		// The template has `- [ ] 07:00 - 08:00` and so does the note. The merge
		// cannot place the note's copy, and its child rides along with it.
		const { service, file, state } = fakeVault(BARE);
		return service.applyTemplateIfBare(file).then((outcome) => {
			expect(outcome.status).toBe('would-lose-content');
			expect(outcome).toHaveProperty('dropped', ['- [ ] 07:00 - 08:00']);
			// The whole point: nothing was written, and the child line survives.
			expect(state.text).toBe(BARE);
			expect(state.writes).toBe(0);
			expect(state.text).toContain('Document 1 dream');
		});
	});

	it('a merge that places everything DOES write, and keeps the planned line', async () => {
		const note = `${HEADING}\n- [ ] 11:00 - 12:00\n\t- [ ] Standup\n`;
		const { service, file, state } = fakeVault(note);
		const outcome = await service.applyTemplateIfBare(file);
		expect(outcome.status).toBe('merged');
		expect(state.writes).toBe(1);
		// Both the template's rows and the note's own block, with its child.
		expect(state.text).toContain('- [ ] 07:00 - 08:00');
		expect(state.text).toContain('- [ ] 11:00 - 12:00');
		expect(state.text).toContain('Standup');
	});

	it('THE RACE: content arriving between the read and the write is not clobbered', async () => {
		// `cachedRead` sees a bare note; by the time `process` runs, the user has
		// typed a paragraph into it. Without the re-check inside the callback the
		// merge would replace that paragraph with the template.
		let text = `${HEADING}\n- [ ] 11:00 - 12:00\n`;
		const state = { writes: 0 };
		const file = { basename: '2026-08-20', path: 'Daily/2026-08-20.md', extension: 'md' };
		const app = {
			vault: {
				cachedRead: async () => {
					const seen = text;
					text = `${HEADING}\n- [ ] 11:00 - 12:00\n\nMy own notes from the meeting.\n`;
					return seen;
				},
				process: async (_f: unknown, fn: (c: string) => string) => {
					const next = fn(text);
					if (next !== text) state.writes++;
					text = next;
					return next;
				},
			},
		};
		const service = new DailyNoteService(
			app as never,
			() => HEADING,
			// Folder-strictness is not what these tests are about; switching it off
			// keeps `dateOf` from needing a real daily-notes path resolver.
			() => false,
		);

		const outcome = await service.applyTemplateIfBare(file as never);
		expect(outcome.status).toBe('not-bare');
		expect(state.writes).toBe(0);
		expect(text).toContain('My own notes from the meeting.');
	});

	it('an unreadable template writes nothing and says which it was', async () => {
		templateThrows = true;
		const { service, file, state } = fakeVault(BARE);
		const outcome = await service.applyTemplateIfBare(file);
		expect(outcome.status).toBe('template-unreadable');
		expect(state.writes).toBe(0);
		expect(state.text).toBe(BARE);
	});

	it('an EMPTY template writes nothing — it would otherwise blank the note', async () => {
		templateRaw = '';
		const { service, file, state } = fakeVault(BARE);
		const outcome = await service.applyTemplateIfBare(file);
		expect(outcome.status).toBe('template-unreadable');
		expect(state.writes).toBe(0);
		expect(state.text).toBe(BARE);
	});

	it('a note with real prose is not bare, and is never touched', async () => {
		const mine = `${HEADING}\n- [ ] 11:00 - 12:00\n\nA paragraph I wrote.\n`;
		const { service, file, state } = fakeVault(mine);
		const outcome = await service.applyTemplateIfBare(file);
		expect(outcome.status).toBe('not-bare');
		expect(state.writes).toBe(0);
		expect(state.text).toBe(mine);
	});

	it('THE INVARIANT: no outcome both reports a loss and claims to have merged', async () => {
		for (const note of [BARE, `${HEADING}\n- [ ] 11:00 - 12:00\n`]) {
			const { service, file } = fakeVault(note);
			const outcome = await service.applyTemplateIfBare(file);
			if (outcome.status === 'would-lose-content') expect(outcome.dropped.length).toBeGreaterThan(0);
			// 'merged' carries no `dropped` field at all — the types make the
			// contradictory state unrepresentable, and this asserts it stays so.
			expect(outcome).not.toMatchObject({ status: 'merged', dropped: expect.anything() });
		}
	});
});
