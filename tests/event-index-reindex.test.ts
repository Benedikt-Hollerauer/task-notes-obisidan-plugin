import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { TFile } from 'obsidian';
import { EventIndex } from '../src/services/event-index';
import { DEFAULT_SETTINGS, type TaskNotesSettings } from '../src/settings/settings';
import { localEventsStore } from '../src/state/stores';

function fixture(path: string, text: string, settings: TaskNotesSettings) {
	const file = new (TFile as unknown as new (path: string) => TFile)(path);
	const files = [file];
	let dailyEligible = true;
	const app = {
		vault: {
			getMarkdownFiles: () => files,
			cachedRead: async () => text,
			getAbstractFileByPath: (candidate: string) => files.find((entry) => entry.path === candidate) ?? null,
		},
		metadataCache: { getFirstLinkpathDest: () => null },
	};
	const daily = {
		dateOf: () => (dailyEligible ? '2026-08-20' : null),
		templatePath: () => '',
	};
	const index = new EventIndex(app as never, daily as never, () => settings);
	return { index, file, setDailyEligible: (next: boolean) => (dailyEligible = next) };
}

describe('EventIndex.reindexAll — settings take effect without a reload', () => {
	let settings: TaskNotesSettings;

	beforeEach(() => {
		settings = { ...DEFAULT_SETTINGS, icsCalendars: [] };
		localEventsStore.set({ version: 0, events: [] });
	});

	it('discovers a date note that becomes eligible under the folder policy', async () => {
		const f = fixture('Archive/2026-08-20.md', '## Day planner\n- [ ] 09:00 - 10:00 Focus', settings);
		f.setDailyEligible(false);
		await f.index.initialScan();
		expect(get(localEventsStore).events).toEqual([]);

		f.setDailyEligible(true);
		await f.index.reindexAll();
		expect(get(localEventsStore).events.map((event) => event.title)).toEqual(['Focus']);
	});

	it('adds and removes a note as its template exclusion changes', async () => {
		const path = 'Templates/2026-08-20.md';
		const f = fixture(path, '## Day planner\n- [ ] 09:00 - 10:00 Template row', settings);
		settings.uncheckedTaskTemplate = path;
		await f.index.initialScan();
		expect(get(localEventsStore).events).toEqual([]);

		settings.uncheckedTaskTemplate = '';
		await f.index.reindexAll();
		expect(get(localEventsStore).events).toHaveLength(1);

		settings.uncheckedTaskTemplate = path;
		await f.index.reindexAll();
		expect(get(localEventsStore).events).toEqual([]);
	});

	it('reparses heading, plain-text visibility, and default duration', async () => {
		const note = [
			'## Day planner',
			'- [ ] 09:00 Plain timed row',
			'## Alternate',
			'- [ ] Untimed alternate row',
		].join('\n');
		const f = fixture('2026-08-20.md', note, settings);
		await f.index.initialScan();
		let events = get(localEventsStore).events;
		expect(events.map((event) => event.title)).toEqual(['Plain timed row']);
		expect(events[0]?.endMinutes).toBe(10 * 60);

		settings.defaultEventDurationMinutes = 30;
		settings.plannerHeading = '## Alternate';
		await f.index.reindexAll();
		events = get(localEventsStore).events;
		expect(events.map((event) => event.title)).toEqual(['Untimed alternate row', 'Plain timed row']);
		expect(events.find((event) => event.title === 'Plain timed row')?.endMinutes).toBe(9 * 60 + 30);

		settings.showPlainTextBlocks = false;
		await f.index.reindexAll();
		expect(get(localEventsStore).events).toEqual([]);
	});
});
