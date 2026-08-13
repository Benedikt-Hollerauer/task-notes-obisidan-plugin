import { App, Plugin, TFile, TFolder, type TAbstractFile } from 'obsidian';
import { isDoneRole } from '../../constants';
import { hasTaskEmoji, getNormalizedEmoji } from '../../core/emoji';
import { getBasename, notifyError } from '../../lib/obsidian-utils';

/**
 * Injects a status checkbox before task/folder titles in the file explorer.
 * The observer is childList-only and scoped to added nodes (no attribute/character
 * observing, no full re-scan per mutation) to stay cheap on large vaults.
 */
export class ExplorerDecorator {
	private observer: MutationObserver | null = null;
	private observedContainer: Element | null = null;

	constructor(
		private app: App,
		private onContextMenu: (item: TAbstractFile, event: MouseEvent) => void,
	) {}

	register(plugin: Plugin): void {
		plugin.registerEvent(this.app.vault.on('create', (f) => this.updateItem(f)));
		plugin.registerEvent(this.app.vault.on('rename', (f) => this.updateItem(f)));
		plugin.registerEvent(
			this.app.workspace.on('layout-change', () => this.ensureObserver()),
		);
	}

	start(): void {
		this.ensureObserver();
	}

	stop(): void {
		this.observer?.disconnect();
		this.observer = null;
		this.observedContainer = null;
		document.querySelectorAll('.task-notes-explorer-checkbox').forEach((el) => el.remove());
	}

	/**
	 * The file explorer's own root element, via the workspace rather than a
	 * document-wide selector.
	 *
	 * `document.querySelector('.nav-files-container')` reached into core's DOM from
	 * the whole document — it would find any pane's list, and it is the shape the
	 * plugin guidelines call out. Asking the workspace for the leaf gives us the
	 * one explorer we mean, and returns nothing when it is closed.
	 */
	private explorerRoot(): HTMLElement | null {
		const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
		return leaf?.view.containerEl ?? null;
	}

	private ensureObserver(): void {
		const container = this.explorerRoot()?.querySelector('.nav-files-container');
		if (!container) return;
		// Obsidian can replace the file-explorer DOM (workspace changes); rebind to the
		// live container instead of clinging to a detached node.
		if (this.observer && this.observedContainer === container && container.isConnected) return;

		this.observer?.disconnect();
		this.observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				mutation.addedNodes.forEach((node) => {
					if (node instanceof HTMLElement) this.processAddedNode(node);
				});
			}
		});
		this.observer.observe(container, { childList: true, subtree: true });
		this.observedContainer = container;
		this.decorateAll();
	}

	private processAddedNode(node: HTMLElement): void {
		const titles = node.matches?.('.nav-file-title, .nav-folder-title')
			? [node]
			: Array.from(node.querySelectorAll<HTMLElement>('.nav-file-title, .nav-folder-title'));
		for (const el of titles) {
			const path = el.getAttribute('data-path');
			if (!path) continue;
			const item = this.app.vault.getAbstractFileByPath(path);
			if (item) this.updateItem(item);
		}
	}

	private decorateAll(): void {
		this.app.vault.getMarkdownFiles().forEach((f) => this.updateItem(f));
		this.app.vault.getAllFolders().forEach((f) => this.updateItem(f));
	}

	private updateItem(item: TAbstractFile): void {
		if (item instanceof TFile && item.extension !== 'md') return;

		const el = this.explorerElement(item);
		if (!el) return;

		const basename = getBasename(item);

		const existing = el.querySelector('.task-notes-explorer-checkbox');
		if (!hasTaskEmoji(basename)) {
			existing?.remove();
			return;
		}

		const emoji = getNormalizedEmoji(basename);
		if (existing) {
			if (existing.getAttribute('data-emoji') === emoji) return;
			existing.remove();
		}

		const checkbox = this.createCheckbox(emoji, item);
		const contentSel = item instanceof TFolder ? '.nav-folder-title-content' : '.nav-file-title-content';
		const content = el.querySelector(contentSel);
		if (content) content.insertBefore(checkbox, content.firstChild);
	}

	private createCheckbox(emoji: string, item: TAbstractFile): HTMLInputElement {
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'task-notes-checkbox task-notes-explorer-checkbox';
		checkbox.checked = isDoneRole(emoji);
		// NOT `disabled` — Chromium drops all mouse events (incl. contextmenu) on
		// disabled controls, which would make the right-click menu unreachable.
		checkbox.setAttribute('aria-disabled', 'true');
		checkbox.tabIndex = -1;
		checkbox.setAttribute('data-emoji', emoji);
		checkbox.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		checkbox.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			try {
				this.onContextMenu(item, e);
			} catch (err) {
				notifyError('Failed to open context menu', err);
			}
		});
		return checkbox;
	}

	private explorerElement(item: TAbstractFile): HTMLElement | null {
		const selector = item instanceof TFolder ? '.nav-folder-title' : '.nav-file-title';
		return (
			this.explorerRoot()?.querySelector<HTMLElement>(
				`${selector}[data-path="${CSS.escape(item.path)}"]`,
			) ?? null
		);
	}
}
