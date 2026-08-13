import {
	defaultFormats,
	defaultTemplates,
	type TaskFormatSettings,
	type TaskTemplateSettings,
} from '../constants';
import type { TimelineRange } from '../constants';

/** Current settings schema version. */
export const CURRENT_SETTINGS_VERSION = 2;

/** A configured remote ICS calendar. */
export interface IcsCalendarSettings {
	id: string;
	name: string;
	url: string;
	color: string;   // hex; empty = auto-assigned
	email?: string;  // for PARTSTAT declined-event filtering
	enabled: boolean;
}

/**
 * Full plugin settings. Existing keys keep their names so old data.json loads
 * unchanged.
 *
 * The per-type format and template keys are NOT written out here: their shape
 * derives from EMOJI_REGISTRY (see constants.ts), so a new registry entry adds
 * its settings keys to this interface with no edit here. The seven existing
 * keys are byte-identical to what they were when they were hand-written.
 */
export interface TaskNotesSettings extends TaskFormatSettings, TaskTemplateSettings {
	// ── existing (unchanged) ────────────────────────────────────────────
	applyTemplateOnConvert: boolean;
	/** Bumped when defaults change in a way existing installs must not inherit. */
	settingsVersion: number;

	// ── planner / sync ──────────────────────────────────────────────────
	plannerHeading: string;               // e.g. '## Day planner'
	defaultEventDurationMinutes: number;
	sortPlannerLinesOnInsert: boolean;
	syncFilenameOnReschedule: boolean;
	/** Reopen a ✅ note to ◻️ when an unchecked item appears in it. */
	reopenCompletedOnUnchecked: boolean;
	applyTemplateOnDayArrival: boolean;
	/** Only treat date-named notes inside the daily-notes folder as day plans. */
	strictDailyNoteFolder: boolean;

	// ── timeline view ───────────────────────────────────────────────────
	timelineDefaultRange: TimelineRange;
	/**
	 * The colour local events wear in the timeline — their left bar, and their
	 * dot in the month grid. Empty = the default neutral look (no hue). Mirrors
	 * how a remote calendar's colour works, including the reset-to-default.
	 */
	localEventColor: string;
	/**
	 * Draw a status checkbox before every task note in the FILE EXPLORER.
	 *
	 * The plugin's most visible change to Obsidian's own UI, and until now the
	 * only one with no switch. Default true — that is the existing behaviour, so
	 * an upgrade changes nothing.
	 */
	showExplorerCheckboxes: boolean;
	dayStartHour: number;
	/** First hour the grid draws. A day with anything earlier stretches to fit it. */
	visibleStartHour: number;
	/** Last hour the grid draws (24 = midnight). */
	visibleEndHour: number;
	hourHeightPx: number;
	snapMinutes: number;
	firstDayOfWeek: 'locale' | 'monday' | 'sunday';
	showCheckedBlocks: boolean;
	showPlainTextBlocks: boolean;

	// ── sidebar calendar ────────────────────────────────────────────────
	calendarShowWordCountDots: boolean;
	calendarShowTaskDots: boolean;
	calendarShowEventDots: boolean;
	calendarConfirmCreate: boolean;

	// ── remote calendars ────────────────────────────────────────────────
	icsCalendars: IcsCalendarSettings[];
	icsRefreshIntervalMinutes: number;

	// ── notifications ───────────────────────────────────────────────────
	notificationsEnabled: boolean;
	notifyAtStart: boolean;
	notifyLeadMinutes: number;
	/**
	 * Hour of the day an all-day item is announced, or -1 for never. All-day
	 * items have no time to fire at, so before this they never notified at all.
	 */
	notifyAllDayAtHour: number;
	notifyForRemoteEvents: boolean;
	preferSystemNotifications: boolean;
}

