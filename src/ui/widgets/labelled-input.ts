// One labelled-input builder shared by the footer bar and the task modal, so both
// emit the same markup and use the same `.tn-input` styling family.

import { colonToMinutes, dotToMinutes, minutesToColon, minutesToDot } from '../../core/timestamps';

export interface LabelledInputOptions {
	label: string;
	type?: 'text' | 'date' | 'time';
	value?: string;
	placeholder?: string;
	required?: boolean;
}

/**
 * Create a labelled input inside `parent` and return the input.
 *
 * The group IS the `<label>`, so the caption names the field it wraps without a
 * `for`/`id` pair — and without a generator to keep those ids unique across two
 * views. Previously the caption was a sibling `<label>` with no `for`, which
 * means the date and time fields (which carry no placeholder either) had no
 * accessible name at all.
 */
export function labelledInput(parent: HTMLElement, options: LabelledInputOptions): HTMLInputElement {
	const group = parent.createEl('label', { cls: 'tn-input-group' });
	group.createSpan({ text: options.label, cls: 'tn-input-label' });
	const input = group.createEl('input', { cls: `tn-input tn-input-${options.type ?? 'text'}` });
	input.type = options.type ?? 'text';
	if (options.value != null) input.value = options.value;
	if (options.placeholder) input.placeholder = options.placeholder;
	if (options.required) input.required = true;
	return input;
}

/**
 * Convert an `<input type="time">` value (HH:MM) to the filename form (HH.MMh).
 *
 * Delegated to core/timestamps rather than pattern-matched here. The hand-rolled
 * versions were not equivalent to the canonical ones: this one required exactly
 * two hour digits, so the `H:MM` that `colonToMinutes` accepts was silently
 * dropped; and the reverse was unanchored and unvalidated, so a name carrying
 * `at 99.99h` (which the grammar matches without range-checking) filled the At
 * field with nonsense — after which Apply dropped the time clause entirely.
 */
export function timeInputToDotHours(value: string): string {
	const minutes = colonToMinutes(value);
	return minutes == null ? '' : minutesToDot(minutes);
}

/** Convert the filename time form (HH.MMh) to an `<input type="time">` value. */
export function dotHoursToTimeInput(value: string | undefined): string {
	const minutes = value == null ? null : dotToMinutes(value);
	return minutes == null ? '' : minutesToColon(minutes);
}
