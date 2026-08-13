import { App } from 'obsidian';
import { TextPromptModal } from './simple-modals';

/** Prompt for a custom emoji/text prefix (replaces the old hand-rolled dialog). */
export class CustomEmojiModal extends TextPromptModal {
	constructor(app: App, currentValue: string, onSubmit: (value: string) => void) {
		super(app, {
			title: 'Custom emoji or text',
			label: 'Prefix',
			description:
				'Enter an emoji (🎯, ⚡) or any text to use as the prefix. Anything outside the ' +
				'plugin’s own set (◻️ 📅 🔁 ✅ ❌ 🚀 🎯) is written to the filename but not ' +
				'recognised afterwards: the note loses its explorer checkbox, its place on the ' +
				'timeline and its reminders until you give it a recognised prefix again. Nothing ' +
				'is deleted, and renaming it back restores everything.',
			initial: currentValue,
			ctaText: 'Apply',
			onResult: (value) => {
				if (value) onSubmit(value);
			},
		});
	}
}
