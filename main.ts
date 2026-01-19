import { App, Plugin, TFile, TAbstractFile, Menu, Notice, PluginSettingTab, Setting, normalizePath, Modal } from 'obsidian';

// Task properties interface
interface TaskProperties {
	actionWords: string;
	amount: string;
	amountOutcome: string;
	// Optional date/time fields (only for events)
	startDate?: string; // YYYY-MM-DD
	endDate?: string; // YYYY-MM-DD (for date ranges)
	time?: string; // HH.MMh format
}

// Plugin settings interface
interface TaskNotesSettings {
	uncheckedTaskTemplate: string;
	scheduledTaskTemplate: string;
	completedTaskTemplate: string;
	applyTemplateOnConvert: boolean;
	// Format templates
	uncheckedTaskFormat: string;
	scheduledTaskFormat: string;
	completedTaskFormat: string;
	cancelledTaskFormat: string;
}

// Default settings
const DEFAULT_SETTINGS: TaskNotesSettings = {
	uncheckedTaskTemplate: '',
	scheduledTaskTemplate: '',
	completedTaskTemplate: '',
	applyTemplateOnConvert: true,
	uncheckedTaskFormat: '{action} - {amount} - {outcome}',
	scheduledTaskFormat: 'By {date} (at {time} - {range}), {action} - {amount} - {outcome}',
	completedTaskFormat: '{action} - {amount} - {outcome}',
	cancelledTaskFormat: '{action} - {amount} - {outcome}'
};

/**
 * Helper function to set CSS properties on an element
 */
function setCssProps(element: HTMLElement, styles: Record<string, string>): void {
	Object.assign(element.style, styles);
}

/**
 * Normalize emoji by removing invisible characters (variation selectors, zero-width chars, etc.)
 */
function normalizeEmoji(emoji: string): string {
	// Remove variation selectors and other invisible Unicode characters, but NOT regular spaces
	// Variation selector-16 (U+FE0F) and zero-width characters
	return emoji.replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF\u061C]/gu, '').replace(/\uFE0F/gu, '');
}

// Task emoji constants
const TASK_EMOJIS = {
	UNCHECKED: '◻️',
	SCHEDULED: '📅',
	CHECKED: '✅',
	UNIMPORTANT: '❌'
} as const;

const TASK_EMOJI_REGEX = /^([\u25FB\uFE0F]|[\u25FB]|[\ud83d\udcc5]|[\u2705]|[\u274c])\s+(.+)$/;

/**
 * Clean up task name by removing any embedded invisible characters (but not regular spaces)
 */
function cleanupTaskName(taskName: string): string {
	// Remove invisible characters only, preserve the actual spacing
	return taskName.replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF\u061C]/gu, '').replace(/\uFE0F/gu, '').trim();
}

/**
 * Parse task name into properties
 * Format: "Action words - Amount - Amount outcome" (for non-events)
 * Format: "By YYYY-MM-DD, (at HH.MMh - YYYY-MM-DD) Action words - Amount - Amount outcome" (for events with time and date range)
 */
function parseTaskProperties(taskName: string, isEvent: boolean): TaskProperties {
	// Clean up any invisible characters that might be embedded in the task name
	taskName = cleanupTaskName(taskName);
	
	const cleanPlaceholder = (value: string): string => {
		// If the value looks like a placeholder (e.g., {amount}), treat it as empty
		if (value && /\{[^}]+\}/.test(value)) return '';
		return value;
	};

	const props: TaskProperties = {
		actionWords: '',
		amount: '',
		amountOutcome: ''
	};

	if (isEvent) {
		// Try to parse "By" format: By YYYY-MM-DD (optional time/range), action - amount - outcome
		const byRegex = /^By\s+(\d{4}-\d{2}-\d{2})(?:\s+\((?:at\s+)?(\d{2}\.\d{2}h)?(?:\s*-\s*)?(\d{4}-\d{2}-\d{2})?\))?(?:,\s+)?(.+)$/;
		const match = taskName.match(byRegex);

		if (match) {
			props.startDate = cleanPlaceholder(match[1]);
			props.time = match[2] ? cleanPlaceholder(match[2]) : undefined;
			props.endDate = match[3] ? cleanPlaceholder(match[3]) : undefined;
			const remainder = match[4];

			// Now parse the remainder as: "Action words - Amount - Amount outcome"
			const partRegex = /^(.+?)\s*-\s*(.+?)\s*-\s*(.+)$/;
			const partMatch = remainder.match(partRegex);

			if (partMatch) {
				props.actionWords = cleanPlaceholder(partMatch[1].trim());
				props.amount = cleanPlaceholder(partMatch[2].trim());
				props.amountOutcome = cleanPlaceholder(partMatch[3].trim());
			} else {
				// If parsing fails, treat entire remainder as action words
				props.actionWords = cleanPlaceholder(remainder.trim());
			}
		} else {
			// Fallback: try old format or treat as regular task format
			const partRegex = /^(.+?)\s*-\s*(.+?)\s*-\s*(.+)$/;
			const partMatch = taskName.match(partRegex);

			if (partMatch) {
				props.actionWords = cleanPlaceholder(partMatch[1].trim());
				props.amount = cleanPlaceholder(partMatch[2].trim());
				props.amountOutcome = cleanPlaceholder(partMatch[3].trim());
			} else {
				props.actionWords = cleanPlaceholder(taskName.trim());
			}
		}
	} else {
		// Non-event format: "Action words - Amount - Amount outcome"
		const partRegex = /^(.+?)\s*-\s*(.+?)\s*-\s*(.+)$/;
		const match = taskName.match(partRegex);

		if (match) {
			props.actionWords = cleanPlaceholder(match[1].trim());
			props.amount = cleanPlaceholder(match[2].trim());
			props.amountOutcome = cleanPlaceholder(match[3].trim());
		} else {
			props.actionWords = cleanPlaceholder(taskName.trim());
		}
	}

	return props;
}

/**
 * Generate task name from properties using format template
 */
