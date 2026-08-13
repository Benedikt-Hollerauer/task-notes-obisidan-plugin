import { App, TFile, type TAbstractFile, Notice, normalizePath } from 'obsidian';
import type { TaskNotesSettings } from '../settings/settings';
import type { TaskProperties } from '../types';
import { TASK_EMOJIS, templateKeyFor, isDoneRole } from '../constants';
import {
	extractTaskName,
	hasTaskEmoji,
	shouldApplyConvertTemplate,
	activePrefixOf,
	taskBasename,
} from '../core/emoji';
import { getTaskFormatByEmoji, generateTaskName } from '../core/task-name';
import { hasScheduledDatePart } from '../core/event-filename';
import { interpolateTemplate } from '../core/template-merge';
import { areAllTodosChecked } from '../core/checklist';
import { getBasename, notifyError, errorMessage, structuredNotice } from '../lib/obsidian-utils';

/**
 * Characters a filename cannot carry on the platforms Obsidian runs on. A remote
 * calendar title is arbitrary user text from someone else's machine, so it is the
 * one source of task names we do not control at all.
 */
function sanitizeBasename(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** File-level task operations: rename, convert, status change, template application. */
export class TaskFileService {
	constructor(
		private app: App,
		private getSettings: () => TaskNotesSettings,
	) {}

	/** Rename a task file/folder to a new basename (path is derived, links update). */
	async renameFile(item: TAbstractFile, newBasename: string): Promise<boolean> {
		const suffix = item instanceof TFile ? `.${item.extension}` : '';
		const newPath = item.parent && item.parent.path
			? `${item.parent.path}/${newBasename}${suffix}`
			: `${newBasename}${suffix}`;
		try {
			await this.app.fileManager.renameFile(item, normalizePath(newPath));
			return true;
		} catch (error) {
			notifyError(`Failed to rename: ${errorMessage(error)}`, error);
			return false;
		}
	}

	/** Strip the emoji prefix, turning a task back into a normal note/folder. */
	async removeEmoji(item: TAbstractFile): Promise<void> {
		if (!hasTaskEmoji(getBasename(item))) return;
		const nameWithoutEmoji = extractTaskName(getBasename(item));
		if (await this.renameFile(item, nameWithoutEmoji)) {
			new Notice(`Removed task status from: ${nameWithoutEmoji}`);
		}
	}

	/**
	 * Change an existing task's status emoji, keeping the rest of the name.
	 *
	 * Returns whether the file was actually renamed. It used to return void, so a
	 * caller could not tell a refusal from a success — and the checklist guard
	 * announced "Reopening task to ◻️" whether or not anything happened.
	 */
	async changeStatus(item: TAbstractFile, newEmoji: string): Promise<boolean> {
		if (!hasTaskEmoji(getBasename(item))) return false;

		if (!(await this.mayMarkChecked(item, newEmoji))) return false;

		const rawTaskName = extractTaskName(getBasename(item));
		const newName = taskBasename(newEmoji, rawTaskName, activePrefixOf(getBasename(item)));

		// A DATED type must end up with a date in its name. changeStatus swaps the
		// emoji and keeps the rest, so ◻️ → 📅 on an undated name used to mint a
		// scheduled note with nothing scheduled — `📅 Practise - 0s - …` in the
		// corpus is one. Spec-driven, not emoji-keyed: any future type whose
		// format carries {date} gets the same guard for free.
		const format = getTaskFormatByEmoji(newEmoji, this.getSettings());
		if (format.includes('{date}') && !hasScheduledDatePart(newName, format)) {
			structuredNotice(
				'Not changed — this type needs a date',
				`${getBasename(item)} — use the properties panel, which asks for one`,
				{ warn: true },
			);
			return false;
		}

		const previousBasename = getBasename(item);
		const renamed = await this.renameFile(item, newName);
		if (renamed && item instanceof TFile) {
			await this.applyTemplateOnAdopt(item, previousBasename, newEmoji);
		}
		return renamed;
	}

	/**
	 * The template for a type a note has just ADOPTED — for the routes that change
	 * a type IN PLACE: the properties panel's Apply, the right-click "Mark as …"
	 * menu, and "Use custom emoji". They keep the existing name and swap only the
	 * emoji, where `convert` rebuilds the whole basename from supplied properties —
	 * a different operation, not a cheaper one.
	 *
	 * `forceApply: false` IS the safety story, not a detail. It leaves only the
	 * empty-note branch of `applyTemplate` reachable, which means:
	 *   - a note that already holds ANYTHING is renamed and never written to;
	 *   - switching ◻️ → 📅 → ◻️ → 📅 cannot stack copies, so the v3.8
	 *     double-template bug cannot return through this new door;
	 *   - the automatic ✅ → ◻️ reopen guard can share this path safely, because
	 *     that guard only fires on a note that just gained an unchecked item and
	 *     is therefore never empty.
	 *
	 * @param previousBasename the name BEFORE the rename. `shouldApplyConvertTemplate`
	 *   reads the current type off the filename; after the rename that is already
	 *   the NEW type, which would make every adoption look like a no-op.
	 */
	async applyTemplateOnAdopt(file: TFile, previousBasename: string, emoji: string): Promise<void> {
		// A done or dropped type is the END of a lifecycle, not a note to start
		// filling in. It is also actively dangerous here: a completed template that
		// contains unchecked items — which is exactly what this vault's does —
		// would trip `reopenCompletedOnUnchecked` and rename the note the user just
		// completed straight back to ◻️.
		if (isDoneRole(emoji)) return;
		if (!shouldApplyConvertTemplate(previousBasename, emoji, this.getSettings().applyTemplateOnConvert)) {
			return;
		}
		try {
			await this.applyTemplate(file, emoji, false);
		} catch (error) {
			notifyError('Failed to apply template', error);
		}
	}

	/**
	 * May `item` be renamed to `newEmoji`? Refuses ✅ while unchecked items remain.
	 *
	 * Public because there are now TWO ways to change a note's type — the
	 * right-click menu (via `changeStatus`) and the properties panel's Apply,
	 * which renames directly — and a guard only one of them honours is not a
	 * guard. Says why it refused; returns true when there is nothing to refuse.
	 */
	async mayMarkChecked(item: TAbstractFile, newEmoji: string): Promise<boolean> {
		if (newEmoji !== TASK_EMOJIS.CHECKED || !(item instanceof TFile)) return true;
		if (await this.allTodosChecked(item)) return true;
		// Named, and warning-coloured: this is a refusal to write, and it used to
		// be one grey line among every other notice the app puts up.
		structuredNotice('Not marked done — it still has unchecked items', getBasename(item), {
			warn: true,
		});
		return false;
	}

	/** Convert a plain file/folder into a task using explicit properties. */
	async convert(item: TAbstractFile, emoji: string, props: TaskProperties): Promise<boolean> {
		// The THIRD way to reach ✅, and it used to be the one that skipped the
		// completion guard entirely — `mayMarkChecked`'s own doc said there were
		// two. "Convert to completed ✅" on a note full of unchecked boxes marked
		// it done anyway, which is precisely what the guard exists to refuse.
		if (!(await this.mayMarkChecked(item, emoji))) return false;

		const settings = this.getSettings();
		const format = getTaskFormatByEmoji(emoji, settings);
		const taskName = generateTaskName(props, format);
		// The 🅰️ prefix is CARRIED, not dropped. `convert` is also how "Link into day
		// plan" renames a note that is already 📅, so losing it here silently
		// de-marked the note and rewrote every wikilink to it.
		const newName = taskBasename(emoji, taskName, activePrefixOf(getBasename(item)));

		// Only when the note is genuinely BECOMING this type. It used to apply on
		// every call, and `convert` is also how "add to the day plan" renames a note
		// that is already 📅 — so the template was appended to the note a second
		// time. See shouldApplyConvertTemplate for the full story.
		const isNewType = shouldApplyConvertTemplate(
			getBasename(item),
			emoji,
			settings.applyTemplateOnConvert,
		);
		if (await this.renameFile(item, newName)) {
			// AFTER the rename, never before. Templating first meant a rename that
			// failed (a name collision) still left the template appended to the
			// user's note — while telling them the operation had failed. Repeating
			// it then appended a second copy.
			// `isDoneRole` for the same reason `applyTemplateOnAdopt` has it, and it
			// belongs here too: a done type is the END of a lifecycle, not a note to
			// start filling in. Moving the template AFTER the rename (just above)
			// turned that from a race into a certainty — the write now lands while
			// the name already reads ✅, so a completed template containing unchecked
			// items (which is exactly what this vault's is) trips
			// `reopenCompletedOnUnchecked` and renames the note the user just
			// completed straight back to ◻️, rewriting every wikilink to it.
			//
			// Kept out of `isNewType` deliberately: that flag also picks the notice
			// wording, and converting a plain note to ✅ IS a conversion even though
			// it gets no template.
			if (item instanceof TFile && isNewType && !isDoneRole(emoji)) {
				try {
					await this.applyTemplate(item, emoji, true);
				} catch (error) {
					notifyError('Failed to apply template', error);
				}
			}
			// Say what happened. "Converted to task" was printed even when nothing
			// was converted — the add-to-plan flow renames an existing task note.
			new Notice(isNewType ? `Converted to task: ${newName}` : `Renamed to: ${newName}`);
			return true;
		}
		return false;
	}

	/**
	 * Create a NEW task note from properties, in the vault root.
	 *
	 * `convert` renames a file that already exists; this is for a task that has no
	 * file yet — currently the "convert a calendar event into my format" path,
	 * where the source is a read-only remote occurrence.
	 *
	 * Refuses rather than overwrites when the name is taken: two different events
	 * can easily generate one filename, and silently merging them would lose one.
	 */
	async createTaskNote(emoji: string, props: TaskProperties): Promise<TFile | null> {
		const settings = this.getSettings();
		const format = getTaskFormatByEmoji(emoji, settings);
		const taskName = generateTaskName(props, format);
		// No prefix: this file does not exist yet, so there is no marker to carry.
		const basename = taskBasename(emoji, taskName);
		return this.createNoteNamed(basename, (file) => this.applyTemplate(file, emoji, true));
	}

	/**
	 * Create an ORDINARY note — no emoji, no filename grammar, just the title you
	 * typed.
	 *
	 * The timeline can schedule this exactly like a task note: what puts an item
	 * on the grid is its planner LINE, and a link line works for any note at all.
	 * What it does not get is a name the grammar can read, so renaming it never
	 * reschedules anything and rescheduling it never renames it — which is the
	 * point of choosing "note" over a type.
	 */
	async createPlainNote(title: string): Promise<TFile | null> {
		return this.createNoteNamed(title.trim());
	}

	/**
	 * The one create-a-note-here routine: Obsidian's own default folder, a
	 * sanitised name, and a REFUSAL rather than an overwrite when that name is
	 * taken — two different events can easily generate one filename, and silently
	 * merging them would lose one.
	 */
	private async createNoteNamed(
		basename: string,
		after?: (file: TFile) => Promise<void>,
	): Promise<TFile | null> {
		const safe = sanitizeBasename(basename);
		if (!safe) {
			new Notice('That name has no characters a filename can carry — nothing was created.');
			return null;
		}
		// Obsidian's own "Default location for new notes" — the same folder the
		// app would use, honouring "same folder as current file" too. This used to
		// hardcode the vault root and ignore the setting entirely.
		//
		// The active file is what makes "same folder as current file" mean
		// anything: with an empty source path Obsidian has nothing to derive a
		// folder from and falls back to the root, so that setting silently did
		// nothing — the comment above claimed otherwise for two releases.
		const from = this.app.workspace.getActiveFile()?.path ?? '';
		const folder = this.app.fileManager.getNewFileParent(from).path;
		const path = normalizePath(folder ? `${folder}/${safe}.md` : `${safe}.md`);

		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice(`A note called "${safe}" already exists — nothing was created.`);
			return null;
		}
		let file: TFile;
		try {
			file = await this.app.vault.create(path, '');
		} catch (error) {
			notifyError(`Failed to create the note: ${errorMessage(error)}`, error);
			return null;
		}
		new Notice(`Created ${safe}`);

		// The template is applied to a note that ALREADY EXISTS, so its failure is
		// reported as its own thing. Sharing one try meant a template error was
		// announced as "Failed to create the note" and returned null — the caller
		// then skipped the planner line, leaving a real note stranded with no link
		// to it and the user told it had not been created.
		try {
			await after?.(file);
		} catch (error) {
			notifyError(`The note was created, but its template did not apply: ${errorMessage(error)}`, error);
		}
		return file;
	}

	/** True if the note has no unchecked todos (the completion guard). */
	async allTodosChecked(file: TFile): Promise<boolean> {
		try {
			return areAllTodosChecked(await this.app.vault.cachedRead(file));
		} catch (e) {
			// FAIL CLOSED. This gates marking a note ✅, and a rename is the write it
			// gates. "I could not read the note" is not evidence that everything in
			// it is done, so refusing is the only honest answer — the user is told
			// why by the caller and can tick it by hand.
			console.error('Task Notes: failed to read file for todo guard', e);
			return false;
		}
	}

	/** Apply a status-specific template to a file (only when empty, or force-append). */
	async applyTemplate(file: TFile, emoji: string, forceApply = false): Promise<void> {
		const settings = this.getSettings();
		const templateKey = templateKeyFor(emoji);
		const templatePath = templateKey ? settings[templateKey] : '';
		if (!templatePath || !templatePath.trim()) return;

		const templateFile = this.resolveTemplateFile(templatePath.trim());
		if (!templateFile) {
			new Notice(`Template not found: ${templatePath}`);
			return;
		}

		const templateContent = await this.app.vault.cachedRead(templateFile);
		if (!templateContent) return;

		const processed = this.processTemplateVariables(templateContent, file);
		// The process callback must stay pure (it may be re-invoked) — notify after.
		let outcome: 'applied' | 'appended' | null = null;
		await this.app.vault.process(file, (current) => {
			if (current.trim().length === 0) {
				outcome = 'applied';
				return processed;
			}
			if (forceApply) {
				outcome = 'appended';
				return `${current}\n\n${processed}`;
			}
			outcome = null;
			return current;
		});
		if (outcome === 'applied') new Notice('Template applied');
		else if (outcome === 'appended') new Notice('Template appended');
	}

	private resolveTemplateFile(rawPath: string): TFile | null {
		const path = normalizePath(rawPath);
		const direct = this.app.vault.getFileByPath(path);
		if (direct) return direct;
		if (!path.endsWith('.md')) {
			const withExt = this.app.vault.getFileByPath(`${path}.md`);
			if (withExt) return withExt;
		}
		return null;
	}

	processTemplateVariables(content: string, file: TFile): string {
		// One interpolation implementation for daily-note and task templates —
		// local-time dates, `{{date:FORMAT}}` support, injection-safe replacers.
		return interpolateTemplate(content, null, extractTaskName(file.basename));
	}

	/**
	 * Every note is offerable as a template.
	 *
	 * This used to filter to the core Templates plugin's folder, read by casting
	 * `app` to reach `internalPlugins` — an undocumented API, and one the plugin
	 * review guidelines call out. Dropping the cast costs nothing and fixes a real
	 * limitation on the way past: a template kept anywhere else could not be
	 * SUGGESTED at all, even though typing its path by hand always worked. The
	 * suggester filters as you type, which is what actually narrows the list.
	 */
	getTemplateFiles(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

}
