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
				// Remove any existing checkbox first
				const existingCheckbox = item.querySelector('.task-notes-checkbox');
				if (existingCheckbox) {
					existingCheckbox.remove();
				}

				const titleEl = item.querySelector('.nav-file-title-content');
				if (!titleEl) return;

				// Get the actual file to check current name
				const filePath = (item as HTMLElement).getAttribute('data-path');
				if (!filePath) return;

				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (!(file instanceof TFile)) return;

				const fileName = file.name;
				
				// Check if file has task emoji based on actual filename
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
		const titleContent = item.querySelector('.nav-file-title-content');
		if (!titleContent) return;

		// Determine checkbox state from actual filename
		const isCompleted = fileName.includes(TASK_EMOJIS.CHECKED);
		
		// Create checkbox
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'task-list-item-checkbox task-notes-checkbox';
		checkbox.checked = isCompleted;
		
		// Store file path on checkbox for easy access
		const filePath = item.getAttribute('data-path');
		
		// Keep pointer events local to the checkbox so the file row doesn't steal the click
		// Disable interaction in file explorer; display-only
		checkbox.disabled = true;
		checkbox.tabIndex = -1;

		// Insert checkbox at the beginning
		item.insertBefore(checkbox, titleContent);
		
		// Get original text and remove ALL emojis
		let displayText = fileName;
		
		// Remove .md extension
		if (displayText.endsWith('.md')) {
			displayText = displayText.slice(0, -3);
		}
		
		// Remove each emoji character completely
		for (const emoji of Object.values(TASK_EMOJIS)) {
			while (displayText.includes(emoji)) {
				displayText = displayText.replace(emoji, '');
			}
		}
		
		// Clean up whitespace
		displayText = displayText.trim();
		
		// Completely replace the text content
		titleContent.textContent = displayText;
	}

	/**
	 * Toggle task status by renaming file
	 */
	async toggleTaskStatus(item: HTMLElement, fileName: string) {
		const filePath = item.getAttribute('data-path');
		if (!filePath) return;

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;

		await this.toggleTaskStatusFromFile(file);
	}

	/**
	 * Toggle task status from a file object
	 */
	async toggleTaskStatusFromFile(file: TFile) {
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
			// Update file explorer after a short delay
			setTimeout(() => this.updateFileExplorer(), 150);
		} catch (error) {
			console.error('Error renaming file:', error);
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
		
		// Get the display text - keep emoji visible, just set it to the filename
		const titleText = fileName;
		
		// Clear and rebuild title content
		titleEl.textContent = titleText;
		
		// Insert checkbox at the beginning
		titleEl.insertBefore(checkboxContainer, titleEl.firstChild);
		
		// Add space after checkbox
		const space = document.createTextNode(' ');
		titleEl.insertBefore(space, checkboxContainer.nextSibling);

		// Set data attribute to track that we've processed this title
		titleEl.setAttribute('data-processed', 'true');
		
		// Watch for title changes and restore checkbox if it gets removed
		if (!titleEl.getAttribute('data-observer-set')) {
			const observer = new MutationObserver(() => {
				// If checkbox was removed, re-add it
				const checkbox = titleEl.querySelector('.task-notes-checkbox-container');
				if (!checkbox) {
					// Rebuild the checkbox
					const container = document.createElement('span');
					container.className = 'task-notes-checkbox-container';
					
					const cb = document.createElement('input');
					cb.type = 'checkbox';
					cb.className = 'task-notes-checkbox task-list-item-checkbox';
					cb.checked = isCompleted;
					cb.addEventListener('change', async (e) => {
						e.stopPropagation();
						await this.toggleTaskStatusFromContent(file);
					});
					
					container.appendChild(cb);
					titleEl.insertBefore(container, titleEl.firstChild);
					
					const space = document.createTextNode(' ');
					titleEl.insertBefore(space, container.nextSibling);
				}
				
				// Make sure text content matches the filename (preserves emoji)
				const currentText = titleEl.textContent || '';
				if (!currentText.includes(fileName.slice(0, -3))) {
					// Reconstruct: just ensure we have checkbox + space + filename
					const checkbox = titleEl.querySelector('.task-notes-checkbox-container');
					if (checkbox) {
						titleEl.textContent = fileName;
						titleEl.insertBefore(checkbox, titleEl.firstChild);
						const space = document.createTextNode(' ');
						titleEl.insertBefore(space, checkbox.nextSibling);
					}
				}
			});
			
			observer.observe(titleEl, {
				characterData: true,
				childList: true,
				subtree: true
			});
			
			titleEl.setAttribute('data-observer-set', 'true');
		}
	}

	/**
	 * Toggle task status from note content view
	 */
	async toggleTaskStatusFromContent(file: TFile) {
		await this.toggleTaskStatusFromFile(file);
		// Refresh both views shortly after rename so checkbox stays visible
		setTimeout(() => {
			this.addCheckboxToActiveNote();
			this.updateFileExplorer();
		}, 180);
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
