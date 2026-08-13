import { App, Modal, Notice } from 'obsidian';
import type { TaskProperties } from '../../types';
import type { TaskNotesSettings } from '../../settings/settings';
import { specByEmoji } from '../../constants';
import { getTaskFormatByEmoji } from '../../core/task-name';
import { TaskPropertiesForm } from './task-properties-form';

/** Modal that collects task/event properties for creation or conversion. */
export class TaskPropertiesModal extends Modal {
	private readonly format: string;
	private readonly label: string;
	/** The duration the user accepted, read by the caller after onSubmit. */
	chosenDuration = 0;

	constructor(
		app: App,
		emoji: string,
		private originalName: string,
		settings: TaskNotesSettings,
		private onSubmit: (props: TaskProperties) => void,
		/**
		 * Values to start from. Used when converting a remote calendar event: its
		 * date and time are known, its title seeds the first field, and everything
		 * else is left for you — a calendar title does not split into
		 * action/amount/outcome on its own, and guessing would write a name you
		 * would only have to fix.
		 */
		private prefill: Partial<TaskProperties> = {},
		/**
		 * Turns the dialog into "add to the day plan": it also asks for a duration,
		 * calls the button Add, and reports the chosen minutes alongside the props.
		 *
		 * A duration cannot live in the filename — the grammar carries only a start
		 * (see core/event-filename.ts) — so the end time exists solely on the
		 * planner line. That is why this dialog never had the field and the code
		 * silently used `defaultEventDurationMinutes` instead.
		 */
		private plan: { durationMinutes: number; timeWasMissing: boolean } | null = null,
	) {
		super(app);
		this.format = getTaskFormatByEmoji(emoji, settings);
		this.label = specByEmoji(emoji)?.menuLabel ?? 'task';
	}

	onOpen(): void {
		// Block Obsidian's click-outside-to-close so a stray click doesn't discard input.
		this.containerEl.addEventListener(
			'click',
			(e: MouseEvent) => {
				const insideModal = this.contentEl.parentElement?.contains(e.target as Node) ?? false;
				if (!insideModal) e.stopPropagation();
			},
			true,
		);

		const { contentEl } = this;
		contentEl.empty();
		// The design tokens are scoped to a list of roots (see styles.css). The
		// form's SIBLINGS — this heading, the original-name line, the buttons —
		// live outside it unless the modal itself is a root.
		contentEl.addClass('task-modal');
		this.setTitle(this.plan ? 'Add to the day plan' : `Create ${this.label}`);
		if (this.plan?.timeWasMissing) {
			// Said out loud, because this is the value that used to be invented and
			// then written into the filename without asking.
			contentEl.createEl('p', {
				cls: 'tn-modal-hint',
				text: 'This note’s name carries no time, so a default is proposed below.',
			});
		}
		if (this.originalName && Object.keys(this.prefill).length > 0) {
			contentEl.createEl('p', {
				cls: 'tn-modal-hint',
				// "Create" is the literal button label, not a capitalised common noun.
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				text: 'Nothing is written until you press Create.',
			});
		}

		if (this.originalName) {
			const original = contentEl.createDiv({ cls: 'task-modal-original-name' });
			original.createEl('strong', { text: 'Original: ' });
			original.createSpan({ text: this.originalName });
		}

		const form = contentEl.createEl('form', { cls: 'task-modal-form' });

		// The fields live in TaskPropertiesForm, so the drag-to-create dialog can
		// grow the same ones inline instead of opening this window on top of it.
		const fields = new TaskPropertiesForm(form, {
			format: this.format,
			prefill: this.prefill,
			durationMinutes: this.plan ? this.plan.durationMinutes : null,
		});

		const buttons = form.createDiv({ cls: 'task-modal-button-group' });
		const cancel = buttons.createEl('button', { text: 'Cancel', type: 'button', cls: 'task-modal-cancel-btn' });
		cancel.addEventListener('click', () => this.close());
		// mod-cta: Obsidian's primary-button colours (see task-properties-view.ts).
		buttons.createEl('button', {
			text: this.plan ? 'Add' : 'Create',
			type: 'submit',
			cls: 'task-modal-submit-btn mod-cta',
		});

		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const problem = fields.validate();
			if (problem) {
				new Notice(problem);
				return;
			}
			const { props, durationMinutes } = fields.read();
			if (durationMinutes != null) this.chosenDuration = durationMinutes;
			this.onSubmit(props);
			this.close();
		});

		form.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.stopPropagation();
				const target = e.target as HTMLElement;
				if (target.tagName === 'INPUT' && target.getAttribute('type') === 'text') {
					e.preventDefault();
					form.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
				}
			}
		});

		fields.focusFirstEmpty();
	}

	onClose(): void {
		this.contentEl.empty();
		this.contentEl.removeClass('task-modal');
	}

}
