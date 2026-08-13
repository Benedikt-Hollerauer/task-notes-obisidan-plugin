import { AbstractInputSuggest, type App, TFile, prepareFuzzySearch } from 'obsidian';
import { wikilinkFragment, spliceWikilink, autoCloseWikilink } from '../../core/wikilink';

/** Enough to choose from without building a list nobody scrolls. */
const SUGGEST_LIMIT = 50;

/** Autocomplete a template file path in a settings text input. */
export class TemplateFileSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		private inputEl: HTMLInputElement,
		private getFiles: () => TFile[],
	) {
		super(app, inputEl);
		// Scope our styling to this suggester: `.suggestion-container` is a core
		// Obsidian class, and unscoped rules would restyle the quick switcher,
		// command palette and every other plugin's suggesters.
		const suggestEl = (this as unknown as { suggestEl?: HTMLElement }).suggestEl;
		suggestEl?.addClass('task-notes-suggest');
	}

	protected getSuggestions(query: string): TFile[] {
		const files = this.getFiles();
		const q = query.toLowerCase();
		if (!q) return files.slice(0, 100);
		return files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 100);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.inputEl.value = file.path;
		this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
		this.close();
	}
}

/**
 * Suggest a vault note for an in-progress `[[…` in a plain text input, the way
 * typing `[[` behaves in a note.
 *
 * Splices rather than replacing the field: the input it attaches to is a line of
 * free text that may already say something either side of the link.
 */
export class WikilinkSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		private inputEl: HTMLInputElement,
	) {
		super(app, inputEl);
		const suggestEl = (this as unknown as { suggestEl?: HTMLElement }).suggestEl;
		suggestEl?.addClass('task-notes-suggest');

		// Close `[[` as it is typed, like the editor does. Every field that already
		// has this suggester gets it, because it is wired here rather than at each
		// call site. `beforeinput` would be tidier but is not fired consistently
		// for every input method; reacting to the value is reliable everywhere.
		inputEl.addEventListener('input', () => {
			const next = autoCloseWikilink(inputEl.value, inputEl.selectionStart ?? inputEl.value.length);
			if (!next) return;
			inputEl.value = next.value;
			inputEl.setSelectionRange(next.caret, next.caret);
		});
	}

	protected getSuggestions(query: string): TFile[] {
		// The query is the WHOLE field; only the unfinished `[[…` at the caret
		// should search, or every keystroke of ordinary prose opens the popover.
		const caret = this.inputEl.selectionStart ?? query.length;
		const fragment = wikilinkFragment(query, caret);
		if (!fragment) return [];
		const files = this.app.vault.getMarkdownFiles();
		if (!fragment.query.trim()) {
			return [...files].sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, SUGGEST_LIMIT);
		}
		const search = prepareFuzzySearch(fragment.query);
		const hits: { file: TFile; score: number }[] = [];
		for (const file of files) {
			const match = search(file.basename) ?? search(file.path);
			if (match) hits.push({ file, score: match.score });
		}
		return hits
			.sort((a, b) => b.score - a.score)
			.slice(0, SUGGEST_LIMIT)
			.map((h) => h.file);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		// The basename is what goes into the link; the folder is only disambiguation.
		el.createDiv({ text: file.basename });
		const folder = file.parent?.path;
		if (folder && folder !== '/') el.createDiv({ text: folder, cls: 'tn-suggest-path' });
	}

	selectSuggestion(file: TFile): void {
		const caret = this.inputEl.selectionStart ?? this.inputEl.value.length;
		const next = spliceWikilink(this.inputEl.value, caret, file.basename);
		this.inputEl.value = next.value;
		this.inputEl.setSelectionRange(next.caret, next.caret);
		// The host reads its value from `input` events, not from us.
		this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
		this.close();
		this.inputEl.focus();
	}
}
