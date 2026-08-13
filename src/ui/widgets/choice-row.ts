// A labelled row of mutually exclusive buttons — "pick one of these".
//
// Extracted from TextPromptModal's "Create as" row so the task-properties panel
// can offer the same control for changing a note's type, rather than growing a
// second implementation of the same idea five lines away from this one.
//
// Radio SEMANTICS with button LOOKS: these have to wear the same `.tn-btn`
// vocabulary as every other control in the plugin, and a real
// `<input type="radio">` cannot be restyled that far without fighting Obsidian's
// own input rules. The roles keep it announced correctly and arrow-navigable.

export interface ChoiceOption {
	/** Reported to `onPick`. */
	value: string;
	label: string;
	title?: string;
	/**
	 * The accessible name, when `label` is not one.
	 *
	 * Several of these rows are labelled with a bare emoji, and `title` is NOT an
	 * accessible name — a screen reader announces the Unicode character name
	 * ("calendar", "counterclockwise arrows"), so the control whose entire job is
	 * "what kind of note is this" said nothing useful.
	 */
	ariaLabel?: string;
}

export interface ChoiceRowOptions {
	label: string;
	options: ChoiceOption[];
	/** Selected when the row is built. */
	initial: string;
	/** Called with the newly picked value. Not called for re-picking the current one. */
	onPick?: (value: string) => void;
}

export interface ChoiceRow {
	/** The live selection. */
	value(): string;
	/** Select a value from outside, repainting the buttons. Does not fire `onPick`. */
	set(value: string): void;
}

/** Build the row inside `parent` and return a handle to it. */
export function choiceRow(parent: HTMLElement, opts: ChoiceRowOptions): ChoiceRow {
	let picked = opts.initial;

	const group = parent.createDiv({ cls: 'tn-input-group' });
	group.createSpan({ text: opts.label, cls: 'tn-input-label' });
	const row = group.createDiv({
		cls: 'tn-choice',
		attr: { role: 'radiogroup', 'aria-label': opts.label },
	});

	const buttons = opts.options.map((option) => {
		const button = row.createEl('button', { text: option.label, cls: 'tn-btn tn-choice-btn' });
		// Never `submit`: inside a <form>, an unqualified button submits, so
		// picking an option would fire the dialog's primary action instead.
		button.type = 'button';
		button.setAttribute('role', 'radio');
		if (option.title) button.title = option.title;
		if (option.ariaLabel) button.setAttribute('aria-label', option.ariaLabel);
		button.addEventListener('click', () => select(option.value, true));
		// ARROW KEYS, which this file's own header has always claimed. A
		// `radiogroup` is announced as one control and AT expects arrows to move
		// within it; without them every option was a separate tab stop and the
		// promised behaviour simply did not exist.
		button.addEventListener('keydown', (e: KeyboardEvent) => {
			const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
			if (step === 0) return;
			e.preventDefault();
			const from = opts.options.findIndex((o) => o.value === picked);
			const next = opts.options[(from + step + opts.options.length) % opts.options.length];
			select(next.value, true);
			buttons.find((b) => b.option.value === next.value)?.button.focus();
		});
		return { option, button };
	});

	function select(value: string, fire: boolean): void {
		if (picked === value) return;
		picked = value;
		paint();
		if (fire) opts.onPick?.(value);
	}

	const paint = (): void => {
		for (const { option, button } of buttons) {
			const on = option.value === picked;
			button.toggleClass('tn-active', on);
			button.setAttribute('aria-checked', String(on));
			// ROVING TABINDEX: the group is ONE tab stop and the arrows move inside
			// it, which is what `role="radiogroup"` promises. Without this a row of
			// five types cost five tab stops on the way to the Apply button.
			button.tabIndex = on ? 0 : -1;
		}
	};
	paint();

	return {
		value: () => picked,
		set: (value: string) => {
			picked = value;
			paint();
		},
	};
}
