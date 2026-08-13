import { App, TFile, TFolder, normalizePath } from 'obsidian';
import {
	appHasDailyNotesPluginLoaded,
	getDailyNoteSettings,
	getDateFromFile,
	getTemplateInfo,
	DEFAULT_DAILY_NOTE_FORMAT,
} from 'obsidian-daily-notes-interface';
import { moment } from '../lib/moment';
import { buildBareDailyNote, isBareDailyNote } from '../core/bare-note';
import { buildLineTree } from '../core/line-tree';
import { getPlannerSection } from '../core/planner-section';
import { mergeTemplateIntoBareNote, type PreservedBlock } from '../core/template-merge';
import { isDailyNotePath, parentFolder } from '../core/daily-path';

/** Drop blank lines from the END of a block, keeping any the user left inside it. */
function dropTrailingBlank(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && (lines[end - 1] ?? '').trim().length === 0) end--;
	return lines.slice(0, end);
}

/** What applyTemplateIfBare did, so the caller can say something true. */
export type TemplateMergeOutcome =
	| { status: 'merged' }
	| { status: 'not-bare' }
	| { status: 'no-template' }
	| { status: 'template-unreadable'; error: unknown }
	/**
	 * The merge would have lost content, so NOTHING was written. `dropped` names
	 * the planner lines whose blocks could not be placed — usually because the
	 * template already carries a line with that exact text.
	 */
	| { status: 'would-lose-content'; dropped: string[] };

/**
 * Owns everything about daily-note identity and lifecycle. Reads the user's core
 * Daily Notes / Periodic Notes config via obsidian-daily-notes-interface, but
 * NEVER calls createDailyNote() (which applies the template early) — future notes
 * are created bare and the template is merged in later, when the day arrives.
 */
export class DailyNoteService {
	constructor(
		private app: App,
		private getHeading: () => string,
		private strictFolder: () => boolean = () => true,
	) {}

	/**
	 * False when neither core Daily Notes nor Periodic Notes is enabled.
	 *
	 * `getDailyNoteSettings()` cannot answer this: it swallows its own error and
	 * returns `{format:'YYYY-MM-DD', folder:''}` when the plugin is off. So the
	 * guard this backs never fired, and notes were created in the VAULT ROOT —
	 * the exact outcome the comment in getOrCreateBare says it prevents.
	 */
	private settingsAvailable(): boolean {
		try {
			return appHasDailyNotesPluginLoaded();
		} catch {
			return false;
		}
	}

	private settings(): { folder: string; format: string; template: string } {
		try {
			const s = getDailyNoteSettings();
			return {
				folder: (s.folder ?? '').trim(),
				format: s.format || DEFAULT_DAILY_NOTE_FORMAT,
				template: (s.template ?? '').trim(),
			};
		} catch {
			return { folder: '', format: DEFAULT_DAILY_NOTE_FORMAT, template: '' };
		}
	}

	/**
	 * The YYYY-MM-DD date a file represents, if it is a daily note, else null.
	 * The date comes from the filename, but the file must also LIVE where daily
	 * notes live — otherwise any date-named note in the vault would be treated as
	 * a day plan and could drive automatic renames.
	 */
	dateOf(file: TFile): string | null {
		let date: string | null = null;
		try {
			const m = getDateFromFile(file, 'day');
			date = m ? m.format('YYYY-MM-DD') : null;
		} catch {
			return null;
		}
		if (!date) return null;
		if (!this.strictFolder()) return date;
		return isDailyNotePath(file.path, this.pathFor(date)) ? date : null;
	}

	isDailyNote(file: TFile): boolean {
		return this.dateOf(file) !== null;
	}

	/** The configured daily-note template path (normalized, `.md`), or null. */
	templatePath(): string | null {
		const { template } = this.settings();
		if (!template) return null;
		const p = normalizePath(template);
		return p.endsWith('.md') ? p : `${p}.md`;
	}

	/**
	 * The moment format daily notes are NAMED with, e.g. `YYYY-MM-DD`.
	 *
	 * The timeline labels its day headers with it, so a header reads exactly like
	 * the note it opens rather than like a second, invented date format.
	 */
	format(): string {
		return this.settings().format;
	}

	/** The vault path where the daily note for `dateKey` lives. */
	pathFor(dateKey: string): string {
		const { folder, format } = this.settings();
		const name = moment(dateKey, 'YYYY-MM-DD').format(format);
		return normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
	}

	getExisting(dateKey: string): TFile | null {
		const file = this.app.vault.getFileByPath(this.pathFor(dateKey));
		return file instanceof TFile ? file : null;
	}

