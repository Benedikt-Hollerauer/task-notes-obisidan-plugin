import { App, Plugin, TFile, TAbstractFile, Menu, Notice, WorkspaceLeaf } from 'obsidian';

// Task emoji constants
const TASK_EMOJIS = {
	UNCHECKED: '◻️',
	SCHEDULED: '📅',
	CHECKED: '✅'
} as const;

const TASK_EMOJI_REGEX = /^(◻️|📅|✅)\s+(.+)$/;

export default class TaskNotesPlugin extends Plugin {
	private titleCheckboxObserver: MutationObserver | null = null;
	private fileExplorerObserver: MutationObserver | null = null;

	async onload() {
		console.log('Loading Task Notes Plugin');

		// Register event handlers for vault changes
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				this.handleFileRename(file, oldPath);
			})
		);

		this.registerEvent(
			this.app.vault.on('create', (file) => {
				this.handleFileCreate(file);
			})
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				this.handleFileDelete(file);
			})
		);

		// Register workspace events for title checkbox
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				this.updateTitleCheckbox(file);
			})
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf) {
					const file = this.app.workspace.getActiveFile();
					this.updateTitleCheckbox(file);
				}
			})
		);

		// Register context menu for file explorer
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				this.addFileContextMenu(menu, file);
			})
		);

		// Initialize file explorer checkboxes after layout is ready
		this.app.workspace.onLayoutReady(() => {
			this.initializeFileExplorer();
			this.updateTitleCheckbox(this.app.workspace.getActiveFile());
		});
	}

	onunload() {
		console.log('Unloading Task Notes Plugin');
		
		// Clean up observers
		if (this.titleCheckboxObserver) {
			this.titleCheckboxObserver.disconnect();
			this.titleCheckboxObserver = null;
		}
		
		if (this.fileExplorerObserver) {
			this.fileExplorerObserver.disconnect();
			this.fileExplorerObserver = null;
		}
		
		// Remove all checkboxes from file explorer
		this.cleanupFileExplorerCheckboxes();
		
		// Remove title checkbox
		this.removeTitleCheckbox();
	}

	/**
	 * Initialize file explorer with checkboxes for existing task files
	 */
	private initializeFileExplorer() {
		// Find all markdown files and add checkboxes where appropriate
		const files = this.app.vault.getMarkdownFiles();
		files.forEach(file => {
			this.updateFileExplorerItem(file);
		});

		// Set up mutation observer to watch for file explorer changes
		this.setupFileExplorerObserver();
	}

	/**
	 * Set up MutationObserver to watch for file explorer DOM changes
	 */
	private setupFileExplorerObserver() {
		const fileExplorerContainer = document.querySelector('.nav-files-container');
		
		if (!fileExplorerContainer) {
			return;
		}

		this.fileExplorerObserver = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((node) => {
					if (node instanceof HTMLElement) {
						this.processFileExplorerNode(node);
					}
				});
			});
		});

		this.fileExplorerObserver.observe(fileExplorerContainer, {
			childList: true,
			subtree: true
		});
	}

	/**
	 * Process a file explorer node and add checkboxes if needed
	 */
	private processFileExplorerNode(node: HTMLElement) {
		// Check if this is a file item
		const fileItems = node.querySelectorAll('.nav-file-title');
		fileItems.forEach((fileItem) => {
			const fileName = fileItem.getAttribute('data-path');
			if (fileName) {
				const file = this.app.vault.getAbstractFileByPath(fileName);
				if (file instanceof TFile && file.extension === 'md') {
					this.updateFileExplorerItem(file);
				}
			}
		});
	}

	/**
	 * Update file explorer item with checkbox based on task status
	 */
	private updateFileExplorerItem(file: TFile) {
		const fileItem = this.getFileExplorerElement(file);
		if (!fileItem) {
			return;
		}

		// Remove existing checkbox if any
		const existingCheckbox = fileItem.querySelector('.task-notes-checkbox');
		if (existingCheckbox) {
			existingCheckbox.remove();
		}

		const match = file.basename.match(TASK_EMOJI_REGEX);
		if (!match) {
			return;
		}

		const [, emoji] = match;
		const checkbox = this.createCheckbox(emoji, false); // read-only in file explorer

		// Insert checkbox at the beginning of the title
		const titleContent = fileItem.querySelector('.nav-file-title-content');
		if (titleContent) {
			titleContent.insertBefore(checkbox, titleContent.firstChild);
		}
	}

	/**
	 * Get the file explorer DOM element for a file
	 */
	private getFileExplorerElement(file: TFile): HTMLElement | null {
		const fileItems = document.querySelectorAll('.nav-file-title');
		for (let i = 0; i < fileItems.length; i++) {
			const item = fileItems[i] as HTMLElement;
			if (item.getAttribute('data-path') === file.path) {
				return item;
			}
		}
		return null;
	}

	/**
	 * Create a checkbox element
	 */
	private createCheckbox(emoji: string, interactive: boolean = true): HTMLElement {
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'task-notes-checkbox';
		checkbox.checked = emoji === TASK_EMOJIS.CHECKED;
		checkbox.disabled = !interactive;
		
		checkbox.style.marginRight = '0.5em';
		checkbox.style.cursor = interactive ? 'pointer' : 'default';

		return checkbox;
	}

	/**
	 * Update the title checkbox for the currently active file
	 */
	private updateTitleCheckbox(file: TFile | null) {
		// Remove existing checkbox and observer
		this.removeTitleCheckbox();

		if (!file) {
			return;
		}

		const match = file.basename.match(TASK_EMOJI_REGEX);
		if (!match) {
			return;
		}

		const [, emoji] = match;
		const titleEl = this.getTitleElement();
		
		if (!titleEl) {
			return;
		}

		// Create and insert checkbox
		const checkbox = this.createCheckbox(emoji, true);
		checkbox.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.handleTitleCheckboxClick(file, emoji);
		});

		titleEl.insertBefore(checkbox, titleEl.firstChild);

		// Set up mutation observer to watch for title changes
		this.setupTitleObserver(file);
	}

	/**
	 * Set up MutationObserver to watch for title DOM changes
	 */
	private setupTitleObserver(file: TFile) {
		const titleEl = this.getTitleElement();
		if (!titleEl) {
			return;
		}

		this.titleCheckboxObserver = new MutationObserver(() => {
			// Check if checkbox still exists
			const existingCheckbox = titleEl.querySelector('.task-notes-checkbox');
			if (!existingCheckbox) {
				// Checkbox was removed, re-add it
				this.updateTitleCheckbox(file);
			}
		});

		this.titleCheckboxObserver.observe(titleEl, {
			childList: true,
			subtree: false
		});
	}

	/**
	 * Get the title element from the DOM
	 */
	private getTitleElement(): HTMLElement | null {
		return document.querySelector('.view-header-title-container') || 
		       document.querySelector('.inline-title');
	}

	/**
	 * Remove the title checkbox
	 */
	private removeTitleCheckbox() {
		if (this.titleCheckboxObserver) {
			this.titleCheckboxObserver.disconnect();
			this.titleCheckboxObserver = null;
		}

		const titleEl = this.getTitleElement();
		if (titleEl) {
			const checkbox = titleEl.querySelector('.task-notes-checkbox');
			if (checkbox) {
				checkbox.remove();
			}
		}
	}

	/**
	 * Handle checkbox click in the title
	 */
	private async handleTitleCheckboxClick(file: TFile, currentEmoji: string) {
		const newEmoji = this.getNextEmoji(currentEmoji);
		const newName = file.basename.replace(TASK_EMOJI_REGEX, `${newEmoji} $2`);
		const newPath = file.parent ? `${file.parent.path}/${newName}.${file.extension}` : `${newName}.${file.extension}`;

		try {
			await this.app.fileManager.renameFile(file, newPath);
		} catch (error) {
			new Notice(`Failed to rename file: ${error.message}`);
			console.error('Error renaming file:', error);
		}
	}

	/**
	 * Get the next emoji in the sequence (for checkbox click)
	 */
	private getNextEmoji(currentEmoji: string): string {
		if (currentEmoji === TASK_EMOJIS.CHECKED) {
			return TASK_EMOJIS.UNCHECKED;
		}
		return TASK_EMOJIS.CHECKED;
	}

	/**
	 * Handle file rename events
	 */
	private handleFileRename(file: TAbstractFile, oldPath: string) {
		if (file instanceof TFile && file.extension === 'md') {
			// Update file explorer
			this.updateFileExplorerItem(file);
			
			// Update title if this is the active file
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile && activeFile.path === file.path) {
				this.updateTitleCheckbox(file);
			}
		}
	}

	/**
	 * Handle file create events
	 */
	private handleFileCreate(file: TAbstractFile) {
		if (file instanceof TFile && file.extension === 'md') {
			this.updateFileExplorerItem(file);
		}
	}

	/**
	 * Handle file delete events
	 */
	private handleFileDelete(file: TAbstractFile) {
		if (file instanceof TFile && file.extension === 'md') {
			// File explorer item will be automatically removed by Obsidian
			// Just ensure we clean up any references
		}
	}

	/**
	 * Add context menu items to file explorer
	 */
	private addFileContextMenu(menu: Menu, file: TAbstractFile) {
		// Only add menu for markdown files
		if (!(file instanceof TFile) || file.extension !== 'md') {
			return;
		}

		const match = file.basename.match(TASK_EMOJI_REGEX);
		const hasTaskEmoji = !!match;

		if (!hasTaskEmoji) {
			// Add options to convert to task or event
			menu.addItem((item) => {
				item
					.setTitle('Convert to Unchecked Task ◻️')
					.setIcon('checkbox-glyph')
					.onClick(async () => {
						await this.convertToTask(file, TASK_EMOJIS.UNCHECKED);
					});
			});

			menu.addItem((item) => {
				item
					.setTitle('Convert to Scheduled Task 📅')
					.setIcon('calendar-glyph')
					.onClick(async () => {
						await this.convertToTask(file, TASK_EMOJIS.SCHEDULED);
					});
			});

			menu.addItem((item) => {
				item
					.setTitle('Convert to Completed Task ✅')
					.setIcon('checkmark')
					.onClick(async () => {
						await this.convertToTask(file, TASK_EMOJIS.CHECKED);
					});
			});
		} else {
			// Add option to remove task emoji
			menu.addItem((item) => {
				item
					.setTitle('Remove Task Status')
					.setIcon('cross')
					.onClick(async () => {
						await this.removeTaskEmoji(file);
					});
			});

			// Add options to change task status
			const currentEmoji = match[1];
			
			if (currentEmoji !== TASK_EMOJIS.UNCHECKED) {
				menu.addItem((item) => {
					item
						.setTitle('Mark as Unchecked ◻️')
						.setIcon('checkbox-glyph')
						.onClick(async () => {
							await this.changeTaskStatus(file, TASK_EMOJIS.UNCHECKED);
						});
				});
			}

			if (currentEmoji !== TASK_EMOJIS.SCHEDULED) {
				menu.addItem((item) => {
					item
						.setTitle('Mark as Scheduled 📅')
						.setIcon('calendar-glyph')
						.onClick(async () => {
							await this.changeTaskStatus(file, TASK_EMOJIS.SCHEDULED);
						});
				});
			}

			if (currentEmoji !== TASK_EMOJIS.CHECKED) {
				menu.addItem((item) => {
					item
						.setTitle('Mark as Completed ✅')
						.setIcon('checkmark')
						.onClick(async () => {
							await this.changeTaskStatus(file, TASK_EMOJIS.CHECKED);
						});
				});
			}
		}
	}

	/**
	 * Convert a regular file to a task by adding emoji prefix
	 */
	private async convertToTask(file: TFile, emoji: string) {
		const newName = `${emoji} ${file.basename}`;
		const newPath = file.parent ? `${file.parent.path}/${newName}.${file.extension}` : `${newName}.${file.extension}`;

		try {
			await this.app.fileManager.renameFile(file, newPath);
			new Notice(`Converted to task: ${newName}`);
		} catch (error) {
			new Notice(`Failed to convert file: ${error.message}`);
			console.error('Error converting file:', error);
		}
	}

	/**
	 * Remove task emoji from filename
	 */
	private async removeTaskEmoji(file: TFile) {
		const match = file.basename.match(TASK_EMOJI_REGEX);
		if (!match) {
			return;
		}

		const [, , nameWithoutEmoji] = match;
		const newPath = file.parent ? `${file.parent.path}/${nameWithoutEmoji}.${file.extension}` : `${nameWithoutEmoji}.${file.extension}`;

		try {
			await this.app.fileManager.renameFile(file, newPath);
			new Notice(`Removed task status from: ${nameWithoutEmoji}`);
		} catch (error) {
			new Notice(`Failed to remove task status: ${error.message}`);
			console.error('Error removing task status:', error);
		}
	}

	/**
	 * Change task status emoji
	 */
	private async changeTaskStatus(file: TFile, newEmoji: string) {
		const match = file.basename.match(TASK_EMOJI_REGEX);
		if (!match) {
			return;
		}

		const [, , nameWithoutEmoji] = match;
		const newName = `${newEmoji} ${nameWithoutEmoji}`;
		const newPath = file.parent ? `${file.parent.path}/${newName}.${file.extension}` : `${newName}.${file.extension}`;

		try {
			await this.app.fileManager.renameFile(file, newPath);
		} catch (error) {
			new Notice(`Failed to change task status: ${error.message}`);
			console.error('Error changing task status:', error);
		}
	}

	/**
	 * Clean up all file explorer checkboxes
	 */
	private cleanupFileExplorerCheckboxes() {
		const checkboxes = document.querySelectorAll('.task-notes-checkbox');
		checkboxes.forEach(checkbox => checkbox.remove());
	}
}
