import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, debounce, type TextComponent , type ColorComponent } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	LEGACY_TARGET_FORMAT,
	AUTOMATIC_CHANGES,
	type TaskNotesSettings,
} from './settings';
import { EMOJI_REGISTRY, TIMELINE_RANGES, RANGE_LABELS, type TimelineRange, formatKeyOf, templateKeyOf , DEFAULT_EVENT_COLOR } from '../constants';
import { validateFormatTemplate } from '../core/task-name';
import { capitalize } from '../core/format-fields';
import { HOUR_HEIGHT_MIN, HOUR_HEIGHT_MAX, HOUR_HEIGHT_STEP } from '../core/zoom';
import { calendarColor } from '../core/ics-colors';
import { NotificationService } from '../services/notification-service';
import { TemplateFileSuggest } from '../ui/modals/file-suggest';
import { ConfirmModal } from '../ui/modals/simple-modals';
import { icsStatusStore } from '../state/stores';
import { get } from 'svelte/store';
import type { IcsCalendarSettings } from './settings';
import type { IcsStatus } from '../types';

/** The subset of the plugin the settings tab needs. */
export interface SettingsHost {
	app: App;
	settings: TaskNotesSettings;
	saveSettings(): Promise<void>;
	getTemplateFiles(): TFile[];
	onIcsSettingsChanged(): void;
	/** Only a calendar COLOUR changed — re-draw, never re-fetch. */
	onIcsColorsChanged(): void;
	/** The daily-note template configured in core Daily Notes, or null. */
	dailyTemplatePath(): string | null;
	/** Merge the template into today's note. Never creates it. */
	applyTemplateToToday(): Promise<void>;
	/** The existing past-bare sweep, which lists and confirms before writing. */
	applyTemplateToPastBare(): Promise<void>;
	/** A setting that is read while indexing changed; re-read the notes. */
	onIndexSettingsChanged(): void;
	/** The file-explorer decoration was switched on or off. */
	onExplorerSettingChanged(): void;
}

type BooleanKeys = {
	[K in keyof TaskNotesSettings]: TaskNotesSettings[K] extends boolean ? K : never;
}[keyof TaskNotesSettings];

type NumberKeys = {
	[K in keyof TaskNotesSettings]: TaskNotesSettings[K] extends number ? K : never;
}[keyof TaskNotesSettings];

/**
 * Settings holding a FREE-FORM string.
 *
 * The inner `string extends T[K]` is load-bearing: without it, union-typed keys
 * like `firstDayOfWeek` ('locale' | 'monday' | 'sunday') qualify, and a format
 * row would happily write "By {date}, …" into one of them. With it,
 * `formatRow(c, '…', 'firstDayOfWeek')` is a compile error — as was
 * `formatRow(c, '…', 'showCheckedBlocks')` under the old `keyof … & string`.
 */
type StringKeys = {
	[K in keyof TaskNotesSettings]: TaskNotesSettings[K] extends string
		? string extends TaskNotesSettings[K]
			? K
			: never
		: never;
}[keyof TaskNotesSettings];

const SAVE_DEBOUNCE_MS = 400;
/** The identity-first goal format new installs get. */
const RECOMMENDED_TARGET_FORMAT = DEFAULT_SETTINGS.targetFolderFormat;

export class TaskNotesSettingTab extends PluginSettingTab {
	/**
	 * Coalesce per-keystroke writes into one data.json write.
	 * `resetTimer: true` is not optional: without it Obsidian's debounce is
	 * first-call-wins, which would save on the FIRST keystroke of a burst and
	 * drop everything typed after it until the timer lapsed.
	 */
	private saveDebounced = debounce(() => void this.save(), SAVE_DEBOUNCE_MS, true);
	/** Containers re-rendered in place, so a toggle never rebuilds the whole pane. */
	private reminderDetailEl: HTMLElement | null = null;
	private conversionTemplateEl: HTMLElement | null = null;
	/** Live status lines, so a refresh while the tab is open updates in place. */
	private statusEls = new Map<string, { el: HTMLElement; cal: IcsCalendarSettings }>();
	private unsubscribeStatus: (() => void) | null = null;
	private calendarListEl: HTMLElement | null = null;

	constructor(
		app: App,
		private host: SettingsHost & Plugin,
	) {
		super(app, host);
	}

	private get s(): TaskNotesSettings {
		return this.host.settings;
	}