	/**
	 * Return the daily note for `dateKey`, creating a BARE one (heading + given
	 * planner lines only — no template) if it doesn't yet exist.
	 */
	async getOrCreateBare(dateKey: string, initialLines: string[] = []): Promise<TFile> {
		const existing = this.getExisting(dateKey);
		if (existing) return existing;

		// The read fallback ({folder:'', format:'YYYY-MM-DD'}) is fine for deciding
		// whether a note IS a daily note. Creating one from it is not: it would
		// quietly write date-named notes into the vault root. Every caller of this
		// surfaces a Notice, so throwing is what tells the user.
		if (!this.settingsAvailable()) {
			throw new Error(
				'Could not read your Daily Notes settings, so no daily note was created. ' +
					'Enable the core Daily Notes plugin (or Periodic Notes) and try again.',
			);
		}

		const path = this.pathFor(dateKey);
		await this.ensureParentFolder(path);
		const body = buildBareDailyNote(this.getHeading(), initialLines);
		try {
			return await this.app.vault.create(path, body);
		} catch (e) {
			// Another plugin / Sync may have created it in the meantime.
			const raced = this.getExisting(dateKey);
			if (raced) return raced;
			throw e;
		}
	}

	private async ensureParentFolder(path: string): Promise<void> {
		const folder = parentFolder(path);
		if (!folder) return;
		if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
			await this.app.vault.createFolder(folder).catch(() => {
				/* already exists / race — safe to ignore */
			});
		}
	}

	/**
	 * Daily notes dated on or before `today` that are still bare — i.e. the plugin
	 * created them ahead of time and their day came and went without the template
	 * being merged (Obsidian wasn't running, and the note was never opened).
	 *
	 * Read-only: this only lists them. Nothing is written until the user says so.
	 */
	async findBarePastNotes(today: string): Promise<{ file: TFile; date: string }[]> {
		const out: { file: TFile; date: string }[] = [];
		const heading = this.getHeading();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const date = this.dateOf(file);
			if (!date || date > today) continue;
			const content = await this.app.vault.cachedRead(file);
			if (isBareDailyNote(content, heading)) out.push({ file, date });
		}
		return out.sort((a, b) => a.date.localeCompare(b.date));
	}

	/**
	 * If `file` is a bare daily note and a template is configured, merge the
	 * template in while preserving the planner lines. The outcome says which of
	 * the four things happened, so the caller can report an unreadable template
	 * instead of calling it "nothing to merge".
	 * The bareness check is repeated inside Vault.process for atomicity.
	 */
	async applyTemplateIfBare(file: TFile): Promise<TemplateMergeOutcome> {
		const { template } = this.settings();
		if (!template) return { status: 'no-template' };

		const heading = this.getHeading();
		const date = this.dateOf(file);
		if (!date) return { status: 'not-bare' };

		const pre = await this.app.vault.cachedRead(file);
		if (!isBareDailyNote(pre, heading)) return { status: 'not-bare' };

		let templateRaw = '';
		try {
			[templateRaw] = await getTemplateInfo(template);
		} catch (error) {
			// Swallowing this reported "nothing to merge", which is not what happened
			// and gives the user nothing to act on.
			return { status: 'template-unreadable', error };
		}
		if (!templateRaw) return { status: 'template-unreadable', error: new Error(`Template "${template}" is empty`) };

		let merged = false;
		let dropped: string[] = [];
		await this.app.vault.process(file, (content) => {
			if (!isBareDailyNote(content, heading)) return content;
			const result = mergeTemplateIntoBareNote({
				templateRaw,
				heading,
				preservedBlocks: this.preservedBlocksOf(content, heading),
				date,
				title: file.basename,
			});
			// REFUSE rather than lose anything. This function REPLACES the note, so
			// a block the merge could not place would be deleted along with every
			// line nested under it. Returning `content` unchanged is the only safe
			// answer; the caller tells the user which lines were in the way.
			if (result.dropped.length > 0) {
				dropped = result.dropped;
				return content;
			}
			merged = true;
			return result.text;
		});
		if (dropped.length > 0) return { status: 'would-lose-content', dropped };
		return merged ? { status: 'merged' } : { status: 'not-bare' };
	}

	/**
	 * The blocks already planned in a bare note: each root line plus whatever is
	 * nested under it, so the merge can re-place them whole. Taken from the whole
	 * note, not just the planner section — a bare note IS its planner section, and
	 * a line the plugin wrote must not be dropped because a heading moved.
	 */
	private preservedBlocksOf(content: string, heading: string): PreservedBlock[] {
		const tree = buildLineTree(content);
		const lines = content.split('\n');
		const section = getPlannerSection(content, heading);
		return tree.roots
			.map((i) => tree.nodes[i])
			.filter((node) => !section.found || node.line.lineNo >= section.start)
			.map((node) => ({
				startMinutes: node.line.startMinutes,
				// TRAILING blank lines only. This used to filter out every blank line,
				// including ones INSIDE a block — so a block written as a line, a gap,
				// then its sub-items came back with the gap closed up. Small, but the
				// merge replaces the whole note, and silently reformatting what the
				// user typed is the thing this path is not allowed to do. The trailing
				// ones are the subtree walker's own padding, not the user's.
				lines: dropTrailingBlank(lines.slice(node.line.lineNo, node.subtreeEndLine)),
			}))
			.filter((block) => block.lines.length > 0);
	}
}
