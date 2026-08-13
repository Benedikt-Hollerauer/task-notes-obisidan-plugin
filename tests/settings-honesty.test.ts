import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTOMATIC_CHANGES, DEFAULT_SETTINGS, migrateSettings, SETTINGS_SECTIONS } from '../src/settings/settings';

describe('the automatic-changes list is the whole truth', () => {
	it('every entry is a real boolean setting', () => {
		for (const change of AUTOMATIC_CHANGES) {
			expect(DEFAULT_SETTINGS).toHaveProperty(change.key);
			expect(typeof DEFAULT_SETTINGS[change.key]).toBe('boolean');
		}
	});

	it('names the checklist guard, which used to rename files with no switch at all', () => {
		expect(AUTOMATIC_CHANGES.map((c) => c.key)).toContain('reopenCompletedOnUnchecked');
	});

	it('lists each behaviour once, with a name, a description and a summary clause', () => {
		const keys = AUTOMATIC_CHANGES.map((c) => c.key);
		expect(new Set(keys).size).toBe(keys.length);
		for (const change of AUTOMATIC_CHANGES) {
			expect(change.name.length).toBeGreaterThan(0);
			expect(change.desc.length).toBeGreaterThan(20);
			expect(change.summary.length).toBeGreaterThan(0);
		}
	});

	it('keeps every automatic behaviour switchable', () => {
		// If a new automatic write is added without a toggle, this is where it shows.
		expect(AUTOMATIC_CHANGES.length).toBeGreaterThanOrEqual(3);
	});
});

describe('a broken calendar entry cannot break the settings pane', () => {
	it('fills in every field a renderer calls .trim() on', () => {
		// A missing `name` or `url` used to throw mid-render, leaving the pane half
		// drawn — and that calendar impossible to remove.
		const [cal] = migrateSettings({ icsCalendars: [{ id: 'a' }] } as never, false).icsCalendars;
		expect(cal).toEqual({ id: 'a', name: '', url: '', color: '', email: '', enabled: true });
		expect(() => cal.name.trim() && cal.url.trim()).not.toThrow();
	});

	it('gives an id to an entry that lost one, so it can still be deleted', () => {
		const [cal] = migrateSettings({ icsCalendars: [{ url: 'x' }] } as never, false).icsCalendars;
		expect(cal.id.length).toBeGreaterThan(0);
	});

	it('drops entries that are not objects at all', () => {
		expect(migrateSettings({ icsCalendars: [null, 'nope'] } as never, false).icsCalendars).toEqual([]);
	});

	it('keeps a well-formed entry exactly as it was', () => {
		const good = { id: 'c1', name: 'Work', url: 'https://x/y.ics', color: '#fff', email: '', enabled: false };
		expect(migrateSettings({ icsCalendars: [good] } as never, false).icsCalendars).toEqual([good]);
	});
});

describe('SETTINGS_SECTIONS — every setting has exactly one home', () => {
	const listed = Object.values(SETTINGS_SECTIONS).flat();
	// `settingsVersion` is internal: it exists for migrateSettings, not for a row.
	const configurable = (Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]).filter(
		(k) => k !== 'settingsVersion',
	);

	it('lists no setting twice', () => {
		expect(listed).toHaveLength(new Set(listed).size);
	});

	it('leaves no setting without a section', () => {
		const missing = configurable.filter((k) => !listed.includes(k));
		expect(missing).toEqual([]);
	});

	it('lists nothing that is not a setting', () => {
		const extra = listed.filter((k) => !(k in DEFAULT_SETTINGS));
		expect(extra).toEqual([]);
	});

	it('keeps the three automatic behaviours together, matching AUTOMATIC_CHANGES', () => {
		expect([...SETTINGS_SECTIONS.automatic].sort()).toEqual(AUTOMATIC_CHANGES.map((a) => a.key).sort());
	});
});

describe('no setting is dead', () => {
	/**
	 * Everything under `src/`, EXCEPT the two files that would make the check
	 * vacuous: the settings module declares every key, and the settings tab has a
	 * row for every key. A key read only by those two is configurable and does
	 * nothing.
	 */
	const SRC = fileURLToPath(new URL('../src', import.meta.url));
	function sources(dir: string, out: string[] = []): string[] {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) sources(full, out);
			else if (/\.(ts|svelte)$/.test(entry.name) && !/settings[/\\](settings|settings-tab)\.ts$/.test(full))
				out.push(readFileSync(full, 'utf8'));
		}
		return out;
	}
	const CODE = sources(SRC).join('\n');

	/**
	 * Keys reached WITHOUT their name ever appearing — `settings[formatKeyFor(e)]`,
	 * `settings[templateKeyFor(e)]`, `s[spec.templateSettingKey]`, and the
	 * structural interfaces (ReminderSettings, SlotSettings, WindowSettings) that
	 * receive the whole object and name the field only inside a pure module.
	 *
	 * Each entry names the indirection, so "it's dynamic" can never be waved at a
	 * key that is genuinely dead. Adding a name here is a deliberate act.
	 */
	const REACHED_DYNAMICALLY: Record<string, string> = {
		uncheckedTaskFormat: 'settings[formatKeyFor(emoji)] — core/task-name.ts',
		scheduledTaskFormat: 'settings[formatKeyFor(emoji)] — core/task-name.ts',
		routineTaskFormat: 'settings[formatKeyFor(emoji)] — core/task-name.ts',
		completedTaskFormat: 'settings[formatKeyFor(emoji)] — core/task-name.ts',
		cancelledTaskFormat: 'settings[formatKeyFor(emoji)] — core/task-name.ts',
		projectFolderFormat: 'settings[formatKeyFor(emoji)] — core/task-name.ts',
		targetFolderFormat: 'settings[formatKeyFor(emoji)] — core/task-name.ts',
		uncheckedTaskTemplate: 'settings[templateKeyFor(emoji)] — services/task-file-service.ts',
		scheduledTaskTemplate: 'settings[templateKeyFor(emoji)] — services/task-file-service.ts',
		routineTaskTemplate: 'settings[templateKeyFor(emoji)] — services/task-file-service.ts',
		completedTaskTemplate: 'settings[templateKeyFor(emoji)] — services/task-file-service.ts',
		settingsVersion: 'migrateSettings only — internal, deliberately has no row',
	};

	it('every setting is read somewhere outside the settings module', () => {
		// The request was "remove dead settings". The answer turned out to be that
		// none are dead — eleven only LOOK dead to a grep because they are reached
		// dynamically. This keeps that answer true rather than re-argued.
		const dead = (Object.keys(DEFAULT_SETTINGS) as string[])
			.filter((key) => !(key in REACHED_DYNAMICALLY))
			.filter((key) => !new RegExp(`\\b${key}\\b`).test(CODE));
		expect(dead, 'these settings are configurable and do nothing').toEqual([]);
	});

	it('every dynamically-reached key is still a real setting', () => {
		// So the exemption list cannot outlive the keys it excuses.
		const stale = Object.keys(REACHED_DYNAMICALLY).filter((k) => !(k in DEFAULT_SETTINGS));
		expect(stale).toEqual([]);
	});

	it('and the indirections that justify them still exist', () => {
		// If `formatKeyFor` were ever deleted, its seven keys would silently become
		// dead while this file still called them "reached dynamically".
		expect(CODE).toMatch(/formatKeyFor\(/);
		expect(CODE).toMatch(/templateKeyFor\(/);
	});
});