export const DEFAULT_SETTINGS: TaskNotesSettings = {
	// Formats and templates come from the registry — each spec's defaultFormat,
	// and '' for every template (empty so migrateSettings fills them into an
	// existing data.json without a version bump: an existing vault gains a
	// setting, not a behaviour). The identity-first goal default vs the legacy
	// form is likewise the registry's defaultFormat vs migrateSettings.
	...defaultFormats(),
	...defaultTemplates(),
	applyTemplateOnConvert: true,
	settingsVersion: CURRENT_SETTINGS_VERSION,

	plannerHeading: '## Day planner',
	defaultEventDurationMinutes: 60,
	sortPlannerLinesOnInsert: true,
	syncFilenameOnReschedule: true,
	reopenCompletedOnUnchecked: true,
	applyTemplateOnDayArrival: true,
	strictDailyNoteFolder: true,

	timelineDefaultRange: 'day',
	localEventColor: '',
	showExplorerCheckboxes: true,
	dayStartHour: 8,
	visibleStartHour: 0,
	visibleEndHour: 24,
	hourHeightPx: 60,
	snapMinutes: 15,
	firstDayOfWeek: 'locale',
	showCheckedBlocks: false,
	showPlainTextBlocks: true,

	calendarShowWordCountDots: true,
	calendarShowTaskDots: true,
	calendarShowEventDots: true,
	calendarConfirmCreate: false,

	icsCalendars: [],
	icsRefreshIntervalMinutes: 5,

	notificationsEnabled: false,
	notifyAtStart: true,
	notifyLeadMinutes: 10,
	notifyAllDayAtHour: 8,
	notifyForRemoteEvents: true,
	preferSystemNotifications: true,
};

/** The goal format shipped before {identity} existed. */
export const LEGACY_TARGET_FORMAT = '{action} - {amount} - {outcome}';

/** Merge persisted data over defaults (adds new keys, keeps user values). */
/**
 * `isFreshVault` is the CALLER's answer: only it can see the whole data file.
 * This function is handed the settings half, with the ICS cache and the hidden
 * events already stripped — so a data.json holding nothing but a cache arrives
 * here as `{}` and must not be mistaken for a new install.
 */
export function migrateSettings(raw: unknown, isFreshVault: boolean): TaskNotesSettings {
	const data = (raw && typeof raw === 'object' ? raw : {}) as Partial<TaskNotesSettings>;
	const merged = Object.assign({}, DEFAULT_SETTINGS, data);
	// Deep-copy arrays: settings-tab mutates in place (push/splice), and a shared
	// reference would silently corrupt DEFAULT_SETTINGS for the process lifetime.
	// Normalised, not just copied: a hand-edited or truncated entry missing `name`
	// or `url` threw while the settings tab rendered, which left the pane half
	// drawn and that calendar impossible to delete.
	merged.icsCalendars = (data.icsCalendars ?? DEFAULT_SETTINGS.icsCalendars)
		.filter((c): c is IcsCalendarSettings => !!c && typeof c === 'object')
		.map((c, i) => ({
			id: typeof c.id === 'string' && c.id ? c.id : `cal-recovered-${i}`,
			name: typeof c.name === 'string' ? c.name : '',
			url: typeof c.url === 'string' ? c.url : '',
			color: typeof c.color === 'string' ? c.color : '',
			email: typeof c.email === 'string' ? c.email : '',
			enabled: c.enabled !== false,
		}));

	// An EXISTING install must never inherit a changed default — that would alter
	// how their filenames are generated without them asking. Only a fresh vault
	// (no persisted data at all) starts on the new goal format; everyone else keeps
	// the legacy one until they opt in from the settings tab.
	const version = data.settingsVersion ?? (isFreshVault ? CURRENT_SETTINGS_VERSION : 1);
	if (version < 2 && data.targetFolderFormat === undefined) {
		merged.targetFolderFormat = LEGACY_TARGET_FORMAT;
	}
	merged.settingsVersion = CURRENT_SETTINGS_VERSION;

	return merged;
}

/** One thing the plugin does to your files without being asked, and its switch. */
export interface AutomaticChange {
	key: 'syncFilenameOnReschedule' | 'applyTemplateOnDayArrival' | 'reopenCompletedOnUnchecked';
	name: string;
	desc: string;
	/** One clause, for the summary sentence. */
	summary: string;
}

