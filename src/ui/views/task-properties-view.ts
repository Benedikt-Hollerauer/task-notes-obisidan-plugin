import { ItemView, WorkspaceLeaf, TFile, Notice, type App } from 'obsidian';
import type { TaskProperties } from '../../types';
import type { TaskNotesSettings } from '../../settings/settings';
import type { TaskFileService } from '../../services/task-file-service';
import type { TaskMenus } from '../menus';
import {
	VIEW_TYPE_TASK_PROPERTIES,
	ICON_TASK_PROPERTIES,
	TASK_EMOJIS,
	isDoneRole,
	specsFor,
} from '../../constants';
import {
	hasTaskEmoji,
	getNormalizedEmoji,
	extractTaskName,
	activePrefixOf,
	taskBasename,
} from '../../core/emoji';
import { parseTaskProperties, getTaskFormatByEmoji, generateTaskName } from '../../core/task-name';
import {
	formatFields,
	applyFieldValues,
	missingFields,
	type PropKey,
} from '../../core/format-fields';
import { labelledInput, timeInputToDotHours, dotHoursToTimeInput } from '../widgets/labelled-input';
import { choiceRow } from '../widgets/choice-row';

interface FormDraft {
	values: Map<PropKey, string>;
	startDate: string;
	time: string;
	endDate: string;
}

interface StagedDraft {
	emoji: string | null;
	form: FormDraft;
}

/**
 * Edits the active task note's properties — its name, taken apart into the
 * fields its format declares — and renames the file when you press Apply.
 *
 * A sidebar view rather than a bar pinned inside the note. As a footer it sat in
 * the pane's bottom-right corner, which is exactly where Obsidian floats its own
 * status bar, so the last field and the Apply button were covered; it also stole
 * height from every task note whether or not you were editing properties.
 */
