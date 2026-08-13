import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice, TFile } from 'obsidian';
import { SyncEngine } from '../src/services/sync-engine';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import type { LocalEvent } from '../src/types';

function file(path: string): TFile {
	return new (TFile as unknown as new (path: string) => TFile)(path);
}

describe('cross-day partial move', () => {
	const TestNotice = Notice as unknown as { reset(): void; shown: string[] };
	beforeEach(() => TestNotice.reset());

	it('reports a successful insert plus stale removal and suppresses the rename', async () => {
		const oldFile = file('2026-08-20.md');
		const targetFile = file('2026-08-21.md');
		const sourceLine = '- [ ] 09:00 - 10:00 [[📅 By 2026-08-20, focus - one - report]]';
		const sourceInitial = `## Day planner\n${sourceLine}`;
		let sourceCurrent = '## Day planner\n- [ ] 09:00 - 10:00 The line changed meanwhile';
		let targetCurrent = '## Day planner\n';
		const app = {
			vault: {
				getFileByPath: (path: string) =>
					path === oldFile.path ? oldFile : path === targetFile.path ? targetFile : null,
				read: async () => sourceInitial,
				process: async (target: TFile, change: (content: string) => string) => {
					if (target === targetFile) targetCurrent = change(targetCurrent);
					else sourceCurrent = change(sourceCurrent);
				},
			},
		};
		const daily = {
			getOrCreateBare: async () => targetFile,
			pathFor: (day: string) => `${day}.md`,
		};
		const index = { flushNow: async () => undefined };
		const engine = new SyncEngine(app as never, index as never, daily as never, () => DEFAULT_SETTINGS);
		const reconcile = vi.fn(async () => undefined);
		(engine as unknown as { reconcileNow: typeof reconcile }).reconcileNow = reconcile;
		const event: LocalEvent = {
			kind: 'local',
			id: `${oldFile.path}::1`,
			title: 'focus',
			date: '2026-08-20',
			startMinutes: 9 * 60,
			endMinutes: 10 * 60,
			checked: false,
			linked: true,
			inDayPlan: true,
			filePath: '📅 By 2026-08-20, focus - one - report.md',
			placement: {
				dailyNotePath: oldFile.path,
				date: '2026-08-20',
				lineNo: 1,
				raw: sourceLine,
				status: ' ',
				checked: false,
			},
		};

		await engine.applyBlockEdit(event, '2026-08-21', 11 * 60, 12 * 60);

		expect(targetCurrent).toContain('11:00 - 12:00');
		expect(sourceCurrent).toContain('The line changed meanwhile');
		expect(TestNotice.shown.some((message) => /partly completed/i.test(message))).toBe(true);
		expect(reconcile).not.toHaveBeenCalled();
	});
});
