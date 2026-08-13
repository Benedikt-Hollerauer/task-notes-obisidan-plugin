// One labelled-input builder shared by the footer bar and the task modal, so both
// emit the same markup and use the same `.tn-input` styling family.

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

/** Convert an `<input type="time">` value (HH:MM) to the filename form (HH.MMh). */
export function timeInputToDotHours(value: string): string {
	const m = value.match(/^(\d{2}):(\d{2})$/);
	return m ? `${m[1]}.${m[2]}h` : '';
}

/** Convert the filename time form (HH.MMh) to an `<input type="time">` value. */
export function dotHoursToTimeInput(value: string | undefined): string {
	const m = value?.match(/(\d{2})\.(\d{2})h/);
	return m ? `${m[1]}:${m[2]}` : '';
}