	private save(): Promise<void> {
		return this.host.saveSettings();
	}

	hide(): void {
		this.unsubscribeStatus?.();
		this.unsubscribeStatus = null;
		// Closing the tab must not lose the last keystroke.
		this.saveDebounced.run();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.unsubscribeStatus?.();
		this.unsubscribeStatus = null;
		this.statusEls.clear();
		this.calendarListEl = null;

		// Everyday settings first, reference material last. Nothing is hidden that
		// wasn't already: the seven name formats keep their own disclosure, and the
		// task-conversion templates move next to them because they are the same
		// subject — how a task NOTE is made, not how the timeline behaves.
		this.renderAutomaticChanges(containerEl);
		this.renderTimeline(containerEl);
		this.renderDailyNotes(containerEl);
		this.renderCalendarDots(containerEl);
		this.renderRemoteCalendars(containerEl);
		this.renderReminders(containerEl);

		const advanced = containerEl.createEl('details', { cls: 'task-notes-advanced' });
		advanced.createEl('summary', { text: 'Advanced — names & templates' });
		this.renderFormats(advanced);
		this.renderTemplates(advanced);

		// Update the calendar status lines in place rather than re-rendering the
		// whole tab, which would steal focus from whatever the user is typing in.
		this.unsubscribeStatus = icsStatusStore.subscribe((status) => {
			for (const [id, { el, cal }] of this.statusEls) {
				el.setText(describeIcsStatus(cal, status[id]));
				el.toggleClass('task-notes-ics-error', status[id]?.state === 'error');
			}
		});
	}

	// ── What the plugin changes on its own ────────────────────────────────
	/**
	 * The plugin edits files by itself in a few places. Rather than leave that to
	 * be discovered, list it — and put every switch that turns it off right here.
	 */
	private renderAutomaticChanges(c: HTMLElement): void {
		new Setting(c).setName('Automatic changes').setHeading();
		// Prose and toggles come from ONE list, so the sentence can never claim a
		// different number of behaviours than actually exist.
		const count = AUTOMATIC_CHANGES.length;
		const summary = AUTOMATIC_CHANGES.map((a) => a.summary);
		new Setting(c).setDesc(
			'This plugin never deletes a note, and asks before anything that could remove your text. ' +
				`On its own it only ever does these ${count} things, each switchable below: ` +
				`${summary.slice(0, -1).join(', ')} and ${summary[summary.length - 1]}. ` +
				'Everything else happens only when you ask for it.',
		);
		for (const change of AUTOMATIC_CHANGES) {
			this.toggleRow(c, change.name, change.desc, change.key);
		}
	}

	// ── Task name formats ─────────────────────────────────────────────────
	private renderFormats(c: HTMLElement): void {
		new Setting(c).setName('Task name formats').setHeading();
		new Setting(c).setDesc(
			'How each kind of note is named. The defaults follow the system’s grammar — ' +
				'change one only if you have changed how you name things.',
		);

		// The whole section already lives behind a disclosure, so this is a plain
		// container now rather than a second nested one.
		const details = c;
		new Setting(details).setDesc(
			'Placeholders: {action}, {amount}, {outcome}, {identity}, {name}, {cycle}, {date}, {time}, {range}. ' +
				'The fields a name carries — and their order — follow its format.',
		);

		for (const spec of EMOJI_REGISTRY.filter((s) => s.appliesTo === 'file')) {
			this.formatRow(details, `${capitalize(spec.menuLabel)} format`, formatKeyOf(spec));
		}

		new Setting(details).setName('Folder task formats').setHeading();
		let setGoalFormat: ((value: string) => void) | null = null;
		for (const spec of EMOJI_REGISTRY.filter((s) => s.appliesTo === 'folder')) {
			const set = this.formatRow(details, `${capitalize(spec.menuLabel)} format`, formatKeyOf(spec));
			if (spec.formatSettingKey === 'targetFolderFormat') setGoalFormat = set;
		}

		// Opt-in, never automatic: changing this only affects names generated from
		// now on — no existing file is touched until you press Apply on it.
		if (this.s.targetFolderFormat === LEGACY_TARGET_FORMAT) {
			const row = new Setting(c)
				.setName('Use the recommended goal format')
				.setDesc(
					`Switch the goal format to "${RECOMMENDED_TARGET_FORMAT}", which adds the identity field. ` +
						'Existing goal folders keep their current names until you edit them.',
				)
				.addButton((b) =>
					b.setButtonText('Use it').onClick(async () => {
						this.s.targetFolderFormat = RECOMMENDED_TARGET_FORMAT;
						setGoalFormat?.(RECOMMENDED_TARGET_FORMAT);
						// Remove just this row. Re-rendering the pane scrolled the user
						// back to the top and closed the disclosure they were inside.
						row.settingEl.remove();
						await this.save();
					}),
				);
		}
	}

