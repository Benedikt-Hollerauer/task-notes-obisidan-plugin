import { App } from 'obsidian';
import { TextPromptModal } from './simple-modals';

/** Prompt for a custom emoji/text prefix (replaces the old hand-rolled dialog). */
export class CustomEmojiModal extends TextPromptModal {
	constructor(app: App, currentValue: string, onSubmit: (value: string) => void) {
		super(app, {
			title: 'Custom emoji or text',
			label: 'Prefix',
			description: 'Enter an emoji (🎯, ⚡) or any text to use as the prefix.',
			initial: currentValue,
			ctaText: 'Apply',
			onResult: (value) => {
				if (value) onSubmit(value);
			},
		});
	}
}