function generateTaskName(props: TaskProperties, format: string): string {
	// Strip any emoji prefix from the format (emojis are added by task type)
	let result = format.replace(/^(?:◻️|✅|📅|❌)\s*/, '');
	
	
	// Replace date/time placeholders (for scheduled tasks)
	if (props.startDate) {
		result = result.replace('{date}', props.startDate);
		
		// Build time portion
		let timePart = '';
		if (props.time) {
			timePart = `at ${props.time}`;
		}
		result = result.replace('{time}', timePart);
		
		// Build range portion
		let rangePart = '';
		if (props.endDate) {
			if (props.time) rangePart = ' - ';
			rangePart += props.endDate;
		}
		result = result.replace('{range}', rangePart);
	} else {
		// Remove date/time/range placeholders if not present
		result = result.replace('{date}', '');
		result = result.replace('{time}', '');
		result = result.replace('{range}', '');
	}
	
	// Replace action/amount/outcome placeholders
	result = result.replace('{action}', props.actionWords);
	result = result.replace('{amount}', props.amount);
	result = result.replace('{outcome}', props.amountOutcome);

	// Remove any remaining placeholders (e.g., if a value was left empty)
	result = result.replace(/\{[^}]+\}/g, '');

	// Remove empty parentheses (when time/range are not present)
	result = result.replace(/\(\s*\)/g, '');
	
	// Remove spaces before closing paren or comma
	result = result.replace(/\s+([,)])/g, '$1');
	
	// Clean up repeated dashes and spaces after placeholder removal
	result = result.replace(/-\s*-\s*/g, '-');
	result = result.replace(/\s+/g, ' ').trim();
	
	return result;
}

/**
 * Validate format template for duplicate placeholders
 * Returns error message if invalid, empty string if valid
 */
function validateFormatTemplate(format: string): string {
	const regex = /\{(\w+)\}/g;
	const placeholders: string[] = [];
	const duplicates: string[] = [];
	
	let match;
	while ((match = regex.exec(format)) !== null) {
		const placeholder = match[1];
		if (placeholders.includes(placeholder)) {
			if (!duplicates.includes(placeholder)) {
				duplicates.push(placeholder);
			}
		} else {
			placeholders.push(placeholder);
		}
	}
	
	if (duplicates.length > 0) {
		return `Duplicate placeholders found: {${duplicates.join('}, {')}}`;
	}
	
	return '';
}

/**
 * Extract field labels from a format template
 * Returns object with field names (action, amount, outcome)
 */
function extractFieldLabels(format: string): { action: string, amount: string, outcome: string } {
	const labels = { action: 'Action', amount: 'Amount', outcome: 'Outcome' };
	
	// Match patterns like {fieldname} and extract the field names
	const regex = /\{(\w+)\}/g;
	const matches = [...format.matchAll(regex)];
	
	// Filter to only action/amount/outcome placeholders and get first occurrence of each
	const foundLabels = { action: '', amount: '', outcome: '' };
	const usedPlaceholders: string[] = [];
	
	for (const match of matches) {
		const placeholder = match[1];
		// Skip if already used or if it's a date/time/range placeholder
		if (usedPlaceholders.includes(placeholder) || ['date', 'time', 'range'].includes(placeholder)) {
			continue;
		}
		
		// Map to one of our three slots in order
		if (!foundLabels.action) {
			foundLabels.action = placeholder;
			usedPlaceholders.push(placeholder);
		} else if (!foundLabels.amount) {
			foundLabels.amount = placeholder;
			usedPlaceholders.push(placeholder);
		} else if (!foundLabels.outcome) {
			foundLabels.outcome = placeholder;
			usedPlaceholders.push(placeholder);
			break; // We have all three
		}
	}
	
	// Capitalize and assign
	if (foundLabels.action) {
		labels.action = foundLabels.action.charAt(0).toUpperCase() + foundLabels.action.slice(1);
	}
	if (foundLabels.amount) {
		labels.amount = foundLabels.amount.charAt(0).toUpperCase() + foundLabels.amount.slice(1);
	}
	if (foundLabels.outcome) {
		labels.outcome = foundLabels.outcome.charAt(0).toUpperCase() + foundLabels.outcome.slice(1);
	}
	
	return labels;
}

/**
 * Modal for creating/converting tasks with property inputs
 */
class TaskPropertiesModal extends Modal {
	private emoji: string;
	private isEvent: boolean;
	private originalName: string;
	private onSubmit: (props: TaskProperties) => void;
	private settings: TaskNotesSettings;