	/**
	 * A format field. Returns a setter that writes a new value into BOTH the input
	 * and its `lastGood` closure — setting the input alone would make the next
	 * invalid edit revert to the value from before.
	 */
	private formatRow(c: HTMLElement, name: string, key: StringKeys): (value: string) => void {
		// The last value that validated — restored if the user leaves the field invalid.
		let lastGood = this.s[key];
		let field: TextComponent | null = null;
		new Setting(c)
			.setName(name)
			.setDesc('The emoji is added automatically — do not include it.')
			.addText((text) => {
				field = text;
				text.setValue(lastGood).onChange((value) => {
					// Validate on blur, not per keystroke: reverting mid-typing would
					// discard everything typed after a transiently invalid state.
					this.s[key] = value;
					this.saveDebounced();
				});
				text.inputEl.addEventListener('blur', () => {
					const value = this.s[key];
					const error = this.formatError(key, value);
					if (!error) {
						lastGood = value;
						return;
					}
					// Restore just this field (no full re-render, which would swallow
					// the click that caused the blur) and persist the good value.
					new Notice(`Invalid format: ${error}`);
					this.s[key] = lastGood;
					text.setValue(lastGood);
					this.saveDebounced();
				});
				text.inputEl.addClass('task-notes-input-fullwidth');
			});

		return (value) => {
			lastGood = value;
			field?.setValue(value);
		};
	}

	/**
	 * Per-type rules come from the REGISTRY, not from key-name comparisons: a
	 * spec declares its own `requiredPrefix` and whether it `allowsCycle`, so a
	 * future type with either constraint gets validated with no edit here.
	 */
	private formatError(key: string, value: string): string | null {
		const duplicate = validateFormatTemplate(value);
		if (duplicate) return duplicate;
		const spec = EMOJI_REGISTRY.find((s) => s.formatSettingKey === key);
		if (spec?.requiredPrefix && !spec.requiredPrefix.pattern.test(value.trim())) {
			return spec.requiredPrefix.message;
		}
		if (!spec?.allowsCycle && value.includes('{cycle}')) {
			return '{cycle} belongs to the routine format only';
		}
		return null;
	}

	// ── Templates ─────────────────────────────────────────────────────────
	private renderTemplates(c: HTMLElement): void {
		new Setting(c).setName('Template application').setHeading();
		new Setting(c).setDesc(
			'Your DAILY note template comes from the core Daily Notes plugin (or Periodic Notes) — ' +
				'Task Notes reads it from there and never asks for its own copy. Supported placeholders: ' +
				'{{title}}, {{date}}, {{date:FORMAT}}, {{time}}, {{time:FORMAT}}, {{datetime}}, ' +
				'{{timestamp}}, {{yesterday}}, {{tomorrow}} and offsets like {{date+3d:FORMAT}} ' +
				'(d/w/m/y). The settings below are the separate templates used when you convert a note ' +
				'into a task.',
		);
		this.toggleRow(
			c,
			'Apply templates on conversion',
			'Apply a type\'s template when a note ADOPTS that type — converting a plain note ' +
				'(file menu or command palette), changing the Type in the task-properties panel, ' +
				'or "Mark as …" from the right-click menu. Changing a type only fills a note that ' +
				'is EMPTY, so a note you have already written in is never touched.',
			'applyTemplateOnConvert',
			// In place: this row lives INSIDE the disclosure, so re-rendering the
			// pane rebuilt it CLOSED and the row the user had just clicked vanished.
			() => this.renderConversionTemplates(),
		);
		this.conversionTemplateEl = c.createDiv();
		this.renderConversionTemplates();
	}

