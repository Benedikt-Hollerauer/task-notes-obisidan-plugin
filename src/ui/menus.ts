import { App, Menu, TFile, TFolder, type TAbstractFile } from 'obsidian';
import type { TaskProperties } from '../types';
import type { TaskNotesSettings } from '../settings/settings';
import type { TaskFileService } from '../services/task-file-service';
import type { SyncEngine } from '../services/sync-engine';
import { TASK_EMOJIS, specsFor } from '../constants';
import { hasTaskEmoji, getNormalizedEmoji, normalizeEmoji } from '../core/emoji';
import { dotToMinutes } from '../core/timestamps';
import { getBasename, isMarkdownFile, isFolder, showMenuSafely } from '../lib/obsidian-utils';
import { TaskPropertiesModal } from './modals/task-properties-modal';
import { CustomEmojiModal } from './modals/custom-emoji-modal';

/** Builds the file-explorer / checkbox context-menu items and their actions. */
export class TaskMenus {
	constructor(
		private app: App,
		private taskFiles: TaskFileService,
		private syncEngine: SyncEngine,
		private getSettings: () => TaskNotesSettings,
	) {}

	/** Populate a menu passed by the `file-menu` workspace event. */
	addFileMenu(menu: Menu, item: TAbstractFile): void {
		if (!isMarkdownFile(item) && !isFolder(item)) return;
		this.populate(menu, item);
	}

	/** Build and show a standalone menu (used by the explorer checkbox right-click). */
	showContextMenu(item: TAbstractFile, event: MouseEvent): void {
		const menu = new Menu();
		this.populate(menu, item);
		menu.addSeparator();
		menu.addItem((mi) =>
			mi
				.setTitle('Use custom emoji')
				.setIcon('pencil')
				.onClick(() => this.promptCustomEmoji(item)),
		);
		showMenuSafely(menu, event);
	}

	/** Add the convert/status items for a file or folder to an existing menu. */
	populate(menu: Menu, item: TAbstractFile): void {
		if (hasTaskEmoji(getBasename(item))) {
			this.addStatusItems(menu, item);
		} else {
			this.addConvertItems(menu, item);
		}
	}

	private addConvertItems(menu: Menu, item: TAbstractFile): void {
		const kind = item instanceof TFolder ? 'folder' : 'file';
		for (const spec of specsFor(kind)) {
			menu.addItem((mi) =>
				mi
					.setTitle(`Convert to ${spec.menuLabel}`)
					.setIcon(spec.menuIcon)
					.onClick(() => this.convert(item, spec.emoji)),
			);
		}
	}

	private addStatusItems(menu: Menu, item: TAbstractFile): void {
		const current = getNormalizedEmoji(getBasename(item));
		const kind = item instanceof TFolder ? 'folder' : 'file';
		menu.addItem((mi) => mi.setTitle('Remove task status').setIcon('cross').onClick(() => void this.taskFiles.removeEmoji(item)));
		for (const spec of specsFor(kind)) {
			if (current === normalizeEmoji(spec.emoji)) continue;
			menu.addItem((mi) =>
				mi
					.setTitle(`Mark as ${spec.menuLabel}`)
					.setIcon(spec.menuIcon)
					.onClick(() => void this.taskFiles.changeStatus(item, spec.emoji)),
			);
		}
	}

	/** Open the properties modal, then convert (and, for 📅, link into the day plan). */
	convert(item: TAbstractFile, emoji: string): void {
		new TaskPropertiesModal(this.app, emoji, getBasename(item), this.getSettings(), (props) => {
			void this.doConvert(item, emoji, props);
		}).open();
	}

	private async doConvert(item: TAbstractFile, emoji: string, props: TaskProperties): Promise<void> {
		const ok = await this.taskFiles.convert(item, emoji, props);
		if (!ok) return;
		if (emoji === TASK_EMOJIS.SCHEDULED && props.startDate && item instanceof TFile) {
			const settings = this.getSettings();
			const start = props.time ? dotToMinutes(props.time) ?? settings.dayStartHour * 60 : settings.dayStartHour * 60;
			const end = start + settings.defaultEventDurationMinutes;
			await this.syncEngine.linkFileIntoDay(item.path, props.startDate, start, end);
		}
	}

	private promptCustomEmoji(item: TAbstractFile): void {
		const current = getNormalizedEmoji(getBasename(item));
		new CustomEmojiModal(this.app, current, (value) => {
			if (hasTaskEmoji(getBasename(item))) {
				void this.taskFiles.changeStatus(item, value);
			} else {
				void this.convert(item, value);
			}
		}).open();
	}
}
