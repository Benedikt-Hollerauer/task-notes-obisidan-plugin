import { App, Plugin, TFile, TFolder, TAbstractFile, Menu, Notice, PluginSettingTab, Setting, normalizePath, Modal } from 'obsidian';

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
	// Folder-only format templates
	projectFolderFormat: string;
	targetFolderFormat: string;
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
	cancelledTaskFormat: '{action} - {amount} - {outcome}',
	projectFolderFormat: '{action} - {amount} - {outcome}',
	targetFolderFormat:  '{action} - {amount} - {outcome}'
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
	// Remove invisible Unicode format characters (category Cf)
	return emoji.replace(/\p{Cf}/gu, '');
}

// Task emoji constants (used for all item types)
const TASK_EMOJIS = {
	UNCHECKED: '◻️',
	SCHEDULED: '📅',
	CHECKED: '✅',
	UNIMPORTANT: '❌'
} as const;

// Folder-only emoji constants (replace UNCHECKED and SCHEDULED for folders)
const FOLDER_EMOJIS = {
	PROJECT: '🚀',
	TARGET:  '🎯'
} as const;

// Regex to check if a filename has any recognised task emoji prefix
const TASK_EMOJI_REGEX = /^(?:[\u25FB]\uFE0F?|\ud83d\udcc5|\u2705|\u274c|\ud83d\ude80|\ud83c\udfaf)\s+/u;

/**
 * Extract the emoji from a task filename
 */
function extractTaskEmoji(filename: string): string | null {
	const emojis = [
		TASK_EMOJIS.UNCHECKED, TASK_EMOJIS.SCHEDULED,
		TASK_EMOJIS.CHECKED,   TASK_EMOJIS.UNIMPORTANT,
		FOLDER_EMOJIS.PROJECT, FOLDER_EMOJIS.TARGET
	];
	for (const emoji of emojis) {
		const normalized = normalizeEmoji(emoji);
		if (filename.startsWith(emoji + ' ') || filename.startsWith(normalized + ' ')) {
			return emoji;
		}
	}
	return null;
}

/**
 * Extract the task name (without emoji) from a task filename
 */
function extractTaskName(filename: string): string {
	const emoji = extractTaskEmoji(filename);
	if (!emoji) return filename;
	
	// Remove emoji and any variation selectors
	let taskName = filename.replace(TASK_EMOJI_REGEX, '');
	// Clean up any invisible chars
	// Remove leading invisible Unicode format characters and spaces
	taskName = taskName.replace(/^[\p{Cf}\s]+/u, '').trim();
	// Also strip any additional emojis that might have been accidentally added
	taskName = taskName.replace(/^(?:\u25FB\uFE0F?|\ud83d\udcc5|\u2705|\u274c|\ud83d\ude80|\ud83c\udfaf)\s*/gu, '');
	return taskName.trim();
}

/**
 * Check if a filename has a task emoji prefix
 */
function hasTaskEmoji(filename: string): boolean {
	return TASK_EMOJI_REGEX.test(filename);
}

/**
 * Clean up task name by removing any embedded invisible characters (but not regular spaces)
 */
function cleanupTaskName(taskName: string): string {
	return taskName.replace(/\p{Cf}/gu, '').trim();
}

/**
 * Extract and normalize the task emoji from a filename in one step
 */
function getNormalizedEmoji(filename: string): string {
	return normalizeEmoji(extractTaskEmoji(filename) || '');
}

/**
 * Get the display name of a file or folder without its extension.
 * TFile has a dedicated `basename` field; for TFolder the full `name` is used (no extension).
 */
function getBasename(item: TAbstractFile): string {
	return item instanceof TFile ? item.basename : item.name;
}

/**
 * Show an error notice to the user and log it to the console
 */
function notifyError(userMessage: string, error?: unknown): void {
	new Notice(userMessage);
	if (error !== undefined) console.error(userMessage, error);
}

/**
 * Parse task name into properties
 * Robustly parses scheduled/event and regular tasks using strict regex for each format.
 */
