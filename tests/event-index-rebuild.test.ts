// @vitest-environment happy-dom
// (EventIndex.scheduleFlush uses window.setTimeout; the node env has no window.)
// THE REBUILD THAT RAN FOR NOTHING.
//
// `flushInner` ended with an unconditional `rebuild()`. That call walks every
// DayPlan in the index, resolves every linked planner line through the metadata
// cache, and re-allocates the whole published event list.
//
// `metadataCache.on('changed')` fires for EVERY markdown file, so typing in a
// note that is neither a daily note nor a 📅 file — `Projects/Roadmap.md`, say —
// paid for that full rebuild, twice a second, for a file the index does not even
// store. With a year of daily notes behind it that is the whole vault's event
// list rebuilt on every keystroke in an unrelated note.
//
// The guard has to be exactly right in BOTH directions: skipping a rebuild that
// was needed means the timeline silently stops updating, which is worse than the
// cost it saves. These tests pin both.

import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { TFile } from 'obsidian';
import { EventIndex } from '../src/services/event-index';
import { DEFAULT_SETTINGS, type TaskNotesSettings } from '../src/settings/settings';
import { localEventsStore } from '../src/state/stores';

const DAILY = 'Daily/2026-08-20.md';
const UNRELATED = 'Projects/Roadmap.md';

/** A vault of two notes: one daily note, one ordinary note. */
function vault(settings: TaskNotesSettings) {
	const mk = (p: string) => new (TFile as unknown as new (path: string) => TFile)(p);
	const files = [mk(DAILY), mk(UNRELATED)];
	const text = new Map<string, string>([
		[DAILY, '## Day planner\n- [ ] 09:00 - 10:00 Focus'],
		[UNRELATED, '# Roadmap\nSome prose.'],
	]);
	let rebuilds = 0;
	// The real dirty-marking path: `register` subscribes to vault/metadata events,
	// so the test drives the index exactly the way Obsidian does rather than
	// reaching for a method that does not exist.
	const handlers = new Map<string, (f: TFile, ...rest: unknown[]) => void>();
	const on = (name: string, cb: (f: TFile, ...rest: unknown[]) => void) => {
		handlers.set(name, cb);
		return { name };
	};
	const app = {
		vault: {
			getMarkdownFiles: () => files,
			cachedRead: async (f: TFile) => text.get(f.path) ?? '',
			getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null,
			on,
		},
		// Counting here: `rebuild()` is the only thing that resolves link targets,
		// so a call proves a rebuild happened without reaching into private state.
		metadataCache: {
			on,
			getFirstLinkpathDest: () => {
				rebuilds++;
				return null;
			},
		},
	};
	const daily = {
		dateOf: (f: TFile) => (f.path === DAILY ? '2026-08-20' : null),
		templatePath: () => '',
	};
	const index = new EventIndex(app as never, daily as never, () => settings);
	index.register({ registerEvent: () => undefined } as never);
	/** Fire what Obsidian fires when a note's content changes, then flush. */
	const touch = async (path: string) => {
		handlers.get('changed')?.(files.find((f) => f.path === path)!);
		await index.flushNow();
	};
	return {
		index,
		touch,
		rebuilds: () => rebuilds,
		setText: (p: string, next: string) => text.set(p, next),
		events: () => get(localEventsStore).events,
		version: () => get(localEventsStore).version,
	};
}

describe('a flush only rebuilds when the index actually changed', () => {
	let settings: TaskNotesSettings;

	beforeEach(() => {
		settings = { ...DEFAULT_SETTINGS, icsCalendars: [] };
		localEventsStore.set({ version: 0, events: [] });
	});

	it('THE FIX: editing a note the index does not hold publishes nothing new', async () => {
		const v = vault(settings);
		await v.index.initialScan();
		const before = v.version();

		await v.touch(UNRELATED);

		// No republish: the store's version is what every view keys off.
		expect(v.version()).toBe(before);
	});

	it('THE SAFETY: editing the daily note still republishes', async () => {
		const v = vault(settings);
		await v.index.initialScan();
		const before = v.version();

		v.setText(DAILY, '## Day planner\n- [ ] 09:00 - 10:00 Focus\n- [ ] 11:00 - 12:00 Review');
		await v.touch(DAILY);

		expect(v.version()).toBeGreaterThan(before);
		expect(v.events()).toHaveLength(2);
	});

	it('a note that LEAVES the index republishes too', async () => {
		const v = vault(settings);
		await v.index.initialScan();
		expect(v.events()).toHaveLength(1);
		const before = v.version();

		// It is still a daily note, but it no longer has any planner line.
		v.setText(DAILY, '## Day planner');
		await v.touch(DAILY);

		expect(v.version()).toBeGreaterThan(before);
		expect(v.events()).toHaveLength(0);
	});
});
