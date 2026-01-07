import { App, Plugin, TFile, TAbstractFile, Menu, Notice, WorkspaceLeaf, PluginSettingTab, Setting, normalizePath, TextComponent } from 'obsidian';
import { FuzzySuggestModal, SuggestModal } from 'obsidian';

// Plugin settings interface
interface TaskNotesSettings {
	uncheckedTaskTemplate: string;
	scheduledTaskTemplate: string;
	completedTaskTemplate: string;
	applyTemplateOnConvert: boolean;
}

// Default settings
const DEFAULT_SETTINGS: TaskNotesSettings = {
	uncheckedTaskTemplate: '',
	scheduledTaskTemplate: '',
	completedTaskTemplate: '',
	applyTemplateOnConvert: true
};

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
	private fileUncheckedState: Map<string, boolean> = new Map();
	settings: TaskNotesSettings;

	async onload() {
		console.log('Loading Task Notes Plugin');

		// Load settings
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new TaskNotesSettingTab(this.app, this));

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

		// Initialize todo state map for all markdown files
		await this.initializeTodoState();

		// React to content edits to auto-reopen if new unchecked todos are introduced
		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					await this.handleFileModify(file);
				}
			})
		);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
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

		// Clear state
		this.fileUncheckedState.clear();
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

		// Guard: Only allow marking as completed when all markdown todos are checked
		if (newEmoji === TASK_EMOJIS.CHECKED) {
			const allChecked = await this.areAllMarkdownTodosChecked(file);
			if (!allChecked) {
				new Notice('Please complete all checklist items in the note first.');
				return;
			}
		}

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
	 * Check if all markdown todo items ("- [ ]") in the note body are checked
	 */
	private async areAllMarkdownTodosChecked(file: TFile): Promise<boolean> {
		try {
			const content = await this.app.vault.read(file);
			// Fast path: if no todos present, allow completion
			const hasAnyTodo = /(^|\n)\s*[-*+]\s+\[[ xX]\]/m.test(content);
			if (!hasAnyTodo) return true;

			// If there is at least one todo, ensure none are unchecked "[ ]"
			const hasUnchecked = /(^|\n)\s*[-*+]\s+\[\s?\]\s+/m.test(content);
			return !hasUnchecked;
		} catch (e) {
			console.error('Error reading file to check todos:', e);
			// Fail safe: do not block if read fails
			return true;
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

			// Move tracked state from old path to new path
			const prev = this.fileUncheckedState.get(oldPath);
			if (typeof prev === 'boolean') {
				this.fileUncheckedState.delete(oldPath);
				this.fileUncheckedState.set(file.path, prev);
			}
		}
	}

	/**
	 * Handle file create events
	 */
	private handleFileCreate(file: TAbstractFile) {
		if (file instanceof TFile && file.extension === 'md') {
			this.updateFileExplorerItem(file);
			// Initialize state for new file
			this.refreshFileUncheckedState(file).catch(() => {});
		}
	}

	/**
	 * Handle file delete events
	 */
	private handleFileDelete(file: TAbstractFile) {
		if (file instanceof TFile && file.extension === 'md') {
			// File explorer item will be automatically removed by Obsidian
			// Just ensure we clean up any references
			this.fileUncheckedState.delete(file.path);
		}
	}

	/**
	 * Initialize per-file unchecked state map at load to enable accurate change detection
	 */
	private async initializeTodoState() {
		const files = this.app.vault.getMarkdownFiles();
		for (const f of files) {
			await this.refreshFileUncheckedState(f);
		}
	}

	/** Update tracked state for a file by scanning its content */
	private async refreshFileUncheckedState(file: TFile) {
		try {
			const content = await this.app.vault.read(file);
			const hasUnchecked = /(^|\n)\s*[-*+]\s+\[\s?\]\s+/m.test(content);
			this.fileUncheckedState.set(file.path, hasUnchecked);
		} catch (e) {
			// Ignore read errors
		}
	}

	/** Handle file content modifications to auto-reopen checked tasks */
	private async handleFileModify(file: TFile) {
		let prev = this.fileUncheckedState.get(file.path);
		try {
			const content = await this.app.vault.read(file);
			const hasUnchecked = /(^|\n)\s*[-*+]\s+\[\s?\]\s+/m.test(content);
			// If we don't have previous state (e.g., very first observed edit), initialize it
			if (typeof prev !== 'boolean') {
				this.fileUncheckedState.set(file.path, hasUnchecked);
				return;
			}

			// Only act when a transition from no unchecked -> has unchecked occurs
			if (!prev && hasUnchecked) {
				const match = file.basename.match(TASK_EMOJI_REGEX);
				if (match && match[1] === TASK_EMOJIS.CHECKED) {
					// Reopen the task by switching to unchecked
					await this.changeTaskStatus(file, TASK_EMOJIS.UNCHECKED);
					new Notice('Note contains unchecked checklist items. Reopening task to ◻️.');
				}
			}
			// Update tracked state
			this.fileUncheckedState.set(file.path, hasUnchecked);
		} catch (e) {
			// On error, don't change state
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
			console.log('=== Starting conversion ===');
			console.log('Original file path:', file.path);
			console.log('Original file basename:', file.basename);
			console.log('New name:', newName);
			console.log('New path:', newPath);
			console.log('File parent:', file.parent?.path || 'no parent');
			
			// Apply template before renaming if enabled
			if (this.settings.applyTemplateOnConvert) {
				console.log('Applying template before rename...');
				await this.applyTemplateToFile(file, emoji, true);
			}
			
			// Then rename the file
			console.log('Renaming file...');
			await this.app.fileManager.renameFile(file, newPath);
			console.log('File renamed successfully');
			
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

		// Guard menu action as well when marking as completed
		if (newEmoji === TASK_EMOJIS.CHECKED) {
			const allChecked = await this.areAllMarkdownTodosChecked(file);
			if (!allChecked) {
				new Notice('Please complete all checklist items in the note first.');
				return;
			}
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

	/**
	 * Apply template to a file based on task emoji
	 */
	private async applyTemplateToFile(file: TFile, emoji: string, forceApply: boolean = false) {
		let templatePath = '';
		
		// Determine which template to use based on emoji
		switch (emoji) {
			case TASK_EMOJIS.UNCHECKED:
				templatePath = this.settings.uncheckedTaskTemplate;
				break;
			case TASK_EMOJIS.SCHEDULED:
				templatePath = this.settings.scheduledTaskTemplate;
				break;
			case TASK_EMOJIS.CHECKED:
				templatePath = this.settings.completedTaskTemplate;
				break;
		}

		if (!templatePath || !templatePath.trim()) {
			console.log('No template configured for emoji:', emoji);
			return; // No template configured
		}

		// Normalize the template path
		templatePath = normalizePath(templatePath.trim());
		console.log('Applying template from:', templatePath, 'to file:', file.path);

		try {
			// Try multiple methods to find the template file
			let templateFile = this.app.vault.getFileByPath(templatePath);
			
			if (!templateFile) {
				console.log('getFileByPath failed, trying getAbstractFileByPath...');
				const abstractFile = this.app.vault.getAbstractFileByPath(templatePath);
				if (abstractFile instanceof TFile) {
					templateFile = abstractFile;
				}
			}
			
			// Also try with .md extension if not present
			if (!templateFile && !templatePath.endsWith('.md')) {
				console.log('Trying with .md extension...');
				const pathWithExt = templatePath + '.md';
				templateFile = this.app.vault.getFileByPath(pathWithExt);
				if (!templateFile) {
					const abstractFile = this.app.vault.getAbstractFileByPath(pathWithExt);
					if (abstractFile instanceof TFile) {
						templateFile = abstractFile;
					}
				}
			}
			
			if (!templateFile) {
				console.warn(`Template not found at path: ${templatePath}`);
				console.log('Available markdown files:', this.app.vault.getMarkdownFiles().map(f => f.path));
				new Notice(`Template not found: ${templatePath}`);
				return;
			}

			console.log('Found template file:', templateFile.path);

			// Read template content
			const templateContent = await this.app.vault.read(templateFile);
			console.log('Template content:', templateContent.substring(0, 100), '... (length:', templateContent.length, ')');
			
			if (!templateContent) {
				console.warn('Template is empty');
				return;
			}
			
			// Read current file content
			const currentContent = await this.app.vault.read(file);
			console.log('Current file content length:', currentContent.length);
			
			// Apply template if file is empty or if forced (on conversion)
			if (forceApply || currentContent.trim().length === 0) {
				// Process template variables (basic support)
				const processedContent = this.processTemplateVariables(templateContent, file);
				console.log('Processed content:', processedContent.substring(0, 100), '... (length:', processedContent.length, ')');
				
				await this.app.vault.modify(file, processedContent);
				console.log('Template applied successfully to:', file.path);
				new Notice('Template applied');
			} else {
				console.log('File not empty and forceApply=false, skipping template application');
			}
		} catch (error) {
			console.error('Error applying template:', error);
			new Notice(`Error applying template: ${error.message}`);
		}
	}

	/**
	 * Process basic template variables
	 */
	private processTemplateVariables(content: string, file: TFile): string {
		const now = new Date();
		const fileName = file.basename.replace(TASK_EMOJI_REGEX, '$2');
		
		// Basic variable replacements
		return content
			.replace(/{{title}}/g, fileName)
			.replace(/{{date}}/g, now.toISOString().split('T')[0])
			.replace(/{{time}}/g, now.toTimeString().split(' ')[0])
			.replace(/{{datetime}}/g, now.toISOString())
			.replace(/{{timestamp}}/g, now.getTime().toString());
	}

	/**
	 * Get list of all template files in the vault
	 */
	getTemplateFiles(): TFile[] {
		const templates: TFile[] = [];
		const allFiles = this.app.vault.getMarkdownFiles();
		
		// Get templates folder from Obsidian's core Templates plugin settings
		// @ts-ignore - accessing internal API
		const templatesFolder = this.app.internalPlugins?.plugins?.templates?.instance?.options?.folder || '';
		
		if (!templatesFolder) {
			// If no templates folder configured, return all markdown files
			return allFiles;
		}
		
		allFiles.forEach(file => {
			// Match files in the templates folder or subfolders
			if (file.path.startsWith(templatesFolder + '/') || file.path.startsWith(templatesFolder)) {
				templates.push(file);
			}
		});
		
		return templates;
	}

	/**
	 * Get the templates folder path from Obsidian settings
	 */
	getTemplatesFolder(): string {
		// @ts-ignore - accessing internal API
		return this.app.internalPlugins?.plugins?.templates?.instance?.options?.folder || '';
	}
}

/**
 * Settings tab for the plugin
 */
class TaskNotesSettingTab extends PluginSettingTab {
	plugin: TaskNotesPlugin;

	constructor(app: App, plugin: TaskNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Task Notes Settings' });

		// Enable/disable template application
		new Setting(containerEl)
			.setName('Apply templates on conversion')
			.setDesc('Automatically apply templates when converting files to tasks via context menu')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.applyTemplateOnConvert)
				.onChange(async (value) => {
					this.plugin.settings.applyTemplateOnConvert = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to update template list
				}));

		if (!this.plugin.settings.applyTemplateOnConvert) {
			return; // Don't show template settings if disabled
		}

		containerEl.createEl('h3', { text: 'Template Configuration' });
		
		const templatesFolder = this.plugin.getTemplatesFolder();
		const description = containerEl.createEl('p', { cls: 'setting-item-description' });
		if (templatesFolder) {
			description.setText(`Templates from folder: ${templatesFolder}`);
		} else {
			description.setText('No template folder configured. Go to Settings → Core plugins → Templates to set a template folder.');
			description.style.color = 'var(--text-warning)';
		}

		// Get available templates
		const templateFiles = this.plugin.getTemplateFiles();
		
		if (templateFiles.length === 0) {
			containerEl.createEl('p', {
				text: 'No templates found. Create template files in your configured templates folder.',
				cls: 'mod-warning'
			});
		}

		// Unchecked task template
		new Setting(containerEl)
			.setName('Unchecked task template (◻️)')
			.setDesc('Template to apply when converting to an unchecked task')
			.addText(text => {
				new TemplateFileSuggest(this.app, text.inputEl, this.plugin);
				text.setPlaceholder('Example: Templates/task-template.md')
					.setValue(this.plugin.settings.uncheckedTaskTemplate)
					.onChange(async (value) => {
						this.plugin.settings.uncheckedTaskTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.style.width = '100%';
			});

		// Scheduled task template
		new Setting(containerEl)
			.setName('Scheduled task template (📅)')
			.setDesc('Template to apply when converting to a scheduled task')
			.addText(text => {
				new TemplateFileSuggest(this.app, text.inputEl, this.plugin);
				text.setPlaceholder('Example: Templates/scheduled-template.md')
					.setValue(this.plugin.settings.scheduledTaskTemplate)
					.onChange(async (value) => {
						this.plugin.settings.scheduledTaskTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.style.width = '100%';
			});

		// Completed task template
		new Setting(containerEl)
			.setName('Completed task template (✅)')
			.setDesc('Template to apply when converting to a completed task')
			.addText(text => {
				new TemplateFileSuggest(this.app, text.inputEl, this.plugin);
				text.setPlaceholder('Example: Templates/completed-template.md')
					.setValue(this.plugin.settings.completedTaskTemplate)
					.onChange(async (value) => {
						this.plugin.settings.completedTaskTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.style.width = '100%';
			});

		if (templateFiles.length > 0) {
			// Template variables info
			containerEl.createEl('h3', { text: 'Template Variables' });
			containerEl.createEl('p', {
				text: 'You can use these variables in your template files:',
				cls: 'setting-item-description'
			});
			const variablesList = containerEl.createEl('ul', { cls: 'task-notes-variables' });
			const variables = [
				{ var: '{{title}}', desc: 'File name without task emoji' },
				{ var: '{{date}}', desc: 'Current date (YYYY-MM-DD)' },
				{ var: '{{time}}', desc: 'Current time (HH:MM:SS)' },
				{ var: '{{datetime}}', desc: 'Current date and time (ISO 8601)' },
				{ var: '{{timestamp}}', desc: 'Unix timestamp' }
			];
			
			variables.forEach(({ var: varName, desc }) => {
				const li = variablesList.createEl('li');
				li.createEl('code', { text: varName });
				li.appendText(` - ${desc}`);
			});

			containerEl.createEl('p', { 
				text: 'Note: Templates are only applied to empty files to prevent overwriting existing content.',
				cls: 'setting-item-description'
			});
		}
	}
}

/**
 * File suggester for template path autocomplete
 */
class TemplateFileSuggest {
	private app: App;
	private inputEl: HTMLInputElement;
	private plugin: TaskNotesPlugin;
	private suggestEl: HTMLDivElement | null = null;
	private selectedIndex: number = -1;
	private suggestions: TFile[] = [];

	constructor(app: App, inputEl: HTMLInputElement, plugin: TaskNotesPlugin) {
		this.app = app;
		this.inputEl = inputEl;
		this.plugin = plugin;

		this.inputEl.addEventListener('input', this.onInput.bind(this));
		this.inputEl.addEventListener('keydown', this.onKeyDown.bind(this));
		this.inputEl.addEventListener('blur', this.onBlur.bind(this));
	}

	private onInput(): void {
		const value = this.inputEl.value;
		this.updateSuggestions(value);
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (!this.suggestEl) return;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1);
			this.renderSuggestions();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
			this.renderSuggestions();
		} else if (event.key === 'Enter' && this.selectedIndex >= 0) {
			event.preventDefault();
			this.selectSuggestion(this.suggestions[this.selectedIndex]);
		} else if (event.key === 'Escape') {
			this.closeSuggestions();
		}
	}

	private onBlur(): void {
		// Delay to allow click on suggestion
		setTimeout(() => this.closeSuggestions(), 200);
	}

	private updateSuggestions(query: string): void {
		const templateFiles = this.plugin.getTemplateFiles();
		
		if (!query) {
			this.suggestions = templateFiles;
		} else {
			const lowerQuery = query.toLowerCase();
			this.suggestions = templateFiles.filter(file => 
				file.path.toLowerCase().includes(lowerQuery)
			);
		}

		this.selectedIndex = -1;

		if (this.suggestions.length > 0) {
			this.renderSuggestions();
		} else {
			this.closeSuggestions();
		}
	}

	private renderSuggestions(): void {
		if (!this.suggestEl) {
			this.suggestEl = document.createElement('div');
			this.suggestEl.className = 'suggestion-container';
			this.suggestEl.style.cssText = `
				position: absolute;
				background: var(--background-primary);
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				max-height: 200px;
				overflow-y: auto;
				z-index: 1000;
				box-shadow: 0 2px 8px rgba(0,0,0,0.15);
			`;
			
			const rect = this.inputEl.getBoundingClientRect();
			this.suggestEl.style.top = (rect.bottom + window.scrollY) + 'px';
			this.suggestEl.style.left = rect.left + 'px';
			this.suggestEl.style.width = rect.width + 'px';
			
			document.body.appendChild(this.suggestEl);
		}

		this.suggestEl.empty();

		this.suggestions.forEach((file, index) => {
			const item = this.suggestEl!.createDiv('suggestion-item');
			item.textContent = file.path;
			item.style.cssText = `
				padding: 6px 12px;
				cursor: pointer;
				${index === this.selectedIndex ? 'background: var(--background-modifier-hover);' : ''}
			`;

			item.addEventListener('mouseenter', () => {
				this.selectedIndex = index;
				this.renderSuggestions();
			});

			item.addEventListener('click', () => {
				this.selectSuggestion(file);
			});

			this.suggestEl!.appendChild(item);
		});
	}

	private selectSuggestion(file: TFile): void {
		this.inputEl.value = file.path;
		this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
		this.closeSuggestions();
		this.inputEl.focus();
	}

	private closeSuggestions(): void {
		if (this.suggestEl) {
			this.suggestEl.remove();
			this.suggestEl = null;
		}
		this.selectedIndex = -1;
	}
}
