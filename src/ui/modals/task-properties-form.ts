// The fields that make a task's NAME, as a form that renders into any element.
//
// WHY THIS IS NOT A MODAL. It used to be one — `TaskPropertiesModal` owned both
// the dialog and the fields — which meant the only way to collect these values
// was to open a window. So dragging a slot on the timeline and picking 📅 closed
// the "New time block" dialog and opened a second one, for what is really the
// same single decision. Splitting the form out lets the drag dialog grow the
// fields inline, while the modal keeps working exactly as it did for the
// right-click convert and remote-convert flows.
//
// It builds fields from the FORMAT string, so a user who edits their filename
// format in settings gets the matching inputs here with no code change. The
// frozen grammar (core/task-name.ts) decides what a format means; `formatFields`
// decides which inputs it implies; this file only draws them.

import type { TaskProperties } from '../../types';
import { formatFields } from '../../core/format-fields';
import { labelledInput, timeInputToDotHours, dotHoursToTimeInput } from '../widgets/labelled-input';

/** Placeholder-specific examples, so each input hints at its own field. */
const EXAMPLES: Record<string, string> = {
	action: 'buy, finish, complete',
	amount: '3, 5 items, 2 hours',
	outcome: 'groceries, report, project',
	identity: 'Top engineer, English speaker',
	cycle: 'per day, every Monday',
	name: 'English language, Mountains',
};

export interface TaskPropertiesFormOptions {
	/** The filename format this type uses; decides which fields exist. */
	format: string;
	/** Values to start from. */
	prefill?: Partial<TaskProperties>;
	/**
	 * Also ask for a duration, in minutes. A duration cannot live in the filename
	 * — the grammar carries only a start — so it exists solely on the planner
	 * line, which is why it is an option here rather than a field of the format.
	 */
	durationMinutes?: number | null;
}

/** What `read()` gives back: the properties, plus the duration if one was asked for. */
export interface TaskPropertiesResult {
	props: TaskProperties;
	/** Minutes, or null when this form had no duration field. */
	durationMinutes: number | null;
}

export class TaskPropertiesForm {
	/** Dated items are those whose FORMAT carries {date} — not a hardcoded emoji. */
	readonly isEvent: boolean;

	private startDateInput: HTMLInputElement | null = null;
	private timeInput: HTMLInputElement | null = null;
	private endDateInput: HTMLInputElement | null = null;
	private durationInput: HTMLInputElement | null = null;
	private textInputs: { field: ReturnType<typeof formatFields>[number]; el: HTMLInputElement }[] = [];

	constructor(
		private parent: HTMLElement,
		private opts: TaskPropertiesFormOptions,
	) {
		this.isEvent = opts.format.includes('{date}');
		this.build();
	}

	private build(): void {
		const prefill = this.opts.prefill ?? {};

		if (this.isEvent) {
			this.startDateInput = this.field('Start date', 'date', prefill.startDate);
			this.timeInput = this.field('Time (optional)', 'time', dotHoursToTimeInput(prefill.time));
			this.endDateInput = this.field('End date (optional)', 'date', prefill.endDate);
		}

		// Minutes, not an end time: the block's length is what you think in, and it
		// survives changing the start.
		if (this.opts.durationMinutes != null) {
			this.durationInput = this.field(
				'Duration (minutes)',
				'text',
				String(this.opts.durationMinutes),
				'e.g. 60',
			);
		}

		// One input per field the format declares, in template order.
		// NOT `required`: native validation inside a modal blocks the submit with a
		// tooltip that is easy to miss, which reads as "the button does nothing".
		// `validate()` says what is missing instead.
		this.textInputs = formatFields(this.opts.format).map((field) => ({
			field,
			el: this.field(
				field.label,
				'text',
				prefill[field.propKey],
				`E.g. ${EXAMPLES[field.placeholder] ?? field.label}`,
			),
		}));
	}

	private field(
		label: string,
		type: 'text' | 'date' | 'time',
		value = '',
		placeholder = '',
	): HTMLInputElement {
		return labelledInput(this.parent, { label, type, required: false, placeholder, value });
	}

	/**
	 * What is still missing, as a sentence, or null when the form is complete.
	 *
	 * Marks the offending inputs as it goes, so the message and the highlighting
	 * can never disagree about which field is at fault.
	 */
	validate(): string | null {
		const missing: string[] = [];
		for (const { field, el } of this.textInputs) {
			const empty = !el.value.trim();
			// The class is a COLOUR; `aria-invalid` is the fact. Without it "this
			// field is required and empty" was conveyed by a red border alone.
			el.toggleClass('tn-input-invalid', empty);
			el.setAttribute('aria-invalid', String(empty));
			if (empty) missing.push(field.label);
		}
		const dateMissing = this.isEvent && !this.startDateInput?.value.trim();
		this.startDateInput?.toggleClass('tn-input-invalid', dateMissing);
		this.startDateInput?.setAttribute('aria-invalid', String(dateMissing));
		if (dateMissing) missing.push('Start date');

		if (missing.length) return `Please fill in: ${missing.join(', ')}`;

		if (this.durationInput) {
			const minutes = Number(this.durationInput.value.trim());
			const valid = Number.isFinite(minutes) && minutes > 0;
			this.durationInput.toggleClass('tn-input-invalid', !valid);
			if (!valid) return 'Duration must be a number of minutes greater than zero';
		}
		return null;
	}

	/** The collected values. Call `validate()` first. */
	read(): TaskPropertiesResult {
		const props: TaskProperties = { actionWords: '', amount: '', amountOutcome: '' };
		for (const { field, el } of this.textInputs) props[field.propKey] = el.value.trim();

		if (this.isEvent && this.startDateInput) {
			props.startDate = this.startDateInput.value;
			const time = timeInputToDotHours(this.timeInput?.value ?? '');
			if (time) props.time = time;
			if (this.endDateInput?.value) props.endDate = this.endDateInput.value;
		}
		const duration = this.durationInput ? Math.round(Number(this.durationInput.value.trim())) : null;
		return { props, durationMinutes: duration };
	}

	/**
	 * Focus the first field still needing input.
	 *
	 * Not simply the first field: with a prefilled date, focusing that would put
	 * the cursor on the one value we already know.
	 */
	focusFirstEmpty(): void {
		const candidates = [this.startDateInput, ...this.textInputs.map((t) => t.el)];
		const firstEmpty = candidates.find(
			(el): el is HTMLInputElement => !!el && !el.value.trim(),
		);
		(firstEmpty ?? this.startDateInput ?? this.textInputs[0]?.el)?.focus();
	}
}
