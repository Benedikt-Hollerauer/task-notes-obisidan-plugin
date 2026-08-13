import { App, Modal, Setting, Notice } from 'obsidian';
import type { LocalEvent } from '../../types';
import { minutesToColon } from '../../core/timestamps';

/**
 * The morning question — "is everything dated today actually in the day plan?" —
 * asked once, with an Add button per note.
 *
 * Adding writes exactly one planner line per press. Nothing happens to a note
 * that is left alone, and closing the dialog writes nothing at all.
 */
export class ScheduleTodayModal extends Modal {
	constructor(
		app: App,
		private events: LocalEvent[],
		private onSchedule: (event: LocalEvent) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		// The design tokens are scoped to a list of roots (see styles.css). This
		// modal was the one that never joined it, so the hygiene test that checks
		// "every contentEl.addClass is in the token scope" passed vacuously for it
		// and `.tn-modal-hint` had to be scoped separately as a workaround.
		contentEl.addClass('task-modal');
		this.setTitle("Today's events not in the day plan");
		contentEl.createEl('p', {
			cls: 'tn-modal-hint',
			text: `${this.events.length} note${this.events.length === 1 ? '' : 's'} dated today ${
				this.events.length === 1 ? 'is' : 'are'
			} not linked from the day plan yet. Adding one writes a single line into today's note.`,
		});

		const list = contentEl.createDiv({ cls: 'tn-schedule-list' });
		const remaining = new Set(this.events.map((e) => e.id));

		for (const event of this.events) {
			const row = new Setting(list).setName(event.title);
			if (event.startMinutes != null) row.setDesc(`Filename says ${minutesToColon(event.startMinutes)}`);
			row.addButton((b) =>
				b
					.setButtonText('Add to plan')
					.setCta()
					.onClick(async () => {
						b.setDisabled(true).setButtonText('Added');
						await this.onSchedule(event);
						remaining.delete(event.id);
						if (remaining.size === 0) this.close();
					}),
			);
		}

		new Setting(contentEl)
			.addButton((b) => b.setButtonText('Done').onClick(() => this.close()))
			.addButton((b) =>
				b.setButtonText('Add all').onClick(async () => {
					const todo = this.events.filter((e) => remaining.has(e.id));
					for (const event of todo) await this.onSchedule(event);
					new Notice(`Added ${todo.length} event${todo.length === 1 ? '' : 's'} to today's plan.`);
					this.close();
				}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		this.contentEl.removeClass('task-modal');
	}
}