/**
 * Which section of the settings pane each setting lives in.
 *
 * Exported so a test can assert every key appears exactly once — "no setting is
 * orphaned, and none is listed in two places" becomes a check rather than a
 * promise. `settingsVersion` is deliberately absent: it is internal.
 */
/**
 * Which settings live in which section.
 *
 * MEMBERSHIP is the contract — the honesty tests read this to check every
 * behaviour is switchable and every switch is reachable. Order is kept roughly
 * in sync with the tab for readability, but it is NOT verifiable from the
 * source: three of these keys are never named literally in settings-tab.ts (they
 * reach `dropdownRow`/`sliderRow` through variables), so a test that tried to
 * assert order would be asserting where a string happens to appear, not where a
 * control is drawn. That test was written and deleted rather than shipped.
 */
export const SETTINGS_SECTIONS: Record<string, readonly (keyof TaskNotesSettings)[]> = {
	automatic: ['syncFilenameOnReschedule', 'applyTemplateOnDayArrival', 'reopenCompletedOnUnchecked'],
	timeline: [
		'timelineDefaultRange',
		'visibleStartHour',
		'visibleEndHour',
		'dayStartHour',
		'hourHeightPx',
		'localEventColor',
		'snapMinutes',
		'defaultEventDurationMinutes',
		'firstDayOfWeek',
		'showCheckedBlocks',
		'showPlainTextBlocks',
		'showExplorerCheckboxes',
	],
	dailyNotes: ['plannerHeading', 'sortPlannerLinesOnInsert', 'strictDailyNoteFolder'],
	calendar: [
		'calendarShowWordCountDots',
		'calendarShowTaskDots',
		'calendarShowEventDots',
		'calendarConfirmCreate',
	],
	remoteCalendars: ['icsCalendars', 'icsRefreshIntervalMinutes'],
	reminders: [
		'notificationsEnabled',
		'notifyAtStart',
		'notifyLeadMinutes',
		'notifyAllDayAtHour',
		'notifyForRemoteEvents',
		'preferSystemNotifications',
	],
	advanced: [
		'uncheckedTaskFormat',
		'scheduledTaskFormat',
		'routineTaskFormat',
		'completedTaskFormat',
		'cancelledTaskFormat',
		'projectFolderFormat',
		'targetFolderFormat',
		'applyTemplateOnConvert',
		'uncheckedTaskTemplate',
		'scheduledTaskTemplate',
		'routineTaskTemplate',
		'completedTaskTemplate',
	],
} as const;

/**
 * THE list. The settings tab renders its prose AND its toggles from this, so the
 * copy can never claim a different number of automatic behaviours than exist —
 * which it did, while a fourth one had no switch at all.
 */
export const AUTOMATIC_CHANGES: readonly AutomaticChange[] = [
	{
		key: 'syncFilenameOnReschedule',
		name: 'Rename 📅 notes to match their planner line',
		desc:
			'When you drag a block, rewrite the note’s filename so its date and time match. ' +
			'Only lines the timeline draws as their own block can do this. Off = filenames ' +
			'only change when you rename them.',
		summary: 'rename a 📅 note when its planner line moves',
	},
	{
		key: 'applyTemplateOnDayArrival',
		name: 'Merge the daily template into plugin-created notes',
		desc:
			'A note planned ahead holds only the planner heading and its lines. When the day ' +
			'arrives, merge your template around them. Only ever applies to notes with nothing ' +
			'else in them.',
		summary: 'merge your daily template into a note the plugin itself created',
	},
	{
		key: 'reopenCompletedOnUnchecked',
		name: 'Reopen a ✅ note that gains an unchecked item',
		desc:
			'Rename a completed note back to ◻️ when an unticked checklist item appears in it, ' +
			'so a note cannot claim to be done while it isn’t.',
		summary: 'reopen a ✅ note to ◻️ when it gains an unchecked item',
	},
];
