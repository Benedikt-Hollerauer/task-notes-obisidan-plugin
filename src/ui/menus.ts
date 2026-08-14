import { App, Menu, TFolder, type TAbstractFile } from 'obsidian';
import type { TaskProperties } from '../types';
import type { TaskNotesSettings } from '../settings/settings';
import type { TaskFileService } from '../services/task-file-service';
import { specsFor } from '../constants';
import { hasTaskEmoji, getNormalizedEmoji, normalizeEmoji } from '../core/emoji';
import { getBasename, isMarkdownFile, isFolder, showMenuSafely } from '../lib/obsidian-utils';
import { TaskPropertiesModal } from './modals/task-properties-modal';
import { confirm } from './modals/simple-modals';
import { CustomEmojiModal } from './modals/custom-emoji-modal';

/** Builds the file-explorer / checkbox context-menu items and their actions. */
export class TaskMenus {
	constructor(
		private app: App,
		private taskFiles: TaskFileService,
		private getSettings: () => TaskNotesSettings,
		/**
		 * Is this file one of the user's daily notes?
		 *
		 * Injected rather than derived here because `DailyNoteService` owns the
		 * answer (it depends on the core Daily Notes settings and the strict-folder
		 * toggle), and the menus have no business re-deriving it.
		 */
		private isDailyNote: (item: TAbstractFile) => boolean = () => false,
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

	/** Open the properties modal, then rename the note to the type it chose. */
	convert(item: TAbstractFile, emoji: string): void {
		new TaskPropertiesModal(this.app, emoji, getBasename(item), this.getSettings(), (props) => {
			void this.doConvert(item, emoji, props);
		}).open();
	}

	private async doConvert(item: TAbstractFile, emoji: string, props: TaskProperties): Promise<void> {
		// A DAILY NOTE IS NOT A TASK. Renaming `2026-08-20.md` to `📅 By …` makes
		// the plugin stop recognising it: `dateOf` returns null, the index drops it,
		// that whole day disappears from the timeline, and its reminders stop. With
		// "apply templates on conversion" on, the scheduled template is appended to
		// the day plan on the way out.
		//
		// The item stays in the menu — this is a real thing to want occasionally —
		// but it now says what it costs first.
		if (this.isDailyNote(item)) {
			const proceed = await confirm(this.app, {
				title: 'Convert your daily note into a task note?',
				body:
					`"${getBasename(item)}" is a daily note. Converting it renames the file, and this ` +
					`plugin will no longer recognise it as that day:\n\n` +
					`• the day disappears from the timeline, along with everything planned on it\n` +
					`• its reminders stop\n` +
					`• its planner lines are no longer synced\n\n` +
					`Renaming it back restores all of it. Nothing is deleted either way.`,
				cta: 'Convert anyway',
			});
			if (!proceed) return;
		}

		// CONVERTING IS A RENAME, AND ONLY A RENAME.
		//
		// This used to also link the note into a day plan whenever it had a date —
		// the guard tested `props.startDate` and never `props.time`, and both
		// branches of the start expression came out at `dayStartHour * 60`. So
		// converting a note with a date and a blank Time field did three things
		// nobody asked for:
		//
		//   1. created or opened that day's daily note (`getOrCreateBare`), which is
		//      why notes appeared "linked to today" — and minted bare daily notes
		//      for future dates too;
		//   2. wrote `- [ ] 08:00 - 09:00 [[the note]]` into it;
		//   3. that edit dirtied the index, so `reconcile` renamed the FILE to match
		//      the line — stamping `at 08.00h` onto a name that never had a time,
		//      and rewriting every wikilink to it.
		//
		// Planning is a separate, deliberate gesture. A dated 📅 note with no
		// planner line is already drawn as a dashed "not in plan" block
		// (`buildUnlinkedEvent` → `linked: false`), and its ➕ is what schedules it —
		// showing the proposed time first. Drag → "New time block" → "Create as 📅"
		// still creates AND places in one step, because a drag supplies a real time.
		await this.taskFiles.convert(item, emoji, props);
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