	constructor(app: App, emoji: string, originalName: string, settings: TaskNotesSettings, onSubmit: (props: TaskProperties) => void) {
		super(app);
		this.emoji = emoji;
		this.isEvent = emoji === TASK_EMOJIS.SCHEDULED;
		this.originalName = originalName;
		this.settings = settings;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Create task' });
		
		// Show original name
		if (this.originalName) {
			const originalNameEl = contentEl.createDiv({ cls: 'task-modal-original-name' });
			originalNameEl.createEl('strong', { text: 'Original: ' });
			originalNameEl.createSpan({ text: this.originalName });
		}

		const form = contentEl.createEl('form');
		form.addClass('task-modal-form');

		// Date inputs (only for events)
		let startDateInput: HTMLInputElement | null = null;
		let timeInput: HTMLInputElement | null = null;
		let endDateInput: HTMLInputElement | null = null;

		if (this.isEvent) {
			const dateGroup = form.createDiv({ cls: 'task-modal-input-group' });
			dateGroup.createEl('label', { text: 'Start date' });
			const dateWrapper = dateGroup.createDiv({ cls: 'task-modal-date-wrapper' });
			startDateInput = dateWrapper.createEl('input', { type: 'date', cls: 'task-modal-date-input' });
			startDateInput.required = true;
			startDateInput.placeholder = '';

			const timeGroup = form.createDiv({ cls: 'task-modal-input-group' });
			timeGroup.createEl('label', { text: 'Time (optional)' });
			const timeWrapper = timeGroup.createDiv({ cls: 'task-modal-time-wrapper' });
			timeInput = timeWrapper.createEl('input', { type: 'time', cls: 'task-modal-time-input' });
			timeInput.placeholder = '';

			const endDateGroup = form.createDiv({ cls: 'task-modal-input-group' });
			endDateGroup.createEl('label', { text: 'End date (optional)' });
			const endDateWrapper = endDateGroup.createDiv({ cls: 'task-modal-date-wrapper' });
			endDateInput = endDateWrapper.createEl('input', { type: 'date', cls: 'task-modal-date-input' });
			endDateInput.placeholder = '';
		}

		// Get dynamic labels based on format
		let format = this.settings.uncheckedTaskFormat;
		if (this.emoji === TASK_EMOJIS.SCHEDULED) {
			format = this.settings.scheduledTaskFormat;
		} else if (this.emoji === TASK_EMOJIS.CHECKED) {
			format = this.settings.completedTaskFormat;
		} else if (this.emoji === TASK_EMOJIS.UNIMPORTANT) {
			format = this.settings.cancelledTaskFormat;
		}
		const labels = extractFieldLabels(format);

		// Action words input
		const actionGroup = form.createDiv({ cls: 'task-modal-input-group' });
		actionGroup.createEl('label', { text: labels.action });
		const actionInput = actionGroup.createEl('input', { type: 'text', cls: 'task-modal-text-input' });
		actionInput.placeholder = 'E.g., Buy, Finish, Complete';
		actionInput.required = true;

		// Amount input
		const amountGroup = form.createDiv({ cls: 'task-modal-input-group' });
		amountGroup.createEl('label', { text: labels.amount });
		const amountInput = amountGroup.createEl('input', { type: 'text', cls: 'task-modal-text-input' });
		amountInput.placeholder = 'E.g., 3, 5 items, 2 hours';
		amountInput.required = true;

		// Outcome input
		const outcomeGroup = form.createDiv({ cls: 'task-modal-input-group' });
		outcomeGroup.createEl('label', { text: labels.outcome });
		const outcomeInput = outcomeGroup.createEl('input', { type: 'text', cls: 'task-modal-text-input' });
		outcomeInput.placeholder = 'E.g., groceries, report, project';
		outcomeInput.required = true;

		// Buttons
		const buttonGroup = form.createDiv({ cls: 'task-modal-button-group' });

		const cancelBtn = buttonGroup.createEl('button', { text: 'Cancel', type: 'button', cls: 'task-modal-cancel-btn' });
		cancelBtn.addEventListener('click', () => this.close());

		buttonGroup.createEl('button', { text: 'Create', type: 'submit', cls: 'task-modal-submit-btn' });

		form.addEventListener('submit', (e) => {
			e.preventDefault();

			const props: TaskProperties = {
				actionWords: actionInput.value.trim(),
				amount: amountInput.value.trim(),
				amountOutcome: outcomeInput.value.trim()
			};

			if (this.isEvent && startDateInput) {
				props.startDate = startDateInput.value;
				if (timeInput && timeInput.value) {
					const [hours, minutes] = timeInput.value.split(':');
					props.time = `${hours}.${minutes}h`;
				}
				if (endDateInput && endDateInput.value) {
					props.endDate = endDateInput.value;
				}
			}

			this.onSubmit(props);
			this.close();
		});

		// Focus first input
		if (this.isEvent && startDateInput) {
			startDateInput.focus();
		} else {
			actionInput.focus();
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export default class TaskNotesPlugin extends Plugin {
	private titleCheckboxObserver: MutationObserver | null = null;
	private fileExplorerObserver: MutationObserver | null = null;
	private fileUncheckedState: Map<string, boolean> = new Map();
	settings: TaskNotesSettings;

	async onload() {
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
			subtree: true,
			attributes: true,
			characterData: true
		});
	}

	/**
	 * Process a file explorer node and add checkboxes if needed
	 */
	private processFileExplorerNode(_node: HTMLElement) {
		// Re-scan visible file items and ensure checkboxes exist. We avoid relying
		// solely on addedNodes because Obsidian may update existing items instead.
		const fileItems = document.querySelectorAll('.nav-file-title');
		fileItems.forEach((fileItem) => {
			const filePath = fileItem.getAttribute('data-path');
			if (filePath) {
				const file = this.app.vault.getAbstractFileByPath(filePath);
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

		// Best-effort: avoid repeatedly removing/re-adding the same checkbox
		// (which can cause an observer-triggered mutation loop and freeze the UI).
		const existingCheckbox = fileItem.querySelector('.task-notes-checkbox');

		const match = file.basename.match(TASK_EMOJI_REGEX);
		if (!match) {
			// If no task emoji but a checkbox exists, remove it once.
			if (existingCheckbox) existingCheckbox.remove();
			return;
		}

		let [, emoji] = match;
		emoji = normalizeEmoji(emoji);

		// If an identical checkbox is already present, do nothing.
		if (existingCheckbox) {
			const existingEmoji = existingCheckbox.getAttribute('data-emoji');
			if (existingEmoji === emoji) {
				return;
			}
			// Otherwise remove it and recreate with the correct emoji
			existingCheckbox.remove();
		}

		const checkbox = this.createCheckbox(emoji, false, file); // read-only in file explorer

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
	 * Create property input fields for task properties
	 */
	private createPropertyInputs(file: TFile, emoji: string): HTMLElement {
		const container = document.createElement('div');
		container.className = 'task-notes-property-inputs';
		container.setAttribute('data-task-path', file.path);

		const match = file.basename.match(TASK_EMOJI_REGEX);
		if (!match) {
			return container;
		}

		// Clean up any variation selectors or invisible chars that might have crept into the task name
		let taskName = match[2].replace(/^[\u200B\u200C\u200D\u200E\u200F\uFEFF\u061C\uFE0F\s]+/u, '').trim();
		// Also strip any additional emojis that might have been accidentally added
		taskName = taskName.replace(/^(?:[\u25FB][\uFE0F]?|[\u25FB]|[\ud83d][\udcc5]|[\u2705]|[\u274c])\s*/, '');
		const isEvent = normalizeEmoji(emoji) === normalizeEmoji(TASK_EMOJIS.SCHEDULED);
		const props = parseTaskProperties(taskName, isEvent);

		// Create input fields
		const inputsContainer = document.createElement('div');
		inputsContainer.className = 'task-notes-inputs-container';

		// Date inputs (only for events)
		if (isEvent) {
			const dateContainer = document.createElement('div');
			dateContainer.className = 'task-notes-input-group';

			const startDateLabel = document.createElement('label');
			startDateLabel.textContent = 'Date: ';
			startDateLabel.className = 'task-notes-label';

			const startDateInput = document.createElement('input');
			startDateInput.type = 'date';
			startDateInput.className = 'task-notes-date-input';
			startDateInput.value = props.startDate || '';
			startDateInput.required = true;

			dateContainer.appendChild(startDateLabel);
			dateContainer.appendChild(startDateInput);

			// Time input - place right after start date
			const timeLabel = document.createElement('label');
			timeLabel.textContent = ' At ';
			timeLabel.className = 'task-notes-label';

			const timeInput = document.createElement('input');
			timeInput.type = 'time';
			timeInput.className = 'task-notes-time-input';
			
			// Convert HH.MMh format to HH:MM for time input
			if (props.time) {
				const timeMatch = props.time.match(/(\d{2})\.(\d{2})h/);
				if (timeMatch) {
					timeInput.value = `${timeMatch[1]}:${timeMatch[2]}`;
				}
			}

			dateContainer.appendChild(timeLabel);
			dateContainer.appendChild(timeInput);

			// End date input for range - place after time
			const endDateLabel = document.createElement('label');
			endDateLabel.textContent = ' To ';
			endDateLabel.className = 'task-notes-label';

			const endDateInput = document.createElement('input');
			endDateInput.type = 'date';
			endDateInput.className = 'task-notes-date-input';
			endDateInput.value = props.endDate || '';

			dateContainer.appendChild(endDateLabel);
			dateContainer.appendChild(endDateInput);

			inputsContainer.appendChild(dateContainer);
		}

		// Get dynamic labels based on format
		let format = this.settings.uncheckedTaskFormat;
		if (emoji === TASK_EMOJIS.SCHEDULED) {
			format = this.settings.scheduledTaskFormat;
		} else if (emoji === TASK_EMOJIS.CHECKED) {
			format = this.settings.completedTaskFormat;
		} else if (emoji === TASK_EMOJIS.UNIMPORTANT) {
			format = this.settings.cancelledTaskFormat;
		}
		const labels = extractFieldLabels(format);

		// Action words input
		const actionContainer = document.createElement('div');
		actionContainer.className = 'task-notes-input-group';

		const actionLabel = document.createElement('label');
		actionLabel.textContent = labels.action + ': ';
		actionLabel.className = 'task-notes-label';

		const actionInput = document.createElement('input');
		actionInput.type = 'text';
		actionInput.className = 'task-notes-text-input';
		actionInput.placeholder = labels.action;
		actionInput.value = props.actionWords;

		actionContainer.appendChild(actionLabel);
		actionContainer.appendChild(actionInput);
		inputsContainer.appendChild(actionContainer);

		// Amount input
		const amountContainer = document.createElement('div');
		amountContainer.className = 'task-notes-input-group';

		const amountLabel = document.createElement('label');
		amountLabel.textContent = labels.amount + ': ';
		amountLabel.className = 'task-notes-label';

		const amountInput = document.createElement('input');
		amountInput.type = 'text';
		amountInput.className = 'task-notes-text-input';
		amountInput.placeholder = labels.amount;
		amountInput.value = props.amount;

		amountContainer.appendChild(amountLabel);
		amountContainer.appendChild(amountInput);
		inputsContainer.appendChild(amountContainer);

		// Amount outcome input
		const outcomeContainer = document.createElement('div');
		outcomeContainer.className = 'task-notes-input-group';

		const outcomeLabel = document.createElement('label');
		outcomeLabel.textContent = labels.outcome + ': ';
		outcomeLabel.className = 'task-notes-label';

		const outcomeInput = document.createElement('input');
		outcomeInput.type = 'text';
		outcomeInput.className = 'task-notes-text-input';
		outcomeInput.placeholder = labels.outcome;
		outcomeInput.value = props.amountOutcome;

		outcomeContainer.appendChild(outcomeLabel);
		outcomeContainer.appendChild(outcomeInput);
		inputsContainer.appendChild(outcomeContainer);

		container.appendChild(inputsContainer);

		// Add apply button for text/date inputs; checkbox updates immediately elsewhere
		const applyBtn = document.createElement('button');
		applyBtn.type = 'button';
		applyBtn.textContent = 'Apply';
		applyBtn.className = 'task-notes-apply-btn';
		applyBtn.addEventListener('click', () => {
			void this.handlePropertyInputChange(file, emoji, container);
		});
		container.appendChild(applyBtn);

		return container;
	}

	/**
	 * Handle property input changes and update file
	 */
	private async handlePropertyInputChange(file: TFile, emoji: string, container: HTMLElement) {
		// Normalize the emoji right at the start
		const normalizedEmoji = normalizeEmoji(emoji);
		
		const match = file.basename.match(TASK_EMOJI_REGEX);
		if (!match) {
			return;
		}

		const isEvent = normalizedEmoji === normalizeEmoji(TASK_EMOJIS.SCHEDULED);

		// Collect values from inputs
		const inputs = container.querySelectorAll('input');
		let startDate = '';
		let endDate = '';
		let time = '';
		let actionWords = '';
		let amount = '';
		let amountOutcome = '';

		let inputIndex = 0;

		if (isEvent) {
			// Date inputs (0: startDate, 1: time, 2: endDate)
			const startDateInput = inputs[inputIndex++];
			const timeInput = inputs[inputIndex++];
			const endDateInput = inputs[inputIndex++];

			startDate = startDateInput.value.trim();
			endDate = endDateInput.value.trim();

			// Convert HH:MM to HH.MMh format
			if (timeInput.value) {
				const [hours, minutes] = timeInput.value.split(':');
				time = `${hours}.${minutes}h`;
			}
		}

		// Action, amount, outcome inputs
		const actionInput = inputs[inputIndex++];
		const amountInput = inputs[inputIndex++];
		const outcomeInput = inputs[inputIndex++];

		actionWords = actionInput.value.trim();
		amount = amountInput.value.trim();
		amountOutcome = outcomeInput.value.trim();

		// Validate required fields
		if (!actionWords || !amount || !amountOutcome) {
			new Notice('Please fill in all required fields');
			return;
		}

		if (isEvent && !startDate) {
			new Notice('Event date is required');
			return;
		}

		// Generate new task name
		const props: TaskProperties = {
			actionWords,
			amount,
			amountOutcome,
			startDate: isEvent ? startDate : undefined,
			endDate: isEvent && endDate ? endDate : undefined,
			time: isEvent && time ? time : undefined
		};

		// Get the appropriate format template
		let format = this.settings.uncheckedTaskFormat;
		if (normalizedEmoji === normalizeEmoji(TASK_EMOJIS.SCHEDULED)) {
			format = this.settings.scheduledTaskFormat;
		} else if (normalizedEmoji === normalizeEmoji(TASK_EMOJIS.CHECKED)) {
			format = this.settings.completedTaskFormat;
		} else if (normalizedEmoji === normalizeEmoji(TASK_EMOJIS.UNIMPORTANT)) {
			format = this.settings.cancelledTaskFormat;
		}

		const newTaskName = generateTaskName(props, format);
		// Remove any embedded variation selectors from the generated task name
		const cleanedTaskName = cleanupTaskName(newTaskName);
		// Ensure exactly one space between emoji and task name
		const newName = `${normalizedEmoji} ${cleanedTaskName}`.replace(/\s+/g, ' ').trim();
		const newPath = file.parent ? `${file.parent.path}/${newName}.${file.extension}` : `${newName}.${file.extension}`;

		try {
			await this.app.fileManager.renameFile(file, newPath);
			new Notice('Task updated successfully');
		} catch (error) {
			new Notice(`Failed to update task: ${error.message}`);
			console.error('Error updating task properties:', error);
		}
	}

	/**
	 * Create a checkbox element
	 */
	private createCheckbox(emoji: string, interactive: boolean = true, fileForMenu?: TFile): HTMLElement {
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'task-notes-checkbox';
		// Show as checked for completed tasks and for 'unimportant' tasks per user request
		checkbox.checked = (emoji === TASK_EMOJIS.CHECKED) || (emoji === TASK_EMOJIS.UNIMPORTANT);
		checkbox.disabled = !interactive;
		// store emoji for quick lookup — use data attribute rather than reassigning
		// the read-only `dataset` property in some environments.
		checkbox.setAttribute('data-emoji', emoji);

		// If associated with a file (file explorer checkbox), add a contextmenu
		// handler so users can right-click the checkbox to change task type.
		if (fileForMenu) {
			const fileForMenuRef = fileForMenu;
			checkbox.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
				try {
					this.showContextMenuForFile(fileForMenuRef, e, emoji, false);
				} catch (err) {
					console.error('Error showing context menu for file checkbox:', err);
					new Notice('Failed to open context menu');
				}
			});
		}

		return checkbox;
	}

	/**
	 * Update the title checkbox for the currently active file
	 */
	private updateTitleCheckbox(file: TFile | null) {
		// Find the footer in the current active leaf
		const activeLeaf = this.app.workspace.getLeaf(false);
		if (!activeLeaf) {
			return;
		}

		const viewContent = activeLeaf.view.containerEl.querySelector('.view-content');
		if (!viewContent) {
			return;
		}

		// Clear existing wrappers in footer
		const footer = viewContent.querySelector('.task-notes-footer');
		if (footer) {
			const wrappers = footer.querySelectorAll('.task-notes-title-wrapper');
			wrappers.forEach(w => w.remove());
		}

		if (!file) {
			return;
		}

		const match = file.basename.match(TASK_EMOJI_REGEX);
		if (!match) {
			return;
		}

		let [, emoji] = match;
		emoji = normalizeEmoji(emoji);

		// Create wrapper for checkbox and inputs in footer
		const wrapper = document.createElement('div');
		wrapper.className = 'task-notes-title-wrapper';

		// Create and insert checkbox
		const checkbox = this.createCheckbox(emoji, true, file);
		checkbox.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			void (async () => {
				try {
					await this.handleTitleCheckboxClick(file, emoji);
				} catch (err) {
					console.error(err);
				}
			})();
		});

		// Context menu on title checkbox
		checkbox.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.showContextMenuForFile(file, e, emoji, true);
		});

