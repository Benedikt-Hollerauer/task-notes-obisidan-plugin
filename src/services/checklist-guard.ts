import { App, Plugin, TFile, TAbstractFile, type CachedMetadata } from 'obsidian';
import { structuredNotice } from '../lib/obsidian-utils';
import { TASK_EMOJIS } from '../constants';
import { getNormalizedEmoji, normalizeEmoji } from '../core/emoji';
import { hasUncheckedItem } from '../core/checklist';
import type { TaskFileService } from './task-file-service';
import type { TaskNotesSettings } from '../settings/settings';

/**
 * Auto-reopen guard: when a ✅ completed task's body gains a new unchecked `- [ ]`
 * item, revert it to ◻️. Reads the metadataCache ListItemCache (no file reads).
 */
export class ChecklistGuard {
	private hasUnchecked = new Map<string, boolean>();

	constructor(
		private app: App,
		private taskFiles: TaskFileService,
		private getSettings: () => TaskNotesSettings,
	) {}

	register(plugin: Plugin): void {
		plugin.registerEvent(
			this.app.metadataCache.on('changed', (file, _data, cache) => {
				void this.onChanged(file, cache);
			}),
		);
		plugin.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => this.onRename(file, oldPath)),
		);
		plugin.registerEvent(this.app.vault.on('delete', (file) => this.hasUnchecked.delete(file.path)));
		// Metadata is usually still indexing at layout-ready; re-seed once it lands.
		plugin.registerEvent(this.app.metadataCache.on('resolved', () => this.seed()));
	}

	/**
	 * Seed the per-file state from the metadata cache (call on layout ready).
	 *
	 * Files with no cache yet are deliberately SKIPPED rather than recorded as
	 * "no unchecked items": on a cold start the cache is still indexing, and a
	 * false seed would make every ✅ note containing an unchecked box look like it
	 * just gained one — auto-renaming it to ◻️. onChanged already handles an
	 * unseeded file safely (it records without acting).
	 */
	seed(): void {
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (this.hasUnchecked.has(file.path)) continue;
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;
			this.hasUnchecked.set(file.path, this.cacheHasUnchecked(cache));
		}
	}

	private cacheHasUnchecked(cache: CachedMetadata | null): boolean {
		return hasUncheckedItem(cache?.listItems);
	}

	private onRename(file: TAbstractFile, oldPath: string): void {
		const prev = this.hasUnchecked.get(oldPath);
		if (typeof prev === 'boolean') {
			this.hasUnchecked.delete(oldPath);
			this.hasUnchecked.set(file.path, prev);
		}
	}

	private async onChanged(file: TFile, cache: CachedMetadata): Promise<void> {
		const prev = this.hasUnchecked.get(file.path);
		const now = this.cacheHasUnchecked(cache);

		if (typeof prev !== 'boolean') {
			this.hasUnchecked.set(file.path, now);
			return;
		}

		const shouldReopen =
			!prev && now && getNormalizedEmoji(file.basename) === normalizeEmoji(TASK_EMOJIS.CHECKED);
		// The state is recorded either way, so switching the setting back on later
		// does not retro-fire on every note that changed while it was off.
		if (shouldReopen && this.getSettings().reopenCompletedOnUnchecked) {
			// Announced AFTER the write, and only if it happened: `changeStatus` can
			// refuse (not a task note) or fail (a name collision), and this used to
			// claim success either way. It is also the plugin's only UNREQUESTED
			// rename, so it is the one notice that must name the file.
			const reopened = await this.taskFiles.changeStatus(file, TASK_EMOJIS.UNCHECKED);
			if (reopened) {
				structuredNotice('Reopened to ◻️ — it has unchecked items again', file.basename, {
					warn: true,
				});
			}
		}
		this.hasUnchecked.set(file.path, now);
	}
}