	/** The template pickers the "on conversion" switch gates. */
	private renderConversionTemplates(): void {
		const c = this.conversionTemplateEl;
		if (!c) return;
		c.empty();
		if (!this.s.applyTemplateOnConvert) return;

		new Setting(c).setDesc(
			'Pick any note to use as a template — start typing to filter. ' +
				'Leave one empty and that type simply gets no template.',
		);
		for (const spec of EMOJI_REGISTRY) {
			const key = templateKeyOf(spec);
			if (!key) continue;
			this.templateRow(c, `${capitalize(spec.menuLabel)} template`, key);
		}
	}

	private templateRow(c: HTMLElement, name: string, key: StringKeys): void {
		new Setting(c).setName(name).addText((text) => {
			new TemplateFileSuggest(this.app, text.inputEl, () => this.host.getTemplateFiles());
			text
				.setPlaceholder('Example: Templates/scheduled.md')
				.setValue(this.s[key])
				.onChange((value) => {
					this.s[key] = value;
					this.saveDebounced();
				});
			text.inputEl.addClass('task-notes-input-fullwidth');
		});
	}

	// ── Planner & sync ────────────────────────────────────────────────────
	private renderDailyNotes(c: HTMLElement): void {
		new Setting(c).setName('Daily notes & the planner').setHeading();
		new Setting(c)
			.setName('Timeline heading')
			.setDesc(
				'Everything under this heading in a daily note is on the timeline, including items ' +
					'with no time — those become all-day chips above the grid. A line that carries a ' +
					'time is shown wherever it is in the note, heading or not. New event lines are ' +
					'written under this heading when a note has no times yet.',
			)
			.addText((t) =>
				t.setValue(this.s.plannerHeading).onChange((v) => {
					this.s.plannerHeading = v || '## Day planner';
					this.saveDebounced();
					// Read while indexing: without this the change is invisible until
					// some unrelated file happens to be edited.
					this.host.onIndexSettingsChanged();
				}),
			);
		this.toggleRow(c, 'Sort planner lines by time', 'Insert new event lines in start-time order.', 'sortPlannerLinesOnInsert');
		this.toggleRow(
			c,
			'Strict daily-note folder',
			'Only treat date-named notes inside your daily-notes folder as day plans. Turn this off and EVERY ' +
				'date-named note anywhere in the vault becomes a day plan, and can drive automatic renames.',
			'strictDailyNoteFolder',
		);
		this.renderTemplateBlock(c);
	}

	/**
	 * The daily template: what happens, when, and how to do it by hand.
	 *
	 * Every action here already existed — a command and a right-click item — and
	 * nothing in the settings mentioned either, so nobody could find them.
	 */
	private renderTemplateBlock(c: HTMLElement): void {
		const template = this.host.dailyTemplatePath();
		new Setting(c).setDesc(
			`Daily template: ${template ?? 'none set (Settings → core plugins → Daily notes)'}. ` +
				'It is merged in automatically only when a note holds NOTHING but its planner lines — ' +
				'checked when Obsidian starts, when the day rolls over while it is running, and when you ' +
				'open such a note. A note with anything else in it is never touched, and a day you planned ' +
				'ahead stays bare until its date arrives.',
		);
		new Setting(c)
			.setName('Apply the template now')
			.setDesc('Merges it into today’s note. Does not create the note if it does not exist yet.')
			.addButton((b) => b.setButtonText('Apply to today').onClick(() => void this.host.applyTemplateToToday()));
		new Setting(c)
			.setName('Days that never got it')
			.setDesc(
				'Finds past notes still holding only their planner lines — days that came and went while ' +
					'Obsidian was closed. Lists them and asks before writing anything.',
			)
			.addButton((b) => b.setButtonText('Find them').onClick(() => void this.host.applyTemplateToPastBare()));
	}