function parseTaskProperties(taskName: string, isEvent: boolean): TaskProperties {
	taskName = cleanupTaskName(taskName);

	const cleanPlaceholder = (value: string): string => {
		if (value && /\{[^}]+\}/.test(value)) return '';
		return value;
	};

	const props: TaskProperties = {
		actionWords: '',
		amount: '',
		amountOutcome: ''
	};

	if (isEvent) {
		// Helper: split "action - amount - outcome" remainder into the three props
		const parseRemainder = (remainder: string): void => {
			const partRegex = /^(.+?)\s*-\s*(.+?)\s*-\s*(.+)$/;
			const partMatch = remainder.match(partRegex);
			if (partMatch) {
				props.actionWords = cleanPlaceholder(partMatch[1].trim());
				props.amount = cleanPlaceholder(partMatch[2].trim());
				props.amountOutcome = cleanPlaceholder(partMatch[3].trim());
			} else {
				props.actionWords = cleanPlaceholder(remainder.trim());
			}
		};

		// 1. Legacy format with parens: By YYYY-MM-DD (at HH.MMh - YYYY-MM-DD), action - amount - outcome
		const eventParenRegex = /^By\s+(\d{4}-\d{2}-\d{2})\s*\(\s*(?:at\s+)?(\d{2}\.\d{2}h)?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*\)\s*,?\s*(.+)$/;
		const matchParen = taskName.match(eventParenRegex);
		if (matchParen) {
			props.startDate = cleanPlaceholder(matchParen[1]);
			props.time = matchParen[2] ? cleanPlaceholder(matchParen[2]) : undefined;
			props.endDate = matchParen[3] ? cleanPlaceholder(matchParen[3]) : undefined;
			parseRemainder(matchParen[4]);
			return props;
		}

		// 2. No-parens, date + time + range: By YYYY-MM-DD at HH.MMh - YYYY-MM-DD, action - amount - outcome
		const eventTimeRangeRegex = /^By\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{2}\.\d{2}h)\s*-\s*(\d{4}-\d{2}-\d{2})\s*,\s*(.+)$/;
		const matchTimeRange = taskName.match(eventTimeRangeRegex);
		if (matchTimeRange) {
			props.startDate = cleanPlaceholder(matchTimeRange[1]);
			props.time = cleanPlaceholder(matchTimeRange[2]);
			props.endDate = cleanPlaceholder(matchTimeRange[3]);
			parseRemainder(matchTimeRange[4]);
			return props;
		}

		// 3. No-parens, date + time only: By YYYY-MM-DD at HH.MMh, action - amount - outcome
		const eventTimeOnlyRegex = /^By\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{2}\.\d{2}h)\s*,\s*(.+)$/;
		const matchTimeOnly = taskName.match(eventTimeOnlyRegex);
		if (matchTimeOnly) {
			props.startDate = cleanPlaceholder(matchTimeOnly[1]);
			props.time = cleanPlaceholder(matchTimeOnly[2]);
			parseRemainder(matchTimeOnly[3]);
			return props;
		}

		// 4. No-parens, date + range only: By YYYY-MM-DD - YYYY-MM-DD, action - amount - outcome
		const eventRangeOnlyRegex = /^By\s+(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})\s*,\s*(.+)$/;
		const matchRangeOnly = taskName.match(eventRangeOnlyRegex);
		if (matchRangeOnly) {
			props.startDate = cleanPlaceholder(matchRangeOnly[1]);
			props.endDate = cleanPlaceholder(matchRangeOnly[2]);
			parseRemainder(matchRangeOnly[3]);
			return props;
		}

		// 5. Date only: By YYYY-MM-DD, action - amount - outcome
		const eventDateOnlyRegex = /^By\s+(\d{4}-\d{2}-\d{2})\s*,\s*(.+?)\s*-\s*(.+?)\s*-\s*(.+)$/;
		const matchDateOnly = taskName.match(eventDateOnlyRegex);
		if (matchDateOnly) {
			props.startDate = cleanPlaceholder(matchDateOnly[1]);
			props.actionWords = cleanPlaceholder(matchDateOnly[2]);
			props.amount = cleanPlaceholder(matchDateOnly[3]);
			props.amountOutcome = cleanPlaceholder(matchDateOnly[4]);
			return props;
		}
	}

	// 4. Regular task: action - amount - outcome
	const partRegex = /^(.+?)\s*-\s*(.+?)\s*-\s*(.+)$/;
	const match = taskName.match(partRegex);
	if (match) {
		props.actionWords = cleanPlaceholder(match[1].trim());
		props.amount = cleanPlaceholder(match[2].trim());
		props.amountOutcome = cleanPlaceholder(match[3].trim());
		return props;
	}

	// 5. Fallback: just action
	props.actionWords = cleanPlaceholder(taskName.trim());
	return props;
}

// Patch: make settings available globally for parseTaskProperties
((window as unknown) as Record<string, unknown>).taskNotesPluginSettings = DEFAULT_SETTINGS;

