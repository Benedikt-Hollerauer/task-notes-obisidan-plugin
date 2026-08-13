import { App, Modal, Notice, Setting } from 'obsidian';
import type { TaskPropertiesForm } from './task-properties-form';
import { choiceRow } from '../widgets/choice-row';
import { labelledInput } from '../widgets/labelled-input';

/** One option of a `TextPromptOptions.choice` group. */
export interface PromptChoiceOption {
	/** Reported back to `onResult`. */
	value: string;
	label: string;
	title?: string;
}

export interface TextPromptOptions {
	title: string;
	description?: string;
	label?: string;
	placeholder?: string;
	initial?: string;
	ctaText?: string;
	/**
	 * An extra "which kind of thing is this?" row above the buttons.
	 *
	 * Deliberately a CHOICE rather than a second dialog: the prompt already knows
	 * the answer to "what?", and asking "and what kind?" in the same breath is one
	 * decision, not two. The picked value is reported alongside the text, so the
	 * caller decides what each one means — this modal stays a dumb collector.
	 */
	choice?: {
		label: string;
		options: PromptChoiceOption[];
		/** The option selected when the dialog opens. */
		initial: string;
	};
	/**
	 * Extra fields to show INLINE when a particular choice is picked.
	 *
	 * The alternative was a second modal on top of this one, which is what picking
	 * a task type used to do — two windows for one decision. Returning null means
	 * "this choice needs nothing more"; the fields are torn down and rebuilt when
	 * the choice changes, so switching type cannot leave the previous one's inputs
	 * behind.
	 */
	fieldsFor?: (choice: string, parent: HTMLElement, typed: string) => TaskPropertiesForm | null;
	/**
	 * Called with the trimmed value, or null when dismissed (Esc / Cancel /
	 * click-away). `choice` is the selected option's value, or undefined when the
	 * dialog had no choice group; `fields` is whatever `fieldsFor` last built.
	 */
	onResult: (value: string | null, choice?: string, fields?: TaskPropertiesForm | null) => void;
	/**
	 * Called once with the field, so a caller can attach an input suggester.
	 * Nothing else may touch it: the modal owns the value and the settle rule.
	 */
	onInput?: (inputEl: HTMLInputElement) => void;
}

/**
 * Single-line text prompt. `onResult` is guaranteed to be called exactly once —
 * including on dismissal — so awaiting callers can never hang on a pending promise.
 */
export class TextPromptModal extends Modal {
	private settled = false;
	/** The live selection of the choice group, if there is one. */
	private picked: string | undefined;
	/** Where `fieldsFor` renders, and what it last built. */
	private extrasEl: HTMLElement | null = null;
	private extras: TaskPropertiesForm | null = null;
	/** The text field and its label, so a choice that supersedes it can hide it. */
	private inputGroup: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;

	constructor(
		app: App,
		private opts: TextPromptOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		// See styles.css: a modal is a root of its own, so it has to be listed in
		// the token scope or every --tn-* inside it resolves to nothing.
		contentEl.addClass('task-modal');
		// `setTitle`, not a hand-rolled heading: it puts the text in Obsidian's own
		// `.modal-title` slot, so the dialog is announced with a proper accessible
		// name and matches every other modal in the app.
		this.setTitle(this.opts.title);
		if (this.opts.description) {
			contentEl.createEl('p', { text: this.opts.description, cls: 'tn-modal-hint' });
		}

		// A form with the shared input widget, not a Setting row: `Setting.addText`
		// lays a prompt out as a two-column settings line — a label on the left and
		// a narrow field pinned right — which is what made this dialog look broken.
		const form = contentEl.createEl('form', { cls: 'task-modal-form' });
		const input = labelledInput(form, {
			label: this.opts.label ?? 'Text',
			value: this.opts.initial ?? '',
			placeholder: this.opts.placeholder,
		});
		// The whole labelled group, so hiding it takes the caption with the field.
		this.inputGroup = input.parentElement;
		this.inputEl = input;
		// The field is the source of truth, so a suggester writing into it directly
		// cannot desynchronise from what gets submitted.
		const read = () => input.value;

		form.addEventListener('submit', (e) => {
			e.preventDefault();
			this.finish(read());
		});
		this.opts.onInput?.(input);

		if (this.opts.choice) this.buildChoice(form, this.opts.choice);
		// After the choice row, before the buttons — the fields belong to the
		// choice above them, and the buttons stay at the bottom where they were.
		this.extrasEl = form.createDiv({ cls: 'tn-choice-fields' });
		this.syncExtras();

		const buttons = form.createDiv({ cls: 'task-modal-button-group' });
		const cancel = buttons.createEl('button', { text: 'Cancel', cls: 'task-modal-cancel-btn' });
		cancel.type = 'button';
		cancel.addEventListener('click', () => this.close());
		// `mod-cta` is what makes a button the PRIMARY one: Obsidian's own
		// `button:not(.clickable-icon)` is (0,1,1) and paints every button grey, so
		// without it "Add block" rendered less prominent than Cancel — in the main
		// creation gesture of the plugin. The other two submit buttons had it.
		const submit = buttons.createEl('button', {
			text: this.opts.ctaText ?? 'OK',
			cls: 'task-modal-submit-btn mod-cta',
		});
		submit.type = 'submit';

		window.setTimeout(() => input.focus(), 0);
	}