	// ── Timeline ──────────────────────────────────────────────────────────
	private renderTimeline(c: HTMLElement): void {
		new Setting(c).setName('The timeline').setHeading();
		this.dropdownRow(
			c,
			'Default range',
			TIMELINE_RANGES.map((r) => [r, RANGE_LABELS[r]] as const),
			() => this.s.timelineDefaultRange,
			(v) => (this.s.timelineDefaultRange = v as TimelineRange),
			undefined,
			'The range a newly opened timeline starts in.',
		);
		this.sliderRow(
			c,
			'Visible hours — from',
			'The grid starts here. A day that has something earlier stretches to show it, so nothing is ever hidden.',
			'visibleStartHour',
			[0, 23, 1],
		);
		this.sliderRow(
			c,
			'Visible hours — to',
			'…and ends here. Set "to" at or below "from" and the grid shows the whole day.',
			'visibleEndHour',
			[1, 24, 1],
		);
		this.sliderRow(
			c,
			'Default hour (scroll position, and new items)',
			'Two jobs, one hour: where the grid is scrolled when it opens, AND the time an item with no time of its own gets when you schedule it.',
			'dayStartHour',
			[0, 23, 1],
		);
		this.sliderRow(
			c,
			'Hour height (px)',
			'Zoom level of the time grid. Ctrl/Cmd-scroll on the grid changes the same value.',
			'hourHeightPx',
			[HOUR_HEIGHT_MIN, HOUR_HEIGHT_MAX, HOUR_HEIGHT_STEP],
		);
		// The same picker-plus-reset pattern a remote calendar's colour uses, for
		// the same reason: a swatch shows what you actually get, and the reset
		// says out loud that empty means "the default look".
		let picker: ColorComponent | undefined;
		new Setting(c)
			.setName('Local event colour')
			.setDesc(
				'The bar local events wear on the timeline, and their dot in the month grid. ' +
					'Default: no colour — a neutral bar, so only remote calendars, warnings and ' +
					'"now" are coloured.',
			)
			.addColorPicker((c) => {
				picker = c;
				c.setValue(this.s.localEventColor || DEFAULT_EVENT_COLOR).onChange((v) => {
					this.s.localEventColor = v;
					this.saveDebounced();
				});
			})
			.addExtraButton((b) =>
				b
					.setIcon('rotate-ccw')
					.setTooltip('Use the default (no colour)')
					.onClick(() => {
						this.s.localEventColor = '';
						void this.save();
						// The swatch, not the whole pane: `display()` scrolls back to the
						// top and closes every <details>, which four other comments in
						// this file exist to avoid.
						picker?.setValue(DEFAULT_EVENT_COLOR);
					}),
			);

		this.dropdownRow(
			c,
			'Snap to minutes',
			[5, 10, 15, 30].map((m) => [String(m), `${m} min`] as const),
			() => String(this.s.snapMinutes),
			(v) => (this.s.snapMinutes = Number(v)),
		);
		this.sliderRow(
			c,
			'Default event duration (minutes)',
			'Used for unlinked events and newly created blocks.',
			'defaultEventDurationMinutes',
			[5, 240, 5],
			() => this.host.onIndexSettingsChanged(),
		);
		this.dropdownRow(
			c,
			'First day of week',
			[
				['locale', 'Locale default'],
				['monday', 'Monday'],
				['sunday', 'Sunday'],
			],
			() => this.s.firstDayOfWeek,
			(v) => (this.s.firstDayOfWeek = v as TaskNotesSettings['firstDayOfWeek']),
		);
		this.toggleRow(
			c,
			'Show completed items',
			'Off (the default) hides anything ticked — blocks, all-day chips, rows inside a block and calendar chips.',
			'showCheckedBlocks',
		);
		this.toggleRow(
			c,
			'Show plain-text blocks',
			'Render lines that are not links — both under the timeline heading and any timed bullet elsewhere in the note, e.g. "- 16:00 Reviewed the deck" under Log.',
			'showPlainTextBlocks',
			() => this.host.onIndexSettingsChanged(),
		);
	}

	// ── Calendar ──────────────────────────────────────────────────────────
	private renderCalendarDots(c: HTMLElement): void {
		new Setting(c).setName('Calendar dots & creating notes').setHeading();
		this.toggleRow(
			c,
			'Task checkboxes in the file explorer',
			'Show a status checkbox before every task note and folder in Obsidian’s file explorer. ' +
				'Right-clicking it opens the same status menu. Turning this off removes them immediately.',
			'showExplorerCheckboxes',
			() => this.host.onExplorerSettingChanged(),
		);

		// NOT "sized by": the dot is a fixed 4px mark, one per day that has a daily
		// note with words in it. Only the year overview's density mark scales.
		this.toggleRow(
			c,
			'Word-count dots',
			'A faint dot on each day whose daily note has anything written in it.',
			'calendarShowWordCountDots',
		);
		this.toggleRow(c, 'Task dots', 'A hollow dot when a day has unchecked tasks.', 'calendarShowTaskDots');
		this.toggleRow(
			c,
			'Event dots',
			'A dot on each day with a scheduled event. (The 6-month and year overviews always show their density mark.)',
			'calendarShowEventDots',
		);
		this.toggleRow(
			c,
			'Confirm before creating notes',
			'Ask first when clicking a day whose note does not exist yet. The timeline’s day headers ' +
				'already show which it would be — a filled page opens an existing note, an outlined one ' +
				'with a + creates it — so this is belt and braces.',
			'calendarConfirmCreate',
		);
	}