		wrapper.appendChild(checkbox);

		// Create property inputs for task-type items
		const propertyInputs = this.createPropertyInputs(file, emoji);
		wrapper.appendChild(propertyInputs);

		// Place entire wrapper in the footer (fixed under note body)
		const footerContainer = this.getFooterContainer();
		if (footerContainer) {
			footerContainer.appendChild(wrapper);
		}
	}

	/**
	 * Get a fixed footer container at the bottom of the note view
	 */
	private getFooterContainer(): HTMLElement | null {
		// Target the active markdown view's container
		const activeLeaf = this.app.workspace.getLeaf(false);
		if (!activeLeaf) {
			return null;
		}

		const viewContent = activeLeaf.view.containerEl.querySelector('.view-content');
		if (!viewContent) {
			return null;
		}

		let container = viewContent.querySelector('.task-notes-footer') as HTMLElement;
		if (!container) {
			container = document.createElement('div');
			container.className = 'task-notes-footer';
			viewContent.appendChild(container);
		}

		return container;
	}

	/**
	 * Remove the footer checkbox and inputs
	 */
	private removeTitleCheckbox() {
	const footer = document.querySelector('.task-notes-footer');
	if (footer) {
		const wrapper = footer.querySelector('.task-notes-title-wrapper');
		if (wrapper) {
			wrapper.remove();
		}
		// If footer is empty, remove it to avoid leftover space
		if (!footer.hasChildNodes()) {
			footer.remove();
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

		const newName = file.basename.replace(TASK_EMOJI_REGEX, `${newEmoji} $2`).trim();
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
	 * Show context menu for a given file when user right-clicks on checkbox/title icon.
	 */
	private showContextMenuForFile(file: TFile, e: MouseEvent, currentEmoji: string, _isTitle: boolean) {
		const menu = new Menu();

		const match = file.basename.match(TASK_EMOJI_REGEX);
		const hasTaskEmoji = !!match;

		if (!hasTaskEmoji) {
			menu.addItem(item => item.setTitle('Convert to unchecked task ◻️').setIcon('checkbox-glyph').onClick(() => { this.convertToTask(file, TASK_EMOJIS.UNCHECKED); }));
			menu.addItem(item => item.setTitle('Convert to scheduled task 📅').setIcon('calendar-glyph').onClick(() => { this.convertToTask(file, TASK_EMOJIS.SCHEDULED); }));
			menu.addItem(item => item.setTitle('Convert to completed task ✅').setIcon('checkmark').onClick(() => { this.convertToTask(file, TASK_EMOJIS.CHECKED); }));
			menu.addItem(item => item.setTitle('Convert to cancelled ❌').setIcon('cross').onClick(() => { this.convertToTask(file, TASK_EMOJIS.UNIMPORTANT); }));
		} else {
			let current = match[1];
			current = normalizeEmoji(current);

			menu.addItem(item => item.setTitle('Remove task status').setIcon('cross').onClick(async () => { await this.removeTaskEmoji(file); }));

			if (current !== TASK_EMOJIS.UNCHECKED) menu.addItem(item => item.setTitle('Mark as unchecked ◻️').setIcon('checkbox-glyph').onClick(async () => { await this.changeTaskStatus(file, TASK_EMOJIS.UNCHECKED); }));
			if (current !== TASK_EMOJIS.SCHEDULED) menu.addItem(item => item.setTitle('Mark as scheduled 📅').setIcon('calendar-glyph').onClick(async () => { await this.changeTaskStatus(file, TASK_EMOJIS.SCHEDULED); }));
			if (current !== TASK_EMOJIS.CHECKED) menu.addItem(item => item.setTitle('Mark as completed ✅').setIcon('checkmark').onClick(async () => { await this.changeTaskStatus(file, TASK_EMOJIS.CHECKED); }));
			if (current !== TASK_EMOJIS.UNIMPORTANT) menu.addItem(item => item.setTitle('Mark as cancelled ❌').setIcon('cross').onClick(async () => { await this.changeTaskStatus(file, TASK_EMOJIS.UNIMPORTANT); }));
		}

		// Add option to use custom emoji
		menu.addSeparator();
		menu.addItem(item => item.setTitle('Use custom emoji').setIcon('pencil').onClick(() => { this.showCustomEmojiDialog(file); }));

		// Show the menu at mouse position (guarded)
		try {
			menu.showAtMouseEvent(e);
		} catch (err) {
			console.error('Error showing menu at mouse event:', err);
			new Notice('Failed to open menu');
		}
	}

	/**
	 * Show dialog for custom emoji input
	 */
	private showCustomEmojiDialog(file: TFile) {
		// Create a simple prompt for emoji
		// Since Obsidian doesn't have built-in emoji picker, we'll just accept any text input
		const match = file.basename.match(TASK_EMOJI_REGEX);
		let currentEmoji = match ? match[1] : '';
		currentEmoji = normalizeEmoji(currentEmoji);

		const dialog = document.createElement('div');
		dialog.className = 'task-notes-custom-emoji-dialog';
		setCssProps(dialog, {
			position: 'fixed',
			top: '50%',
			left: '50%',
			transform: 'translate(-50%, -50%)',
			background: 'var(--background-secondary)',
			border: '1px solid var(--border-color)',
			borderRadius: '4px',
			padding: '16px',
			zIndex: '10000',
			boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
		});

		const label = document.createElement('label');
		label.textContent = 'Enter emoji or custom text (e.g., 🎯, ⚡, or any text):';
		setCssProps(label, {
			display: 'block',
			marginBottom: '8px',
			fontWeight: '500'
		});

		const input = document.createElement('input');
		input.type = 'text';
		input.value = currentEmoji;
		input.placeholder = 'Emoji or text';
		setCssProps(input, {
			width: '100%',
			padding: '8px',
			marginBottom: '12px',
			border: '1px solid var(--border-color)',
			borderRadius: '4px',
			background: 'var(--background-primary)',
			color: 'var(--text-normal)',
			boxSizing: 'border-box'
		});

		const buttonsContainer = document.createElement('div');
		setCssProps(buttonsContainer, {
			display: 'flex',
			gap: '8px',
			justifyContent: 'flex-end'
		});

		const cancelBtn = document.createElement('button');
		cancelBtn.textContent = 'Cancel';
		cancelBtn.className = 'mod-cta';
		setCssProps(cancelBtn, {
			padding: '6px 12px',
			cursor: 'pointer'
		});
		cancelBtn.addEventListener('click', () => dialog.remove());

		const okBtn = document.createElement('button');
		okBtn.textContent = 'OK';
		okBtn.className = 'mod-cta';
		setCssProps(okBtn, {
			padding: '6px 12px',
			cursor: 'pointer'
		});
		okBtn.addEventListener('click', () => {
			const newEmoji = input.value.trim();
			if (!newEmoji) {
				new Notice('Please enter an emoji or text');
				return;
			}

			dialog.remove();

			// Update task with new emoji
			if (match) {
				void this.changeTaskStatus(file, newEmoji);
			} else {
				void this.convertToTask(file, newEmoji);
			}
		});

		buttonsContainer.appendChild(cancelBtn);
		buttonsContainer.appendChild(okBtn);

		dialog.appendChild(label);
		dialog.appendChild(input);
		dialog.appendChild(buttonsContainer);

		document.body.appendChild(dialog);
		input.focus();

		// Allow Enter key to submit
		input.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				const newEmoji = input.value.trim();
				if (!newEmoji) {
					new Notice('Please enter an emoji or text');
					return;
				}

				dialog.remove();

				if (match) {
					void this.changeTaskStatus(file, newEmoji);
				} else {
					void this.convertToTask(file, newEmoji);
				}
			}
		});
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
			console.error('Error refresh file unchecked state:', e);
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
				if (match) {
					let matchedEmoji = match[1];
					matchedEmoji = normalizeEmoji(matchedEmoji);

					if (matchedEmoji === TASK_EMOJIS.CHECKED) {
						// Reopen the task by switching to unchecked
						await this.changeTaskStatus(file, TASK_EMOJIS.UNCHECKED);
						new Notice('Note contains unchecked checklist items. Reopening task to ◻️.');
					}
				}
			}
			// Update tracked state
			this.fileUncheckedState.set(file.path, hasUnchecked);
		} catch (e) {
			console.error('Error handling file modify for todo state:', e);
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
					.setTitle('Convert to unchecked task ◻️')
					.setIcon('checkbox-glyph')
					.onClick(() => {
						this.convertToTask(file, TASK_EMOJIS.UNCHECKED);
					});
			});

			menu.addItem((item) => {
				item
					.setTitle('Convert to scheduled task 📅')
					.setIcon('calendar-glyph')
					.onClick(() => {
						this.convertToTask(file, TASK_EMOJIS.SCHEDULED);
					});
			});

			menu.addItem((item) => {
				item
					.setTitle('Convert to completed task ✅')
					.setIcon('checkmark')
					.onClick(() => {
						this.convertToTask(file, TASK_EMOJIS.CHECKED);
					});
			});

			menu.addItem((item) => {
				item
					.setTitle('Convert to unimportant ❌')
					.setIcon('cross')
					.onClick(() => {
						this.convertToTask(file, TASK_EMOJIS.UNIMPORTANT);
					});
			});
		} else {
			// Add option to remove task emoji
			menu.addItem((item) => {
				item
					.setTitle('Remove task status')
					.setIcon('cross')
					.onClick(async () => {
						await this.removeTaskEmoji(file);
					});
			});

			// Add options to change task status
			let currentEmoji = match[1];
			currentEmoji = normalizeEmoji(currentEmoji);
			
			if (currentEmoji !== TASK_EMOJIS.UNCHECKED) {
				menu.addItem((item) => {
					item
						.setTitle('Mark as unchecked ◻️')
						.setIcon('checkbox-glyph')
						.onClick(async () => {
							await this.changeTaskStatus(file, TASK_EMOJIS.UNCHECKED);
						});
				});
			}

			if (currentEmoji !== TASK_EMOJIS.SCHEDULED) {
				menu.addItem((item) => {
					item
						.setTitle('Mark as scheduled 📅')
						.setIcon('calendar-glyph')
						.onClick(async () => {
							await this.changeTaskStatus(file, TASK_EMOJIS.SCHEDULED);
						});
				});
			}

			if (currentEmoji !== TASK_EMOJIS.CHECKED) {
				menu.addItem((item) => {
					item
						.setTitle('Mark as completed ✅')
						.setIcon('checkmark')
						.onClick(async () => {
							await this.changeTaskStatus(file, TASK_EMOJIS.CHECKED);
						});
				});
			}

			if (currentEmoji !== TASK_EMOJIS.UNIMPORTANT) {
				menu.addItem((item) => {
					item
						.setTitle('Mark as unimportant ❌')
						.setIcon('cross')
						.onClick(async () => {
							await this.changeTaskStatus(file, TASK_EMOJIS.UNIMPORTANT);
						});
				});
			}
		}
	}

	/**
	 * Convert a regular file to a task by adding emoji prefix
	 */
	private convertToTask(file: TFile, emoji: string) {
		new TaskPropertiesModal(this.app, emoji, file.basename, this.settings, (props) => {
			void (async () => {
				// Get the appropriate format template
				let format = this.settings.uncheckedTaskFormat;
				if (emoji === TASK_EMOJIS.SCHEDULED) {
					format = this.settings.scheduledTaskFormat;
				} else if (emoji === TASK_EMOJIS.CHECKED) {
					format = this.settings.completedTaskFormat;
				} else if (emoji === TASK_EMOJIS.UNIMPORTANT) {
					format = this.settings.cancelledTaskFormat;
				}
				
				const taskName = generateTaskName(props, format);
				const cleanEmoji = normalizeEmoji(emoji);
				const newName = `${cleanEmoji} ${taskName.trim()}`.replace(/\s+/g, ' ');
				const newPath = file.parent ? `${file.parent.path}/${newName}.${file.extension}` : `${newName}.${file.extension}`;

				try {
					// Apply template before renaming if enabled
					if (this.settings.applyTemplateOnConvert) {
						await this.applyTemplateToFile(file, emoji, true);
					}
					
					// Then rename the file
					await this.app.fileManager.renameFile(file, newPath);
					
					new Notice(`Converted to task: ${newName}`);
				} catch (error) {
					new Notice(`Failed to convert file: ${error.message}`);
					console.error('Error converting file:', error);
				}
			})();
		}).open();
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
		const cleanEmoji = normalizeEmoji(newEmoji);
		const newName = `${cleanEmoji} ${nameWithoutEmoji}`;
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
			return; // No template configured
		}

		// Normalize the template path
		templatePath = normalizePath(templatePath.trim());

		try {
			// Try multiple methods to find the template file
			let templateFile = this.app.vault.getFileByPath(templatePath);
			
			if (!templateFile) {
				const abstractFile = this.app.vault.getAbstractFileByPath(templatePath);
				if (abstractFile instanceof TFile) {
					templateFile = abstractFile;
				}
			}
			
			// Also try with .md extension if not present
			if (!templateFile && !templatePath.endsWith('.md')) {
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
				new Notice(`Template not found: ${templatePath}`);
				return;
			}

			// Read template content
			const templateContent = await this.app.vault.read(templateFile);
			
			if (!templateContent) {
				console.warn('Template is empty');
				return;
			}
			
			// Read current file content
			const currentContent = await this.app.vault.read(file);
			
			// Apply template if file is empty or if forced (on conversion)
			if (forceApply || currentContent.trim().length === 0) {
				// Process template variables (basic support)
				const processedContent = this.processTemplateVariables(templateContent, file);

				await this.app.vault.modify(file, processedContent);
				new Notice('Template applied');
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

		// Task name format configuration
		new Setting(containerEl).setName('Task name formats').setHeading();
		new Setting(containerEl).setDesc('Customize how task names are formatted. Available placeholders: {action}, {amount}, {outcome}, {date}, {time}, {range}');

		new Setting(containerEl)
			.setName('Unchecked task format (◻️)')
			.setDesc('Format for unchecked tasks (emoji is added automatically, do not include it)')
			.addText(text => {
				text
					.setPlaceholder('{action} - {amount} - {outcome}')
					.setValue(this.plugin.settings.uncheckedTaskFormat)
					.onChange(async (value) => {
						const error = validateFormatTemplate(value);
						if (error) {
							new Notice('Invalid format: ' + error);
							text.setValue(this.plugin.settings.uncheckedTaskFormat);
							return;
						}
						this.plugin.settings.uncheckedTaskFormat = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('task-notes-input-fullwidth');
			});

		new Setting(containerEl)
			.setName('Scheduled task format (📅)')
			.setDesc('Format for scheduled tasks. Use {date} for start date, {time} for time, {range} for end date (emoji is added automatically, do not include it)')
			.addText(text => {
				text
					.setPlaceholder('By {date} (at {time} - {range}), {action} - {amount} - {outcome}')
					.setValue(this.plugin.settings.scheduledTaskFormat)
					.onChange(async (value) => {
						const error = validateFormatTemplate(value);
						if (error) {
							new Notice('Invalid format: ' + error);
							text.setValue(this.plugin.settings.scheduledTaskFormat);
							return;
						}
						this.plugin.settings.scheduledTaskFormat = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('task-notes-input-fullwidth');
			});

		new Setting(containerEl)
			.setName('Completed task format (✅)')
			.setDesc('Format for completed tasks (emoji is added automatically, do not include it)')
			.addText(text => {
				text
					.setPlaceholder('{action} - {amount} - {outcome}')
					.setValue(this.plugin.settings.completedTaskFormat)
					.onChange(async (value) => {
						const error = validateFormatTemplate(value);
						if (error) {
							new Notice('Invalid format: ' + error);
							text.setValue(this.plugin.settings.completedTaskFormat);
							return;
						}
						this.plugin.settings.completedTaskFormat = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('task-notes-input-fullwidth');
			});

		new Setting(containerEl)
			.setName('Cancelled task format (❌)')
			.setDesc('Format for cancelled tasks (emoji is added automatically, do not include it)')
			.addText(text => {
				text
					.setPlaceholder('{action} - {amount} - {outcome}')
					.setValue(this.plugin.settings.cancelledTaskFormat)
					.onChange(async (value) => {
						const error = validateFormatTemplate(value);
						if (error) {
							new Notice('Invalid format: ' + error);
							text.setValue(this.plugin.settings.cancelledTaskFormat);
							return;
						}
						this.plugin.settings.cancelledTaskFormat = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('task-notes-input-fullwidth');
			});

		// Apply button for format settings
		new Setting(containerEl)
			.addButton(button => button
				.setButtonText('Apply format changes')
				.setCta()
				.onClick(async () => {
					await this.plugin.saveSettings();
					new Notice('Format settings saved! The new formats will apply to newly created/edited tasks.');
				}));

		// Template application settings
		new Setting(containerEl).setName('Template application').setHeading();

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

		new Setting(containerEl).setName('Template configuration').setHeading();
		
		const templatesFolder = this.plugin.getTemplatesFolder();
		if (templatesFolder) {
			new Setting(containerEl).setDesc(`Templates from folder: ${templatesFolder}`);
		} else {
			new Setting(containerEl).setDesc('No template folder configured. Go to settings → core plugins → templates to set a template folder.');
		}

		// Get available templates
		const templateFiles = this.plugin.getTemplateFiles();
		
		if (templateFiles.length === 0) {
			new Setting(containerEl).setDesc('No templates found. Create template files in your configured templates folder.');
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
				text.inputEl.addClass('task-notes-input-fullwidth');
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
				text.inputEl.addClass('task-notes-input-fullwidth');
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
				text.inputEl.addClass('task-notes-input-fullwidth');
			});

		if (templateFiles.length > 0) {
			// Template variables info
			new Setting(containerEl).setName('Template variables').setHeading();
			new Setting(containerEl).setDesc('You can use these variables in your template files:');
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

			new Setting(containerEl).setDesc('Note: templates are only applied to empty files to prevent overwriting existing content.');
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
			const rect = this.inputEl.getBoundingClientRect();
			this.suggestEl.style.top = (rect.bottom + window.scrollY) + 'px';
			this.suggestEl.style.left = rect.left + 'px';
			this.suggestEl.style.setProperty('--task-notes-suggest-width', rect.width + 'px');
			document.body.appendChild(this.suggestEl);
		}

		while (this.suggestEl.firstChild) this.suggestEl.removeChild(this.suggestEl.firstChild);

		this.suggestions.forEach((file, index) => {
			const item = document.createElement('div');
			item.className = 'suggestion-item' + (index === this.selectedIndex ? ' selected' : '');
			item.textContent = file.path;

			item.addEventListener('mouseenter', () => {
				this.selectedIndex = index;
				this.renderSuggestions();
			});

			item.addEventListener('click', () => {
				this.selectSuggestion(file);
			});

			if (this.suggestEl) this.suggestEl.appendChild(item);
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