/**
 * Generate task name from properties using format template
 */
function generateTaskName(props: TaskProperties, format: string): string {
	let result = format.replace(/^(?:◻️|✅|📅|❌|🚀|🎯)\s*/, '');

	// Capitalize action for regular tasks, lowercase for events (action follows date in events)
	const isEvent = format.includes('{date}');
	let actionWords = props.actionWords;
	if (actionWords) {
		if (isEvent) {
			actionWords = actionWords.charAt(0).toLowerCase() + actionWords.slice(1);
		} else {
			actionWords = actionWords.charAt(0).toUpperCase() + actionWords.slice(1);
		}
	}

	if (props.startDate) {
		result = result.replace('{date}', props.startDate);
		// Replace with raw values — the format template already contains literal "at" and " - "
		result = result.replace('{time}', props.time || '');
		result = result.replace('{range}', props.endDate || '');
	} else {
		result = result.replace('{date}', '');
		result = result.replace('{time}', '');
		result = result.replace('{range}', '');
	}

	result = result.replace('{action}', actionWords);
	result = result.replace('{amount}', props.amount);
	result = result.replace('{outcome}', props.amountOutcome);

	result = result.replace(/\{[^}]+\}/g, '');

	// Strip orphaned "By ," prefix that appears when a date-prefixed format is used but no date is present
	result = result.replace(/^By\s*,\s*/i, '').trim();

	// 1. Strip parentheses from the time/range block entirely — parens are never wanted.
	//    "(at 13.27h - 2026-01-18)" → "at 13.27h - 2026-01-18"
	//    "(at  - )"                 → "at  - "
	result = result.replace(/\((at[^)]*)\)/g, '$1');

	// 2. Remove orphaned "at" when the time value is absent
	//    "at  -" → "-"  /  "at  ," → ","
	result = result.replace(/\bat\s+(?=[-,])/g, '');

	// 3. Remove trailing " - " immediately before a comma when range is absent
	//    "at 13.27h - ," → "at 13.27h,"
	result = result.replace(/\s*-\s*,/g, ',');

	result = result.replace(/\(\s*\)/g, '');
	result = result.replace(/\s+([,)])/g, '$1');
	result = result.replace(/-\s*-\s*/g, '-');
	result = result.replace(/\s+/g, ' ').trim();
	result = result.replace(/-\s*$/, '').trim();
	result = result.replace(/,\s*$/, '').trim();

	return result;
}

/**
 * Get the configured name format for a task emoji
 */