	// ── Remote calendars ──────────────────────────────────────────────────
	private renderRemoteCalendars(c: HTMLElement): void {
		new Setting(c).setName('Remote calendars').setHeading();
		new Setting(c)
			.setDesc(
				'Subscribe to ICS calendars (Google, iCloud, Outlook), or point one at an .ics file ' +
					'inside this vault. Events are read-only and are never written to your notes.',
			)
			.addExtraButton((b) =>
				b
					.setIcon('refresh-cw')
					.setTooltip('Refresh now')
					.onClick(() => {
						this.host.onIcsSettingsChanged();
						new Notice('Refreshing remote calendars…');
					}),
			)
			.addButton((b) =>
				b
					.setButtonText('Add calendar')
					.setCta()
					.onClick(async () => {
						const id = `cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
						this.s.icsCalendars.push({
							id,
							name: 'New calendar',
							url: '',
							color: '',
							email: '',
							enabled: true,
						});
						// Redraw only the LIST. display() empties the whole pane, which
						// scrolled the user back to the top with no new row in sight —
						// the reason adding a calendar looked like it did nothing.
						this.renderCalendarList();
						// By id, not by counting inputs: the old arithmetic assumed four
						// text fields per calendar when there are three, so it focused
						// the PREVIOUS calendar's email box.
						this.focusCalendarName(id);
						await this.save();
						this.host.onIcsSettingsChanged();
					}),
			);

		// The list first, then the setting that governs it — it read the other way
		// round, so the refresh interval appeared before there was anything to
		// refresh. SETTINGS_SECTIONS already lists them in this order.
		this.calendarListEl = c.createDiv({ cls: 'task-notes-ics-list' });
		this.renderCalendarList();

		this.sliderRow(
			c,
			'Refresh interval (minutes)',
			'How often every enabled calendar above is re-fetched.',
			'icsRefreshIntervalMinutes',
			[1, 60, 1],
			() => this.host.onIcsSettingsChanged(),
		);
	}

	/** Focus the name of the calendar just added, so the row announces itself. */
	private focusCalendarName(id: string): void {
		const first = this.calendarListEl?.querySelector<HTMLInputElement>(
			`input[data-cal-name="${CSS.escape(id)}"]`,
		);
		first?.focus();
		first?.scrollIntoView({ block: 'nearest' });
	}

	/** Draw just the calendar rows, into their own container. */
	private renderCalendarList(): void {
		const c = this.calendarListEl;
		if (!c) return;
		c.empty();
		for (const [id] of this.statusEls) if (!this.s.icsCalendars.some((x) => x.id === id)) this.statusEls.delete(id);

		if (this.s.icsCalendars.length === 0) {
			// Two sentences, and "Add calendar" quotes the button by name.
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		new Setting(c).setDesc('No calendars yet. "Add calendar" creates one to fill in.');
			return;
		}

		const status = get(icsStatusStore);
		this.s.icsCalendars.forEach((cal, index) => {
			const head = new Setting(c)
				.setName(cal.name.trim() || `Calendar ${index + 1}`)
				.setDesc(describeIcsStatus(cal, status[cal.id]))
				.addToggle((t) =>
					t.setTooltip('Show this calendar').setValue(cal.enabled).onChange(async (v) => {
						cal.enabled = v;
						// Otherwise the row keeps saying "12 events · updated 14:32"
						// until the next refresh lands.
						head.setDesc(describeIcsStatus(cal, get(icsStatusStore)[cal.id]));
						await this.save();
						this.host.onIcsSettingsChanged();
					}),
				)
				.addExtraButton((b) =>
					b
						.setIcon('trash')
						.setTooltip('Remove this calendar')
						.onClick(() => {
							// Removing a subscription throws away its URL and offline copy:
							// small, but it is still the user's data disappearing.
							new ConfirmModal(
								this.app,
								`Remove the calendar "${cal.name || `Calendar ${index + 1}`}"? ` +
									'Its URL and cached copy are forgotten. No notes are touched.',
								async (ok) => {
									if (!ok) return;
									// Splice by identity, not by the index this row was drawn
									// with — the list may have been redrawn since.
									const at = this.s.icsCalendars.findIndex((x) => x.id === cal.id);
									if (at < 0) return;
									this.s.icsCalendars.splice(at, 1);
									this.statusEls.delete(cal.id);
									this.renderCalendarList();
									await this.save();
									this.host.onIcsSettingsChanged();
								},
							).open();
						}),
				);
			head.descEl.addClass('task-notes-ics-status');
			this.statusEls.set(cal.id, { el: head.descEl, cal });

			// The four fields, each labelled — a row of bare boxes told you nothing.
			const fields = new Setting(c).setClass('task-notes-ics-row');
			const field = (
				label: string,
				placeholder: string,
				value: string,
				onChange: (v: string) => void,
			) => {
				fields.addText((t) => {
					t.setPlaceholder(placeholder).setValue(value).onChange(onChange);
					t.inputEl.setAttribute('aria-label', label);
					t.inputEl.title = label;
				});
			};

			field('Display name', 'Name', cal.name, (v) => {
				cal.name = v;
				// Keep the row's own header in step, or it goes on saying
				// "Calendar 3" while you type the calendar's real name into it.
				head.setName(v.trim() || `Calendar ${index + 1}`);
				this.saveDebounced();
				// Name/colour are baked into each RemoteEvent at expand time,
				// so a re-expand is needed for the change to show.
				this.host.onIcsSettingsChanged();
			});
			// Marked so focusCalendarName can find it without counting siblings.
			const nameInput = fields.controlEl.querySelector<HTMLInputElement>('input[type="text"]');
			nameInput?.setAttribute('data-cal-name', cal.id);
			field('ICS URL (https:// or webcal://) — or a path to an .ics file in this vault', 'ICS URL or vault path', cal.url, (v) => {
				cal.url = v.trim();
				this.saveDebounced();
				this.host.onIcsSettingsChanged();
			});
			// A real swatch, seeded with the colour this calendar is ACTUALLY drawn
			// in — an empty text box gave no clue that a colour had been assigned.
			// Changing it re-draws; it never re-fetches, so dragging the picker
			// cannot hammer the calendar's server.
			fields.addColorPicker((picker) => {
				picker.setValue(calendarColor(cal.color, index)).onChange((v) => {
					cal.color = v;
					this.saveDebounced();
					this.host.onIcsColorsChanged();
				});
			});
			// ColorComponent exposes no element of its own, so label the control it
			// just appended — every other field in this row carries one too.
			const swatch = fields.controlEl.lastElementChild;
			if (swatch instanceof HTMLElement) {
				swatch.setAttribute('aria-label', 'Calendar colour');
				swatch.title = cal.color ? 'Colour for this calendar' : 'Automatic colour for this calendar';
			}
			// The auto colour is never written into settings on the user's behalf,
			// so "automatic" stays a real, restorable state rather than a one-way door.
			fields.addExtraButton((b) =>
				b
					.setIcon('rotate-ccw')
					.setTooltip('Use the automatic colour')
					.setDisabled(!cal.color)
					.onClick(() => {
						cal.color = '';
						this.saveDebounced();
						this.host.onIcsColorsChanged();
						this.renderCalendarList();
					}),
			);
			field('Your address on this calendar — hides events you declined', 'email (optional)', cal.email ?? '', (v) => {
				cal.email = v.trim();
				this.saveDebounced();
				this.host.onIcsSettingsChanged();
			});
		});
	}

	// ── Notifications ─────────────────────────────────────────────────────
	private renderReminders(c: HTMLElement): void {
		new Setting(c).setName('Reminders').setHeading();
		new Setting(c)
			.setName('Enable notifications')
			.setDesc('Remind you at an event\u2019s start, before it, and on the morning of an all-day item.')
			.addToggle((t) =>
				t.setValue(this.s.notificationsEnabled).onChange(async (v) => {
					this.s.notificationsEnabled = v;
					// Ask HERE, where the user just expressed intent — and report what
					// the OS said. Enabling reminders and then silently getting in-app
					// notices instead is the failure this replaces.
					if (v) {
						const permission = await NotificationService.requestPermission();
						if (permission === 'denied') {
							new Notice('Notifications are blocked for Obsidian in your system settings, so reminders will appear in-app.');
						}
					}
					await this.save();
					// Only the rows this switch gates, not the whole pane: re-rendering
					// scrolled the user back to the top every time.
					this.renderReminderDetail();
				}),
			);

		// The honest limit, stated once, where the decision is made — plus what the
		// OS currently allows, because "granted" and "actually delivered" are not the
		// same thing and the difference used to be invisible.
		c.createEl('p', {
			cls: 'setting-item-description',
			text: NotificationService.canUseSystemNotifications()
				? `Reminders fire only while Obsidian is running. Nothing is delivered when it is closed. System notification permission: ${NotificationService.permissionState()}.`
				: 'On mobile, reminders appear inside Obsidian while it is open — no app can post a system notification from here, and the timer stops when Obsidian is in the background.',
		});

		this.reminderDetailEl = c.createDiv();
		this.renderReminderDetail();
	}

	/** The rows the "Enable notifications" switch gates. */
	private renderReminderDetail(): void {
		const c = this.reminderDetailEl;
		if (!c) return;
		c.empty();
		if (!this.s.notificationsEnabled) return;

		this.toggleRow(c, 'Notify at event start', 'A notification the moment it begins.', 'notifyAtStart');
		this.sliderRow(c, 'Reminder lead time (minutes)', '0 disables the early reminder.', 'notifyLeadMinutes', [0, 60, 5]);
		this.sliderRow(
			c,
			'Announce all-day items at (hour)',
			'All-day items have no start time. \u22121 never announces them.',
			'notifyAllDayAtHour',
			[-1, 23, 1],
		);
		this.toggleRow(
			c,
			'Notify for remote events',
			'Include events from your subscribed calendars, not only your own notes.',
			'notifyForRemoteEvents',
		);
		if (NotificationService.canUseSystemNotifications()) {
			this.toggleRow(
				c,
				'Prefer system notifications',
				'Use your operating system\u2019s notifications, which arrive even when Obsidian is not focused. Falls back to in-app notices.',
				'preferSystemNotifications',
			);
		}
	}

	// ── Row builders ──────────────────────────────────────────────────────
	private toggleRow(c: HTMLElement, name: string, desc: string, key: BooleanKeys, after?: () => void): void {
		const setting = new Setting(c).setName(name);
		if (desc) setting.setDesc(desc);
		setting.addToggle((t) =>
			t.setValue(this.s[key]).onChange(async (v) => {
				this.s[key] = v;
				after?.();
				await this.save();
			}),
		);
	}

	private sliderRow(
		c: HTMLElement,
		name: string,
		desc: string,
		key: NumberKeys,
		[min, max, step]: [number, number, number],
		after?: () => void,
	): void {
		const setting = new Setting(c).setName(name);
		if (desc) setting.setDesc(desc);
		setting.addSlider((sl) =>
			sl
				.setLimits(min, max, step)
				.setValue(this.s[key])
				.setDynamicTooltip()
				.onChange((v) => {
					this.s[key] = v;
					// A slider fires per pixel, and serialize() embeds the ICS response
					// cache — which can be megabytes. Coalesce; hide() flushes.
					this.saveDebounced();
					after?.();
				}),
		);
	}

	private dropdownRow(
		c: HTMLElement,
		name: string,
		options: readonly (readonly [string, string])[],
		get: () => string,
		set: (value: string) => void,
		after?: () => void,
		desc = '',
	): void {
		const row = new Setting(c).setName(name);
		if (desc) row.setDesc(desc);
		row.addDropdown((d) => {
			for (const [value, label] of options) d.addOption(value, label);
			d.setValue(get()).onChange(async (v) => {
				set(v);
				await this.save();
				after?.();
			});
		});
	}
}

/** One line telling the user whether a calendar actually worked. */
function describeIcsStatus(cal: IcsCalendarSettings, status: IcsStatus | undefined): string {
	if (!cal.url.trim()) return 'No URL yet.';
	if (!cal.enabled) return 'Disabled.';
	if (!status) return 'Not fetched yet.';
	const when = new Date(status.at).toLocaleTimeString();
	if (status.state === 'ok') return `${status.count} events · updated ${when}`;
	if (status.state === 'cached') return `${status.error} · showing the last copy that worked (${status.count} events)`;
	return `${status.error} · last tried ${when}`;
}
