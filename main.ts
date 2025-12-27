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
				this.updateFileExplorer();
			})
		);

		// Register event to update file explorer when files are created
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				this.updateFileExplorer();
			})
		);

		// Register event to update file explorer when files are deleted
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				this.updateFileExplorer();
			})
		);

		// Update file explorer when layout is ready
		this.app.workspace.onLayoutReady(() => {
			this.updateFileExplorer();
			this.observeFileExplorer();
		});

		// Register markdown post-processor for note content
		this.registerMarkdownPostProcessor((element, context) => {
			this.addCheckboxToNoteTitle(element, context);
		});
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
		if (item.querySelector('.task-notes-checkbox')) return;

		const isCompleted = fileName.includes(TASK_EMOJIS.CHECKED);
		
		// Create checkbox
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'task-notes-checkbox task-list-item-checkbox';
		checkbox.checked = isCompleted;
		
		// Add click handler
		checkbox.addEventListener('click', async (e) => {
			e.stopPropagation();
			await this.toggleTaskStatus(item, fileName);
		});

		// Insert checkbox at the beginning
		const titleContent = item.querySelector('.nav-file-title-content');
		if (titleContent) {
			item.insertBefore(checkbox, titleContent);
		}
	}

	/**
	 * Toggle task status by renaming file
	 */
	async toggleTaskStatus(item: HTMLElement, fileName: string) {
		const titleEl = item.querySelector('.nav-file-title-content');
		if (!titleEl) return;

		// Get the file
		const file = this.app.vault.getAbstractFileByPath(
			this.getFilePathFromElement(item)
		);

		if (!(file instanceof TFile)) return;

		let newName: string;
		
		if (fileName.includes(TASK_EMOJIS.CHECKED)) {
			// Unchecking: ✅ → ◻️
			newName = fileName.replace(TASK_EMOJIS.CHECKED, TASK_EMOJIS.UNCHECKED);
		} else {
			// Checking: ◻️ or 📅 → ✅
			newName = fileName
				.replace(TASK_EMOJIS.UNCHECKED, TASK_EMOJIS.CHECKED)
				.replace(TASK_EMOJIS.SCHEDULED, TASK_EMOJIS.CHECKED);
		}

		// Rename the file
		const newPath = file.parent ? `${file.parent.path}/${newName}` : newName;
		
		try {
			await this.app.fileManager.renameFile(file, newPath);
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
	 * Add checkbox to note title in the content view
	 */
	addCheckboxToNoteTitle(element: HTMLElement, context: any) {
		// Get the active file
		const file = this.app.workspace.getActiveFile();
		if (!file) return;

		const fileName = file.basename + '.md';
		
		// Only process if file has task emoji
		if (!this.hasTaskEmoji(fileName)) return;

		// Find the title (h1) in the element
		const headings = element.querySelectorAll('h1');
		
		headings.forEach((heading) => {
			// Check if this heading contains the filename (Obsidian auto-title)
			const headingText = heading.textContent || '';
			
			if (headingText.includes(file.basename)) {
				// Check if checkbox already exists
				if (heading.querySelector('.task-notes-checkbox')) return;

				const isCompleted = fileName.includes(TASK_EMOJIS.CHECKED);
				
				// Create checkbox
				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.className = 'task-notes-checkbox task-list-item-checkbox';
				checkbox.checked = isCompleted;
				
				// Add click handler
				checkbox.addEventListener('click', async (e) => {
					e.stopPropagation();
					await this.toggleTaskStatusFromContent(file);
				});

				// Insert checkbox at the beginning of heading
				heading.insertBefore(checkbox, heading.firstChild);
				
				// Add some spacing
				if (heading.firstChild) {
					const space = document.createTextNode(' ');
					heading.insertBefore(space, heading.firstChild.nextSibling);
				}
			}
		});
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
		} else {
			// Checking: ◻️ or 📅 → ✅
			newName = fileName
				.replace(TASK_EMOJIS.UNCHECKED, TASK_EMOJIS.CHECKED)
				.replace(TASK_EMOJIS.SCHEDULED, TASK_EMOJIS.CHECKED);
		}

		// Rename the file
		const newPath = file.parent ? `${file.parent.path}/${newName}` : newName;
		
		try {
			await this.app.fileManager.renameFile(file, newPath);
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
