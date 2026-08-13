import { TFile, TFolder, type TAbstractFile, Notice, type Menu } from 'obsidian';

/** Display name of a file (without extension) or folder. */
export function getBasename(item: TAbstractFile): string {
	return item instanceof TFile ? item.basename : item.name;
}

/** Show a user-facing notice and log the error to the console. */
export function notifyError(userMessage: string, error?: unknown): void {
	new Notice(userMessage);
	if (error !== undefined) console.error(userMessage, error);
}

/** Narrow to a markdown TFile. */
export function isMarkdownFile(item: TAbstractFile | null): item is TFile {
	return item instanceof TFile && item.extension === 'md';
}

/** Narrow to a folder. */
export function isFolder(item: TAbstractFile | null): item is TFolder {
	return item instanceof TFolder;
}

/** The human-readable half of an unknown thrown value. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Open a menu, surfacing a failure instead of throwing into a DOM handler.
 * Three of the four menu sites already did this; the fourth silently didn't.
 */
export function showMenuSafely(menu: Menu, mouseEvent: MouseEvent): void {
	try {
		menu.showAtMouseEvent(mouseEvent);
	} catch (error) {
		notifyError('Failed to open menu', error);
	}
}

/**
 * A two-line notice in the plugin's own shape: THE MESSAGE, at the size of
 * something worth reading, and underneath it the note the message is about.
 *
 * The order matters and used to be the other way round — the note's filename
 * was the headline and the actual sentence was a grey subtitle, so a refusal to
 * write read as "here is a filename" and you had to hunt for the reason. What
 * happened leads; which note it happened to supports it.
 *
 * The same component every message the plugin sends uses, so a reminder, a
 * refusal and a failing calendar all read the same way. `warn` paints the edge
 * in the warning colour for the ones that genuinely need attention.
 *
 * The plain-string MESSAGE keeps the same order — it is what a screen reader
 * announces and what Obsidian falls back to — and the element is rebuilt on it.
 */
export function structuredNotice(
	message: string,
	note: string,
	opts: { warn?: boolean; timeoutMs?: number } = {},
): Notice {
	const notice = new Notice(`${message} — ${note}`, opts.timeoutMs ?? 10_000);
	const el = notice.messageEl;
	el.addClass('task-notes-notice');
	if (opts.warn) el.addClass('task-notes-notice-warn');
	el.empty();
	el.createDiv({ text: message, cls: 'task-notes-notice-message' });
	el.createDiv({ text: note, cls: 'task-notes-notice-note' });
	return notice;
}