	private buildChoice(form: HTMLElement, choice: NonNullable<TextPromptOptions['choice']>): void {
		this.picked = choice.initial;
		// The shared widget — the task-properties panel offers the same control for
		// changing a note's type, and two copies of it would drift.
		choiceRow(form, {
			label: choice.label,
			options: choice.options,
			initial: choice.initial,
			onPick: (value) => {
				this.picked = value;
				this.syncExtras();
			},
		});
	}

	/**
	 * Rebuild the inline fields for the current choice.
	 *
	 * A choice that brings its own fields SUPERSEDES the text box: a task type's
	 * first field is its Action, which is the same question "Task" was asking, and
	 * two inputs for one answer is what made the dialog look redundant. The typed
	 * text is carried into that field so nothing is lost, and the box comes back —
	 * with its text — the moment a choice without fields is picked.
	 */
	private syncExtras(): void {
		if (!this.extrasEl || !this.opts.fieldsFor || this.picked == null) return;
		const typed = this.inputEl?.value ?? '';
		this.extrasEl.empty();
		this.extras = this.opts.fieldsFor(this.picked, this.extrasEl, typed);
		this.inputGroup?.toggleClass('tn-hidden', !!this.extras);
		if (this.extras) this.extras.focusFirstEmpty();
		else this.inputEl?.focus();
	}

	private finish(value: string): void {
		const trimmed = value.trim();
		// The empty-value rule belongs to the text box; while a form has replaced
		// it, that form's own validate() decides whether the dialog may close.
		if (!trimmed && !this.extras) return;
		// The inline fields get their say before anything settles, so an incomplete
		// form keeps the dialog open exactly as an empty task name does.
		const problem = this.extras?.validate();
		if (problem) {
			new Notice(problem);
			return;
		}
		this.settle(trimmed);
		this.close();
	}

	private settle(result: string | null): void {
		if (this.settled) return;
		this.settled = true;
		this.opts.onResult(result, this.picked, this.extras);
	}

	onClose(): void {
		this.contentEl.empty();
		this.contentEl.removeClass('task-modal');
		this.settle(null); // dismissed without submitting
	}
}

/** A confirmation with a heading, a body and its own call-to-action wording. */
export interface ConfirmOptions {
	title: string;
	/** Newlines are preserved, so a list of affected files reads as a list. */
	body: string;
	/** The confirming button's label. Say what will happen, not "Confirm". */
	cta?: string;
}

/** Yes/no confirmation. `onResult(false)` fires on dismissal. */
export class ConfirmModal extends Modal {
	private settled = false;
	private opts: ConfirmOptions;

	constructor(
		app: App,
		message: string | ConfirmOptions,
		// `Promise<void>` is part of the contract, not an accident: every caller
		// that acts on a "yes" does file I/O, so they are all async. Declaring the
		// callback as returning only `void` made each one a floating promise at
		// the call site. The modal itself still does not wait — it closes as soon
		// as the answer is in, and the work carries on behind it.
		private onResult: (confirmed: boolean) => void | Promise<void>,
	) {
		super(app);
		this.opts = typeof message === 'string' ? { title: message, body: '' } : message;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		// The token scope. Without it every --tn-* inside this modal resolves to
		// nothing — and this is the dialog that gates the plugin's destructive
		// actions, so it is the last one that should look unstyled.
		contentEl.addClass('task-modal');
		this.setTitle(this.opts.title);
		if (this.opts.body) {
			// `white-space: pre-line` in the stylesheet, so a newline-separated list
			// of affected files stays a list.
			contentEl.createEl('p', { text: this.opts.body, cls: 'tn-confirm-body' });
		}
		new Setting(contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.opts.cta ?? 'Confirm')
					.setCta()
					.onClick(() => {
						this.settle(true);
						this.close();
					}),
			);
	}

	private settle(confirmed: boolean): void {
		if (this.settled) return;
		this.settled = true;
		// Deliberately not awaited — see the callback's type. A handler that
		// throws must not take the modal down with it, so it is caught here.
		void Promise.resolve(this.onResult(confirmed)).catch((error: unknown) =>
			console.error('Task Notes: confirmation handler failed', error),
		);
	}

	onClose(): void {
		this.contentEl.empty();
		this.contentEl.removeClass('task-modal');
		this.settle(false);
	}
}

/** `await confirm(app, {...})` — the promise form, for code that must not proceed. */
export function confirm(app: App, opts: ConfirmOptions | string): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, opts, resolve).open());
}