function getTaskFormatByEmoji(emoji: string, settings: TaskNotesSettings): string {
	const normalized = normalizeEmoji(emoji);

	if (normalized === normalizeEmoji(TASK_EMOJIS.SCHEDULED))   return settings.scheduledTaskFormat;
	if (normalized === normalizeEmoji(TASK_EMOJIS.CHECKED))     return settings.completedTaskFormat;
	if (normalized === normalizeEmoji(TASK_EMOJIS.UNIMPORTANT)) return settings.cancelledTaskFormat;
	if (normalized === normalizeEmoji(FOLDER_EMOJIS.PROJECT))   return settings.projectFolderFormat;
	if (normalized === normalizeEmoji(FOLDER_EMOJIS.TARGET))    return settings.targetFolderFormat;

	return settings.uncheckedTaskFormat;
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

	onOpen(): void {
		// Prevent Obsidian's backdrop-click close.
		// Obsidian's close listener sits on bgEl (the overlay). We intercept in capture
		// phase on containerEl — before the event reaches bgEl — and block any click that
		// lands outside the modal box (contentEl.parentElement = the white dialog element).
		this.containerEl.addEventListener('click', (e: MouseEvent) => {
			const insideModal = this.contentEl.parentElement?.contains(e.target as Node) ?? false;
			if (!insideModal) {
				e.stopPropagation();
			}
		}, true);

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
		const format = getTaskFormatByEmoji(this.emoji, this.settings);
		const labels = extractFieldLabels(format);

		// Action words input
		const actionGroup = form.createDiv({ cls: 'task-modal-input-group' });
		actionGroup.createEl('label', { text: labels.action });
		const actionInput = actionGroup.createEl('input', { type: 'text', cls: 'task-modal-text-input' });
		actionInput.placeholder = 'E.g., buy, finish, complete';
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

		// Pressing Enter in any text input submits the form instead of triggering
		// Obsidian's modal-level handlers or the cancel button.
		form.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.stopPropagation();
				const target = e.target as HTMLElement;
				if (target.tagName === 'INPUT' && target.getAttribute('type') === 'text') {
					e.preventDefault();
					const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
					if (submitBtn) submitBtn.click();
				}
			}
		});

		// Focus first input
		if (this.isEvent && startDateInput) {
			startDateInput.focus();
		} else {
			actionInput.focus();
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export default class TaskNotesPlugin extends Plugin {
	private titleCheckboxObserver: MutationObserver | null = null;
	private fileExplorerObserver: MutationObserver | null = null;
	private fileUncheckedState: Map<string, boolean> = new Map();
	settings: TaskNotesSettings;

	async onload(): Promise<void> {
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

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		((window as unknown) as Record<string, unknown>).taskNotesPluginSettings = this.settings; // always update global ref
	}

	onunload(): void {
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
	 * Initialize file explorer with checkboxes for existing task files and folders
	 */
	private initializeFileExplorer(): void {
		this.app.vault.getMarkdownFiles().forEach(f => this.updateExplorerItem(f));
		this.app.vault.getAllFolders().forEach(f => this.updateExplorerItem(f));
		this.setupFileExplorerObserver();
	}

	/**
	 * Set up MutationObserver to watch for file explorer DOM changes
	 */
	private setupFileExplorerObserver(): void {
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
	private processFileExplorerNode(_node: HTMLElement): void {
		// Re-scan all visible file and folder items.
		const selectors = ['.nav-file-title', '.nav-folder-title'];
		for (const selector of selectors) {
			document.querySelectorAll(selector).forEach((el) => {
				const path = el.getAttribute('data-path');
				if (path) {
					const item = this.app.vault.getAbstractFileByPath(path);
					if (item) this.updateExplorerItem(item);
				}
			});
		}
	}

	/**
	 * Update the file/folder explorer item with a checkbox based on task status
	 */
	private updateExplorerItem(item: TAbstractFile): void {
		// Skip non-markdown files (but always process folders)
		if (item instanceof TFile && item.extension !== 'md') return;

		const el = this.getExplorerElement(item);
		if (!el) return;

		const existingCheckbox = el.querySelector('.task-notes-checkbox');

		if (!hasTaskEmoji(getBasename(item))) {
			if (existingCheckbox) existingCheckbox.remove();
			return;
		}

		const emoji = getNormalizedEmoji(getBasename(item));

		if (existingCheckbox) {
			const existingEmoji = existingCheckbox.getAttribute('data-emoji');
			if (existingEmoji === emoji) return;
			existingCheckbox.remove();
		}

		const checkbox = this.createCheckbox(emoji, false, item);

		const contentSelector = item instanceof TFolder
			? '.nav-folder-title-content'
			: '.nav-file-title-content';
		const titleContent = el.querySelector(contentSelector);
		if (titleContent) {
			titleContent.insertBefore(checkbox, titleContent.firstChild);
		}
	}

	/**
	 * Get the file explorer DOM element for a file or folder
	 */
	private getExplorerElement(item: TAbstractFile): HTMLElement | null {
		const selector = item instanceof TFolder ? '.nav-folder-title' : '.nav-file-title';
		const els = document.querySelectorAll(selector);
		for (let i = 0; i < els.length; i++) {
			const el = els[i] as HTMLElement;
			if (el.getAttribute('data-path') === item.path) return el;
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

		if (!hasTaskEmoji(file.basename)) {
			return container;
		}

		const taskName = extractTaskName(file.basename);
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
		const format = getTaskFormatByEmoji(emoji, this.settings);
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
	private async handlePropertyInputChange(file: TFile, emoji: string, container: HTMLElement): Promise<void> {
		// Normalize the emoji right at the start
		const normalizedEmoji = normalizeEmoji(emoji);
		
		if (!hasTaskEmoji(file.basename)) {
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
		const format = getTaskFormatByEmoji(normalizedEmoji, this.settings);

		const newTaskName = generateTaskName(props, format);
		// Remove any embedded variation selectors from the generated task name
		const cleanedTaskName = cleanupTaskName(newTaskName);
		// Ensure exactly one space between emoji and task name
		const newName = `${normalizedEmoji} ${cleanedTaskName}`.replace(/\s+/g, ' ').trim();
		if (await this.renameTaskFile(file, newName)) {
			new Notice('Task updated successfully');
		}
	}

	/**
	 * Create a checkbox element
	 */
	private createCheckbox(emoji: string, interactive: boolean = true, itemForMenu?: TAbstractFile): HTMLElement {
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'task-notes-checkbox';
		checkbox.checked = (emoji === TASK_EMOJIS.CHECKED) || (emoji === TASK_EMOJIS.UNIMPORTANT);
		checkbox.disabled = !interactive;
		checkbox.setAttribute('data-emoji', emoji);

		if (itemForMenu) {
			const ref = itemForMenu;
			checkbox.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
				try {
					this.showContextMenuForItem(ref, e, emoji, false);
				} catch (err) {
					notifyError('Failed to open context menu', err);
				}
			});
		}

		return checkbox;
	}

	/**
	 * Update the title checkbox for the currently active file
	 */
	private updateTitleCheckbox(file: TFile | null): void {
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

		if (!hasTaskEmoji(file.basename)) {
			return;
		}

		const emoji = getNormalizedEmoji(file.basename);

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
			this.showContextMenuForItem(file, e, emoji, true);
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
	private removeTitleCheckbox(): void {
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
	 * When switching FROM a scheduled event to any other type, strip the date/time prefix
	 * and reformat the name using only action/amount/outcome.
	 * For all other conversions the name is kept as-is.
	 */
	private reformatNameForNewType(rawTaskName: string, fromEmoji: string, toEmoji: string): string {
		const fromIsEvent = normalizeEmoji(fromEmoji) === normalizeEmoji(TASK_EMOJIS.SCHEDULED);
		const toIsEvent   = normalizeEmoji(toEmoji)   === normalizeEmoji(TASK_EMOJIS.SCHEDULED);

		// When converting away from a scheduled event, keep the full name as-is.
		// Only the emoji prefix changes; date, time, and range are preserved verbatim.
		if (fromIsEvent && !toIsEvent) {
			return rawTaskName;
		}

		return rawTaskName;
	}

	/**
	 * Handle checkbox click in the title
	 */
	private async handleTitleCheckboxClick(file: TFile, currentEmoji: string): Promise<void> {
		const newEmoji = this.getNextEmoji(currentEmoji);

		// Guard: Only allow marking as completed when all markdown todos are checked
		if (newEmoji === TASK_EMOJIS.CHECKED) {
			const allChecked = await this.areAllMarkdownTodosChecked(file);
			if (!allChecked) {
				new Notice('Please complete all checklist items in the note first.');
				return;
			}
		}

		const rawTaskName = extractTaskName(file.basename);
		const newTaskName = this.reformatNameForNewType(rawTaskName, currentEmoji, newEmoji);
		const newName = `${newEmoji} ${newTaskName}`.trim();
		await this.renameTaskFile(file, newName);
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
			const hasUnchecked = /(^|\n)\s*[-*+]\s+\[\s?\]/m.test(content);
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

	private addConvertMenuItems(menu: Menu, item: TAbstractFile): void {
		if (item instanceof TFolder) {
			menu.addItem(mi => mi.setTitle('Convert to goal 🎯').setIcon('crosshair').onClick(() => { this.convertToTask(item, FOLDER_EMOJIS.TARGET); }));
			menu.addItem(mi => mi.setTitle('Convert to project 🚀').setIcon('rocket').onClick(() => { this.convertToTask(item, FOLDER_EMOJIS.PROJECT); }));
		} else {
			menu.addItem(mi => mi.setTitle('Convert to unchecked task ◻️').setIcon('checkbox-glyph').onClick(() => { this.convertToTask(item, TASK_EMOJIS.UNCHECKED); }));
			menu.addItem(mi => mi.setTitle('Convert to scheduled task 📅').setIcon('calendar-glyph').onClick(() => { this.convertToTask(item, TASK_EMOJIS.SCHEDULED); }));
		}
		menu.addItem(mi => mi.setTitle('Convert to completed task ✅').setIcon('checkmark').onClick(() => { this.convertToTask(item, TASK_EMOJIS.CHECKED); }));
		menu.addItem(mi => mi.setTitle('Convert to unimportant ❌').setIcon('cross').onClick(() => { this.convertToTask(item, TASK_EMOJIS.UNIMPORTANT); }));
	}

	private addStatusChangeMenuItems(menu: Menu, item: TAbstractFile): void {
		const current = getNormalizedEmoji(getBasename(item));
		menu.addItem(mi => mi.setTitle('Remove task status').setIcon('cross').onClick(async () => { await this.removeTaskEmoji(item); }));
		if (item instanceof TFolder) {
			if (current !== normalizeEmoji(FOLDER_EMOJIS.TARGET))  menu.addItem(mi => mi.setTitle('Mark as goal 🎯').setIcon('crosshair').onClick(async () => { await this.changeTaskStatus(item, FOLDER_EMOJIS.TARGET); }));
			if (current !== normalizeEmoji(FOLDER_EMOJIS.PROJECT)) menu.addItem(mi => mi.setTitle('Mark as project 🚀').setIcon('rocket').onClick(async () => { await this.changeTaskStatus(item, FOLDER_EMOJIS.PROJECT); }));
		} else {
			if (current !== normalizeEmoji(TASK_EMOJIS.UNCHECKED)) menu.addItem(mi => mi.setTitle('Mark as unchecked ◻️').setIcon('checkbox-glyph').onClick(async () => { await this.changeTaskStatus(item, TASK_EMOJIS.UNCHECKED); }));
			if (current !== normalizeEmoji(TASK_EMOJIS.SCHEDULED)) menu.addItem(mi => mi.setTitle('Mark as scheduled 📅').setIcon('calendar-glyph').onClick(async () => { await this.changeTaskStatus(item, TASK_EMOJIS.SCHEDULED); }));
		}
		if (current !== normalizeEmoji(TASK_EMOJIS.CHECKED))      menu.addItem(mi => mi.setTitle('Mark as completed ✅').setIcon('checkmark').onClick(async () => { await this.changeTaskStatus(item, TASK_EMOJIS.CHECKED); }));
		if (current !== normalizeEmoji(TASK_EMOJIS.UNIMPORTANT))  menu.addItem(mi => mi.setTitle('Mark as unimportant ❌').setIcon('cross').onClick(async () => { await this.changeTaskStatus(item, TASK_EMOJIS.UNIMPORTANT); }));
	}

	private showContextMenuForItem(item: TAbstractFile, e: MouseEvent, _currentEmoji: string, _isTitle: boolean): void {
		const menu = new Menu();

		if (hasTaskEmoji(getBasename(item))) {
			this.addStatusChangeMenuItems(menu, item);
		} else {
			this.addConvertMenuItems(menu, item);
		}

		menu.addSeparator();
		menu.addItem(mi => mi.setTitle('Use custom emoji').setIcon('pencil').onClick(() => { this.showCustomEmojiDialog(item); }));

		try {
			menu.showAtMouseEvent(e);
		} catch (err) {
			notifyError('Failed to open menu', err);
		}
	}

	/**
	 * Show dialog for custom emoji input
	 */
	private showCustomEmojiDialog(file: TAbstractFile): void {
		const currentEmoji = getNormalizedEmoji(getBasename(file));

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
			if (hasTaskEmoji(getBasename(file))) {
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

		input.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				const newEmoji = input.value.trim();
				if (!newEmoji) {
					new Notice('Please enter an emoji or text');
					return;
				}

				dialog.remove();

				if (hasTaskEmoji(getBasename(file))) {
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
	private handleFileRename(file: TAbstractFile, oldPath: string): void {
		this.updateExplorerItem(file);

		if (file instanceof TFile && file.extension === 'md') {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile && activeFile.path === file.path) {
				this.updateTitleCheckbox(file);
			}
			const prev = this.fileUncheckedState.get(oldPath);
			if (typeof prev === 'boolean') {
				this.fileUncheckedState.delete(oldPath);
				this.fileUncheckedState.set(file.path, prev);
			}
		}
	}

	/**
	 * Handle file/folder create events
	 */
	private handleFileCreate(file: TAbstractFile): void {
		this.updateExplorerItem(file);
		if (file instanceof TFile && file.extension === 'md') {
			this.refreshFileUncheckedState(file).catch(() => {});
		}
	}

	/**
	 * Handle file/folder delete events
	 */
	private handleFileDelete(file: TAbstractFile): void {
		if (file instanceof TFile) {
			this.fileUncheckedState.delete(file.path);
		}
	}

	/**
	 * Initialize per-file unchecked state map at load to enable accurate change detection
	 */
	private async initializeTodoState(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		for (const f of files) {
			await this.refreshFileUncheckedState(f);
		}
	}

	/** Update tracked state for a file by scanning its content */
	private async refreshFileUncheckedState(file: TFile): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			const hasUnchecked = /(^|\n)\s*[-*+]\s+\[\s?\]/m.test(content);
			this.fileUncheckedState.set(file.path, hasUnchecked);
		} catch (e) {
			console.error('Error refresh file unchecked state:', e);
		}
	}

	/** Handle file content modifications to auto-reopen checked tasks */
	private async handleFileModify(file: TFile): Promise<void> {
		let prev = this.fileUncheckedState.get(file.path);
		try {
			const content = await this.app.vault.read(file);
			const hasUnchecked = /(^|\n)\s*[-*+]\s+\[\s?\]/m.test(content);
			// If we don't have previous state (e.g., very first observed edit), initialize it
			if (typeof prev !== 'boolean') {
				this.fileUncheckedState.set(file.path, hasUnchecked);
				return;
			}

			// Only act when a transition from no unchecked -> has unchecked occurs
			if (!prev && hasUnchecked) {
				const matchedEmoji = getNormalizedEmoji(file.basename);
				if (matchedEmoji === TASK_EMOJIS.CHECKED) {
					await this.changeTaskStatus(file, TASK_EMOJIS.UNCHECKED);
					new Notice('Note contains unchecked checklist items. Reopening task to ◻️.');
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
	private addFileContextMenu(menu: Menu, file: TAbstractFile): void {
		const isMarkdownFile = file instanceof TFile && file.extension === 'md';
		const isFolder = file instanceof TFolder;
		if (!isMarkdownFile && !isFolder) return;

		if (hasTaskEmoji(getBasename(file))) {
			this.addStatusChangeMenuItems(menu, file);
		} else {
			this.addConvertMenuItems(menu, file);
		}
	}

	/**
	 * Convert a file or folder to a task by adding an emoji prefix
	 */
	private convertToTask(item: TAbstractFile, emoji: string): void {
		new TaskPropertiesModal(this.app, emoji, getBasename(item), this.settings, (props) => {
			void (async () => {
				const format = getTaskFormatByEmoji(emoji, this.settings);
				const taskName = generateTaskName(props, format);
				const cleanEmoji = normalizeEmoji(emoji);
				const newName = `${cleanEmoji} ${taskName.trim()}`.replace(/\s+/g, ' ');

				// Templates only apply to files
				if (item instanceof TFile && this.settings.applyTemplateOnConvert) {
					try {
						await this.applyTemplateToFile(item, emoji, true);
					} catch (error) {
						notifyError('Failed to apply template', error);
					}
				}

				if (await this.renameTaskFile(item, newName)) {
					new Notice(`Converted to task: ${newName}`);
				}
			})();
		}).open();
	}

	/**
	 * Rename a task file to a new basename, building the full path automatically
	 */
	private async renameTaskFile(item: TAbstractFile, newName: string): Promise<boolean> {
		const suffix = item instanceof TFile ? `.${item.extension}` : '';
		const newPath = item.parent
			? `${item.parent.path}/${newName}${suffix}`
			: `${newName}${suffix}`;
		try {
			await this.app.fileManager.renameFile(item, newPath);
			return true;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			notifyError(`Failed to rename: ${msg}`, error);
			return false;
		}
	}

	/**
	 * Remove task emoji from filename
	 */
	private async removeTaskEmoji(item: TAbstractFile): Promise<void> {
		if (!hasTaskEmoji(getBasename(item))) return;

		const nameWithoutEmoji = extractTaskName(getBasename(item));
		if (await this.renameTaskFile(item, nameWithoutEmoji)) {
			new Notice(`Removed task status from: ${nameWithoutEmoji}`);
		}
	}

	/**
	 * Change task status emoji
	 */
	private async changeTaskStatus(item: TAbstractFile, newEmoji: string): Promise<void> {
		if (!hasTaskEmoji(getBasename(item))) return;

		if (newEmoji === TASK_EMOJIS.CHECKED && item instanceof TFile) {
			const allChecked = await this.areAllMarkdownTodosChecked(item);
			if (!allChecked) {
				new Notice('Please complete all checklist items in the note first.');
				return;
			}
		}

		const bn           = getBasename(item);
		const currentEmoji = extractTaskEmoji(bn) || '';
		const rawTaskName  = extractTaskName(bn);
		const cleanEmoji   = normalizeEmoji(newEmoji);
		const newTaskName  = this.reformatNameForNewType(rawTaskName, currentEmoji, cleanEmoji);
		const newName      = `${cleanEmoji} ${newTaskName}`;
		await this.renameTaskFile(item, newName);
	}

	/**
	 * Clean up all file explorer checkboxes
	 */
	private cleanupFileExplorerCheckboxes(): void {
		const checkboxes = document.querySelectorAll('.task-notes-checkbox');
		checkboxes.forEach(checkbox => checkbox.remove());
	}

	/**
	 * Apply template to a file based on task emoji
	 */
	private async applyTemplateToFile(file: TFile, emoji: string, forceApply: boolean = false): Promise<void> {
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

			const processedContent = this.processTemplateVariables(templateContent, file);

			if (currentContent.trim().length === 0) {
				// File is empty — replace with template
				await this.app.vault.modify(file, processedContent);
				new Notice('Template applied');
			} else if (forceApply) {
				// File already has content — append template below existing content
				await this.app.vault.modify(file, currentContent + '\n\n' + processedContent);
				new Notice('Template appended');
			}
		} catch (error) {
			notifyError('Error applying template', error);
		}
	}

	/**
	 * Process basic template variables
	 */
	private processTemplateVariables(content: string, file: TFile): string {
		const now = new Date();
		const fileName = extractTaskName(file.basename);
		
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
	app: App;

	constructor(app: App, plugin: TaskNotesPlugin) {
		super(app, plugin);
		this.app = app;
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Task name format configuration
		new Setting(containerEl).setName('Task name formats').setHeading();
		new Setting(containerEl).setDesc('Customize how task names are formatted. Available placeholders: {action}, {amount}, {outcome}, {date}, {time}, {range}');

		this.addFormatSetting(containerEl, 'Unchecked task format (◻️)', 'Format for unchecked tasks (emoji is added automatically, do not include it)', 'uncheckedTaskFormat', '{action} - {amount} - {outcome}');
		this.addFormatSetting(containerEl, 'Scheduled task format (📅)', 'Format for scheduled tasks. Use {date} for start date, {time} for time, {range} for end date (emoji is added automatically, do not include it)', 'scheduledTaskFormat', 'By {date} (at {time} - {range}), {action} - {amount} - {outcome}');
		this.addFormatSetting(containerEl, 'Completed task format (✅)', 'Format for completed tasks (emoji is added automatically, do not include it)', 'completedTaskFormat', '{action} - {amount} - {outcome}');
		this.addFormatSetting(containerEl, 'Cancelled task format (❌)', 'Format for cancelled tasks (emoji is added automatically, do not include it)', 'cancelledTaskFormat', '{action} - {amount} - {outcome}');

		new Setting(containerEl).setName('Folder task formats').setHeading();
		new Setting(containerEl).setDesc('Formats used when converting folders. Available placeholders: {action}, {amount}, {outcome}');
		this.addFormatSetting(containerEl, 'Project folder format (🚀)', 'Format for project folders (emoji is added automatically, do not include it)', 'projectFolderFormat', '{action} - {amount} - {outcome}');
		this.addFormatSetting(containerEl, 'Goal folder format (🎯)', 'Format for goal folders (emoji is added automatically, do not include it)', 'targetFolderFormat', '{action} - {amount} - {outcome}');

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

		this.addTemplateSetting(containerEl, 'Unchecked task template (◻️)', 'Template to apply when converting to an unchecked task', 'uncheckedTaskTemplate', 'Example: Templates/task-template.md');
		this.addTemplateSetting(containerEl, 'Scheduled task template (📅)', 'Template to apply when converting to a scheduled task', 'scheduledTaskTemplate', 'Example: Templates/scheduled-template.md');
		this.addTemplateSetting(containerEl, 'Completed task template (✅)', 'Template to apply when converting to a completed task', 'completedTaskTemplate', 'Example: Templates/completed-template.md');

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

	private addFormatSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: 'uncheckedTaskFormat' | 'scheduledTaskFormat' | 'completedTaskFormat' | 'cancelledTaskFormat' | 'projectFolderFormat' | 'targetFolderFormat',
		placeholder: string
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => {
				text
					.setPlaceholder(placeholder)
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						const error = validateFormatTemplate(value);
						if (error) {
							new Notice('Invalid format: ' + error);
							text.setValue(this.plugin.settings[key]);
							return;
						}
						this.plugin.settings[key] = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('task-notes-input-fullwidth');
			});
	}

	private addTemplateSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: 'uncheckedTaskTemplate' | 'scheduledTaskTemplate' | 'completedTaskTemplate',
		placeholder: string
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => {
				new TemplateFileSuggest(this.app, text.inputEl, this.plugin);
				text.setPlaceholder(placeholder)
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						this.plugin.settings[key] = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('task-notes-input-fullwidth');
			});
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