export class TaskPropertiesView extends ItemView {
	private file: TFile | null = null;
	/**
	 * A type picked in the Type row but not yet written.
	 *
	 * Everything in this panel waits for Apply — that is what Apply is for, and
	 * it is the only thing standing between a stray click and a renamed file with
	 * every wikilink in the vault rewritten to match. The Type row used to rename
	 * the instant you touched it, which made it the one control here that wrote
	 * without asking. (The checkbox is the deliberate exception: ticking a task
	 * IS the action, not a description of one.)
	 */
	private pendingEmoji: string | null = null;
	/** The file the current form was built for, so a staged type cannot outlive it. */
	private renderedPath: string | null = null;
	/** Distinguishes the first empty render from a later no-op event for no file. */
	private hasRendered = false;
	/** Unsaved forms survive moving to another tab and back. Session-local only. */
	private drafts = new Map<string, StagedDraft>();
	/** Reads the current live controls immediately before the active task changes. */
	private captureDraft: (() => FormDraft) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private taskFiles: TaskFileService,
		private menus: TaskMenus,
		private getSettings: () => TaskNotesSettings,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_TASK_PROPERTIES;
	}

	getDisplayText(): string {
		return 'Task properties';
	}

	getIcon(): string {
		return ICON_TASK_PROPERTIES;
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('task-notes-properties-view');
		// Follow whatever note you are looking at. `active-leaf-change` alone
		// misses an in-place file swap; `file-open` alone misses tab switches.
		this.registerEvent(this.app.workspace.on('file-open', () => this.render()));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.render()));
		// Applying renames the file, which is what changes the properties shown.
		this.registerEvent(this.app.vault.on('rename', () => this.render()));
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.removeClass('task-notes-properties-view');
		this.hasRendered = false;
		this.renderedPath = null;
		this.pendingEmoji = null;
		this.captureDraft = null;
		this.drafts.clear();
	}

	/** Redraw for the currently active file. */
	render(): void {
		const active = this.app.workspace.getActiveFile();
		// A sidebar leaf never holds the note, so "active file" is the right
		// question — but ignore our own view being focused.
		const nextFile = active && hasTaskEmoji(active.basename) ? active : null;
		const nextPath = nextFile?.path ?? null;
		// Workspace and vault events are broad: an unrelated note rename, focusing
		// the already-active tab, or opening the same file used to destroy and rebuild
		// every input. Preserve the live DOM (and its unsaved values) when the task did
		// not actually change.
		if (this.hasRendered && nextPath === this.renderedPath) {
			this.file = nextFile;
			return;
		}
		if (this.renderedPath && this.captureDraft) {
			this.drafts.set(this.renderedPath, {
				emoji: this.pendingEmoji,
				form: this.captureDraft(),
			});
		}
		this.file = nextFile;
		// A different note — including this one AFTER a rename, which is how a
		// successful Apply comes back to us — starts from what is on disk.
		let carried: FormDraft | undefined;
		if (nextPath !== this.renderedPath) {
			const saved = nextPath ? this.drafts.get(nextPath) : undefined;
			this.pendingEmoji = saved?.emoji ?? null;
			carried = saved?.form;
			this.renderedPath = nextPath;
		}
		this.captureDraft = null;
		this.hasRendered = true;
		const { contentEl } = this;
		contentEl.empty();

		if (!this.file) {
			contentEl.createDiv({
				cls: 'task-notes-properties-empty',
				text: 'Open a task note to edit its properties.',
			});
			return;
		}
		this.buildForm(contentEl, this.file, carried);
	}

	/**
	 * @param carried values the user had already typed, kept across a type change
	 *   — switching type rebuilds the form because a different format declares
	 *   different fields, and losing what was typed to do that would be its own
	 *   small betrayal.
	 */
	private buildForm(parent: HTMLElement, file: TFile, carried?: FormDraft): void {
		// TWO emojis, on purpose. `diskEmoji` is what the FILE says and is all the
		// header may show — the header is a preview of the note, and nothing in a
		// preview moves before Apply. `emoji` is the STAGED type (falling back to
		// disk) and drives only the editing surfaces: the Type row's selection and
		// which fields the form offers. Rendering the staged emoji in the header
		// made the panel look like it had already renamed the file.
		const diskEmoji = getNormalizedEmoji(file.basename);
		const emoji = this.pendingEmoji ?? diskEmoji;

		const header = parent.createDiv({ cls: 'task-notes-properties-header' });
		header.appendChild(this.buildCheckbox(file, diskEmoji));
		// The emoji rides with the name, so the type is readable at a glance —
		// the panel used to show the name alone and a 📅 looked like a 🔁.
		const name = header.createDiv({ cls: 'task-notes-properties-name' });
		name.createSpan({ cls: 'task-notes-properties-emoji', text: diskEmoji });
		name.createSpan({ text: extractTaskName(file.basename) });

		// Change the note's TYPE without leaving the panel. The same control the
		// "New time block" dialog uses for "Create as", and the same routine the
		// right-click "Mark as …" menu calls — so the ✅ checklist guard and the
		// 🅰️-prefix preservation come along for free.
		choiceRow(parent, {
			label: 'Type',
			options: specsFor('file').map((spec) => ({
				value: spec.emoji,
				label: spec.emoji,
				title: `Change to ${spec.menuLabel}`,
				// The label is a bare emoji; `title` is not an accessible name, so
				// without this a screen reader announced "calendar" or
				// "counterclockwise arrows" instead of the type.
				ariaLabel: `Change to ${spec.menuLabel}`,
			})),
			initial: emoji,
			// STAGED, not written. Rebuilds the form so the new type's own fields
			// appear (a 🔁 has a Cycle a ◻️ does not), carrying across whatever has
			// been typed; Apply is what touches the file.
			onPick: (next) => {
				this.pendingEmoji = next;
				const typed = draft();
				parent.empty();
				this.buildForm(parent, file, typed);
			},
		});

		const format = getTaskFormatByEmoji(emoji, this.getSettings());
		// Date inputs follow the FORMAT, not the emoji: any format carrying {date}
		// is a dated item.
		const isEvent = format.includes('{date}');
		const props = parseTaskProperties(extractTaskName(file.basename), isEvent, format);
		const fields = formatFields(format);

		let startDate: HTMLInputElement | null = null;
		let time: HTMLInputElement | null = null;
		let endDate: HTMLInputElement | null = null;
		if (isEvent) {
			const when = this.buildCard(parent, 'When');
			startDate = labelledInput(when, {
				label: 'Date',
				type: 'date',
				value: carried?.startDate ?? props.startDate ?? '',
			});
			time = labelledInput(when, {
				label: 'At',
				type: 'time',
				value: carried?.time ?? dotHoursToTimeInput(props.time),
			});
			endDate = labelledInput(when, {
				label: 'To',
				type: 'date',
				value: carried?.endDate ?? props.endDate ?? '',
			});
		}

		// One input per field the format declares — a two-field format gets two
		// inputs, a routine gets its Cycle, and nothing is hardcoded to three.
		// No title on this card: it used to read "Scheduled 📅", which now just
		// repeats the emoji and the type already shown in the header above.
		const body = fields.length > 0 ? this.buildCard(parent) : parent;
		const textInputs = fields.map((field) => ({
			field,
			el: labelledInput(body, {
				label: field.label,
				type: 'text',
				value: carried?.values.get(field.propKey) ?? props[field.propKey] ?? '',
				placeholder: field.label,
			}),
		}));

		// `mod-cta` is Obsidian's own primary-button class. Ours set the accent
		// background itself and lost: `button:not(.clickable-icon)` in app.css is
		// specificity (0,1,1) and a lone class is (0,1,0), so Apply rendered grey.
		const apply = parent.createEl('button', {
			text: 'Apply',
			cls: 'task-notes-apply-btn mod-cta',
		});
		apply.type = 'button';

		const values = (): Map<PropKey, string> =>
			new Map(textInputs.map(({ field, el }) => [field.propKey, el.value]));
		const draft = (): FormDraft => ({
			values: values(),
			// Keep a previous event draft even while an intermediate, non-event type
			// has no date controls of its own.
			startDate: startDate?.value ?? carried?.startDate ?? props.startDate ?? '',
			time: time?.value ?? carried?.time ?? dotHoursToTimeInput(props.time),
			endDate: endDate?.value ?? carried?.endDate ?? props.endDate ?? '',
		});
		this.captureDraft = draft;

		const validate = (): void => {
			const missing = missingFields(fields, values());
			const dateMissing = isEvent && !startDate?.value.trim();
			apply.disabled = missing.length > 0 || dateMissing;
			apply.title = apply.disabled
				? `Fill in: ${[...missing.map((f) => f.label), ...(dateMissing ? ['Date'] : [])].join(', ')}`
				: 'Rename this note from its properties';
			for (const { field, el } of textInputs) {
				const bad = missing.includes(field);
				el.toggleClass('tn-input-invalid', bad);
				// The red border alone was the entire signal, and the only words
				// explaining it lived in a tooltip on a DISABLED button.
				el.setAttribute('aria-invalid', String(bad));
			}
			startDate?.toggleClass('tn-input-invalid', dateMissing);
		};

		for (const { el } of textInputs) el.addEventListener('input', validate);
		startDate?.addEventListener('input', validate);
		validate();

		apply.addEventListener('click', () => {
			void this.apply(file, emoji, format, props, values(), { startDate, time, endDate });
		});
	}

	/** A group, optionally titled; returns the body the fields go into. */
	private buildCard(parent: HTMLElement, title?: string): HTMLElement {
		const card = parent.createDiv({ cls: 'tn-card' });
		if (title) card.createDiv({ cls: 'tn-card-title', text: title });
		// The same flex column the panel already used for its one flat field list.
		return card.createDiv({ cls: 'task-notes-properties-fields' });
	}

	private buildCheckbox(file: TFile, emoji: string): HTMLInputElement {
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'task-notes-checkbox';
		checkbox.checked = isDoneRole(emoji);
		checkbox.setAttribute('data-emoji', emoji);
		checkbox.setAttribute('aria-label', 'Mark this task done');
		checkbox.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			void this.toggle(file, emoji);
		});
		checkbox.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.menus.showContextMenu(file, e);
		});
		return checkbox;
	}

	private async toggle(file: TFile, emoji: string): Promise<void> {
		const next = emoji === TASK_EMOJIS.CHECKED ? TASK_EMOJIS.UNCHECKED : TASK_EMOJIS.CHECKED;
		await this.taskFiles.changeStatus(file, next);
	}

	private async apply(
		file: TFile,
		emoji: string,
		format: string,
		parsed: TaskProperties,
		values: Map<PropKey, string>,
		dates: {
			startDate: HTMLInputElement | null;
			time: HTMLInputElement | null;
			endDate: HTMLInputElement | null;
		},
	): Promise<void> {
		const isEvent = format.includes('{date}');
		const trimmed = new Map([...values].map(([k, v]) => [k, v.trim()] as const));

		// Start from the PARSED properties so fields this format doesn't expose
		// (an identity the user hasn't opted into, a date range) survive the edit.
		const props: TaskProperties = applyFieldValues(parsed, trimmed);
		if (isEvent) {
			const startDate = dates.startDate?.value.trim() ?? '';
			if (!startDate) {
				new Notice('Event date is required');
				return;
			}
			const time = timeInputToDotHours(dates.time?.value ?? '');
			props.startDate = startDate;
			props.endDate = dates.endDate?.value.trim() || undefined;
			props.time = time || undefined;
		}

		// The Type row can stage ✅, and Apply renames directly rather than going
		// through changeStatus — so the checklist guard has to be asked here too,
		// or the panel becomes the way around it.
		if (!(await this.taskFiles.mayMarkChecked(file, emoji))) return;

		const newName = taskBasename(
			emoji,
			generateTaskName(props, format),
			activePrefixOf(file.basename), // 🅰️ survives property edits
		);
		if (newName === file.basename) return; // a no-op Apply must not touch the vault
		// Read BEFORE the rename: Obsidian mutates the TFile in place, and the
		// template rule below asks "which type did this note have a moment ago?".
		const previousBasename = file.basename;
		if (await this.taskFiles.renameFile(file, newName)) {
			new Notice('Task updated');
			// Adopting a type adopts its template — but only into an EMPTY note, so
			// this can never disturb anything already written. Strictly after the
			// rename: a rename that failed must leave the note completely alone.
			await this.taskFiles.applyTemplateOnAdopt(file, previousBasename, emoji);
		}
	}
}

/** Open (or reveal) the properties view in the right sidebar. */
export async function revealTaskProperties(app: App): Promise<void> {
	const existing = app.workspace.getLeavesOfType(VIEW_TYPE_TASK_PROPERTIES);
	if (existing.length > 0) {
		await app.workspace.revealLeaf(existing[0]);
		return;
	}
	const leaf = app.workspace.getRightLeaf(false);
	if (!leaf) return;
	await leaf.setViewState({ type: VIEW_TYPE_TASK_PROPERTIES, active: true });
	await app.workspace.revealLeaf(leaf);
}
