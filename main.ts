import { App, Plugin, TFile, WorkspaceLeaf, MarkdownView } from 'obsidian';

// Task emojis
const TASK_EMOJIS = {
	UNCHECKED: '◻️',
	SCHEDULED: '📅',
	CHECKED: '✅'
};

export default class TaskNotesPlugin extends Plugin {
	private fileExplorerObserver: MutationObserver | null = null;

	async onload() {
		console.log('Loading Task Notes Plugin');

		// Register event to update file explorer when files are renamed
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				setTimeout(() => this.updateFileExplorer(), 50);
			})
		);

		// Register event to update file explorer when files are created
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				setTimeout(() => this.updateFileExplorer(), 50);
			})
		);

		// Register event to update file explorer when files are deleted
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				setTimeout(() => this.updateFileExplorer(), 50);
			})
		);

		// Update file explorer when layout is ready
		this.app.workspace.onLayoutReady(() => {
			this.updateFileExplorer();
			this.observeFileExplorer();
		});

		// Add checkboxes to note titles using workspace leaf change events
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				setTimeout(() => this.addCheckboxToActiveNote(), 100);
			})
		);

		// Also check when switching between panes
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				setTimeout(() => this.addCheckboxToActiveNote(), 100);
			})
		);
	}

	onunload() {
		console.log('Unloading Task Notes Plugin');
		if (this.fileExplorerObserver) {
			this.fileExplorerObserver.disconnect();
		}
		this.removeAllCheckboxes();
	}

	/**
	 * Observe file explorer for dynamic changes
	 */
	observeFileExplorer() {
		const fileExplorer = document.querySelector('.nav-files-container');
		if (!fileExplorer) return;

		this.fileExplorerObserver = new MutationObserver(() => {
			this.updateFileExplorer();
		});

		this.fileExplorerObserver.observe(fileExplorer, {
			childList: true,
			subtree: true
		});
	}

	/**
	 * Update file explorer with checkboxes
	 */
	updateFileExplorer() {
		// Use setTimeout to ensure DOM is ready
		setTimeout(() => {
			const fileItems = document.querySelectorAll('.nav-file-title');
			
			fileItems.forEach((item) => {
				const titleEl = item.querySelector('.nav-file-title-content');
				if (!titleEl) return;

				const fileName = titleEl.textContent || '';
				
				// Check if file has task emoji
				if (this.hasTaskEmoji(fileName)) {
					this.addCheckboxToFileExplorer(item as HTMLElement, fileName);
				}
			});
		}, 100);
	}

	/**
	 * Check if filename contains task emoji
	 */
	hasTaskEmoji(fileName: string): boolean {
		return fileName.includes(TASK_EMOJIS.UNCHECKED) || 
		       fileName.includes(TASK_EMOJIS.SCHEDULED) ||
		       fileName.includes(TASK_EMOJIS.CHECKED);
	}

	/**
	 * Add checkbox to file explorer item
	 */
	addCheckboxToFileExplorer(item: HTMLElement, fileName: string) {
		// Check if checkbox already exists
		const existingCheckbox = item.querySelector('.task-notes-checkbox');
		if (existingCheckbox) return;

		const titleContent = item.querySelector('.nav-file-title-content');
		if (!titleContent) return;

		// Store original text if not already stored
		if (!titleContent.hasAttribute('data-original-text')) {
			titleContent.setAttribute('data-original-text', titleContent.textContent || '');
		}

		const isCompleted = fileName.includes(TASK_EMOJIS.CHECKED);
		
		// Create checkbox
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'task-list-item-checkbox task-notes-checkbox';
		checkbox.checked = isCompleted;
		
		// Add change handler
		checkbox.addEventListener('change', async (e) => {
			e.stopPropagation();
			e.preventDefault();
			await this.toggleTaskStatus(item, fileName);
		});

		// Insert checkbox at the beginning
		item.insertBefore(checkbox, titleContent);
		
		// Create a wrapper for the text without emoji
		const textWrapper = document.createElement('span');
		textWrapper.className = 'task-notes-title-text';
		
		// Remove emoji from display
		let displayText = titleContent.textContent || '';
		for (const emoji of Object.values(TASK_EMOJIS)) {
			displayText = displayText.replace(emoji, '').trim();
		}
		textWrapper.textContent = displayText;
		
		// Replace title content
		titleContent.textContent = '';
		titleContent.appendChild(textWrapper);
	}

	/**
	 * Toggle task status by renaming file
	 */
	async toggleTaskStatus(item: HTMLElement, fileName: string) {
		const titleEl = item.querySelector('.nav-file-title-content');
		if (!titleEl) return;

		// Get the file path from the data-path attribute
		const filePath = this.getFilePathFromElement(item);
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (!(file instanceof TFile)) return;

		// Use the actual current file name, not the cached one
		const currentFileName = file.name;
		let newName: string;
		
		if (currentFileName.includes(TASK_EMOJIS.CHECKED)) {
			// Unchecking: ✅ → ◻️
			newName = currentFileName.replace(TASK_EMOJIS.CHECKED, TASK_EMOJIS.UNCHECKED);
		} else if (currentFileName.includes(TASK_EMOJIS.UNCHECKED)) {
			// Checking: ◻️ → ✅
			newName = currentFileName.replace(TASK_EMOJIS.UNCHECKED, TASK_EMOJIS.CHECKED);
		} else if (currentFileName.includes(TASK_EMOJIS.SCHEDULED)) {
			// Checking: 📅 → ✅
			newName = currentFileName.replace(TASK_EMOJIS.SCHEDULED, TASK_EMOJIS.CHECKED);
		} else {
			return;
		}

		// Rename the file
		const newPath = file.parent ? `${file.parent.path}/${newName}` : newName;
		
		try {
			await this.app.fileManager.renameFile(file, newPath);
			// Force immediate update
			setTimeout(() => this.updateFileExplorer(), 100);
		} catch (error) {
			console.error('Error renaming file:', error);
			// Revert checkbox state on error
			const checkbox = item.querySelector('.task-notes-checkbox') as HTMLInputElement;
			if (checkbox) {
				checkbox.checked = !checkbox.checked;
			}
		}
	}

	/**
	 * Get file path from DOM element
	 */
	getFilePathFromElement(item: HTMLElement): string {
		const dataPath = item.getAttribute('data-path');
		if (dataPath) return dataPath;

		// Fallback: try to construct path from DOM structure
		const titleEl = item.querySelector('.nav-file-title-content');
		if (titleEl) {
			return titleEl.textContent || '';
		}

		return '';
	}

	/**
	 * Add checkbox to note title in the active note
	 */
	addCheckboxToActiveNote() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		const file = activeView.file;
		if (!file) return;

		const fileName = file.name;
		
		// Only process if file has task emoji
		if (!this.hasTaskEmoji(fileName)) return;

		// Get the title element - Obsidian displays the filename as inline-title
		const titleEl = activeView.contentEl.querySelector('.inline-title');
		if (!titleEl) return;

		// Remove existing checkbox if any
		const existingContainer = titleEl.querySelector('.task-notes-checkbox-container');
		if (existingContainer) {
			existingContainer.remove();
		}

		const isCompleted = fileName.includes(TASK_EMOJIS.CHECKED);
		
		// Create checkbox container
		const checkboxContainer = document.createElement('span');
		checkboxContainer.className = 'task-notes-checkbox-container';
		
		// Create checkbox
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'task-notes-checkbox task-list-item-checkbox';
		checkbox.checked = isCompleted;
		
		// Add change handler (instead of click)
		checkbox.addEventListener('change', async (e) => {
			e.stopPropagation();
			await this.toggleTaskStatusFromContent(file);
		});

		checkboxContainer.appendChild(checkbox);
		
		// Hide the emoji in the title text
		const titleText = titleEl.textContent || '';
		let displayText = titleText;
		for (const emoji of Object.values(TASK_EMOJIS)) {
			displayText = displayText.replace(emoji, '').trim();
		}
		
		// Clear and rebuild title content
		titleEl.textContent = displayText;
		
		// Insert checkbox at the beginning
		titleEl.insertBefore(checkboxContainer, titleEl.firstChild);
		
		// Add space after checkbox
		if (displayText) {
			const space = document.createTextNode(' ');
			titleEl.insertBefore(space, checkboxContainer.nextSibling);
		}
	}

	/**
	 * Toggle task status from note content view
	 */
	async toggleTaskStatusFromContent(file: TFile) {
		const fileName = file.name;
		let newName: string;
		
		if (fileName.includes(TASK_EMOJIS.CHECKED)) {
			// Unchecking: ✅ → ◻️
			newName = fileName.replace(TASK_EMOJIS.CHECKED, TASK_EMOJIS.UNCHECKED);
		} else if (fileName.includes(TASK_EMOJIS.UNCHECKED)) {
			// Checking: ◻️ → ✅
			newName = fileName.replace(TASK_EMOJIS.UNCHECKED, TASK_EMOJIS.CHECKED);
		} else if (fileName.includes(TASK_EMOJIS.SCHEDULED)) {
			// Checking: 📅 → ✅
			newName = fileName.replace(TASK_EMOJIS.SCHEDULED, TASK_EMOJIS.CHECKED);
		} else {
			return;
		}

		// Rename the file
		const newPath = file.parent ? `${file.parent.path}/${newName}` : newName;
		
		try {
			await this.app.fileManager.renameFile(file, newPath);
			// Update both the inline title and file explorer
			setTimeout(() => {
				this.addCheckboxToActiveNote();
				this.updateFileExplorer();
			}, 300);
		} catch (error) {
			console.error('Error renaming file:', error);
		}
	}

	/**
	 * Remove all checkboxes when plugin is unloaded
	 */
	removeAllCheckboxes() {
		document.querySelectorAll('.task-notes-checkbox').forEach(checkbox => {
			checkbox.remove();
		});
	}
}
