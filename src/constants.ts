// Shared constants used across all layers.

/* ═══════════════════════════════════════════════════════════════════════════
 * EMOJI VOCABULARY — the ONE place to edit the emoji set of your system.
 *
 * Every regex, menu entry, format lookup, settings key, settings default and
 * status predicate in the plugin is derived from this registry. This is
 * deliberately a source-level decision, not a settings option: the vocabulary
 * defines the filename grammar of your whole vault.
 *
 * ── HOW TO ADD A TYPE ──────────────────────────────────────────────────────
 * Append ONE entry below. That is the whole change:
 *   - `formatSettingKey` / `templateSettingKey` name NEW settings keys; the
 *     TypeScript types, the DEFAULT_SETTINGS entries and the settings-tab rows
 *     are all derived from the registry, so they appear on their own.
 *   - `defaultFormat` is what a fresh install (and an existing vault, via
 *     migrateSettings' fill-missing pass) gets for that key.
 *   - `role`/`appliesTo` decide which menus and pickers offer it
 *     (specsFor, blockKindOptions).
 *   - Only a format containing `{date}` is treated as dated — nothing keys on
 *     the emoji itself.
 * tests/registry.test.ts walks the registry and fails if an entry is missing
 * anything; the filename grammar (core/task-name.ts) is untouched by additions.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface EmojiSpec {
	/** Canonical form written into filenames (may include a variation selector). */
	emoji: string;
	/** Stable identifier; also the anchor for derived lookups. */
	key: string;
	/** Lifecycle role: open = actionable, scheduled = dated event, done/dropped = finished states. */
	role: 'open' | 'scheduled' | 'done' | 'dropped';
	appliesTo: 'file' | 'folder';
	/** The settings key holding this type's filename format. */
	formatSettingKey: string;
	/** What a fresh install writes into that key. */
	defaultFormat: string;
	/** The settings key holding this type's template path, if it has one. */
	templateSettingKey?: string;
	menuLabel: string;
	menuIcon: string;
	/** The format editor refuses a format that does not match (with this message). */
	requiredPrefix?: { pattern: RegExp; message: string };
	/** May this type's format carry `{cycle}`? Only routines repeat. */
	allowsCycle?: boolean;
}

const REGISTRY = [
	{
		emoji: '◻️',
		key: 'unchecked',
		role: 'open',
		appliesTo: 'file',
		formatSettingKey: 'uncheckedTaskFormat',
		defaultFormat: '{action} - {amount} - {outcome}',
		templateSettingKey: 'uncheckedTaskTemplate',
		// Declared across every entry so the union stays uniform — see the
		// templateSettingKey note above.
		requiredPrefix: undefined,
		allowsCycle: false,
		menuLabel: 'unchecked ◻️',
		menuIcon: 'checkbox-glyph',
	},
	{
		emoji: '📅',
		key: 'scheduled',
		role: 'scheduled',
		appliesTo: 'file',
		formatSettingKey: 'scheduledTaskFormat',
		defaultFormat: 'By {date} (at {time} - {range}), {action} - {amount} - {outcome}',
		templateSettingKey: 'scheduledTaskTemplate',
		requiredPrefix: {
			pattern: /^By\s+\{date\}/,
			message: "the scheduled format must start with 'By {date}' — filename date parsing depends on it",
		},
		// Declared across every entry so the union stays uniform — see the
		// templateSettingKey note above.
		allowsCycle: false,
		menuLabel: 'scheduled 📅',
		menuIcon: 'calendar-glyph',
	},
	{
		emoji: '🔁',
		key: 'routine',
		role: 'open',
		appliesTo: 'file',
		formatSettingKey: 'routineTaskFormat',
		defaultFormat: '{action} - {amount} - {outcome} - {cycle}',
		templateSettingKey: 'routineTaskTemplate',
		allowsCycle: true,
		// Declared across every entry so the union stays uniform — see the
		// templateSettingKey note above.
		requiredPrefix: undefined,
		menuLabel: 'routine 🔁',
		menuIcon: 'repeat',
	},
	{
		emoji: '✅',
		key: 'checked',
		role: 'done',
		appliesTo: 'file',
		formatSettingKey: 'completedTaskFormat',
		defaultFormat: '{action} - {amount} - {outcome}',
		templateSettingKey: 'completedTaskTemplate',
		// Declared across every entry so the union stays uniform — see the
		// templateSettingKey note above.
		requiredPrefix: undefined,
		allowsCycle: false,
		menuLabel: 'completed ✅',
		menuIcon: 'check-circle',
	},
	{
		emoji: '❌',
		key: 'unimportant',
		role: 'dropped',
		appliesTo: 'file',
		formatSettingKey: 'cancelledTaskFormat',
		defaultFormat: '{action} - {amount} - {outcome}',
				// No template of its own; declared so every member of the union has the
		// property and uniform access stays type-safe.
		templateSettingKey: undefined,
		// Declared across every entry so the union stays uniform — see the
		// templateSettingKey note above.
		requiredPrefix: undefined,
		allowsCycle: false,
menuLabel: 'unimportant ❌',
		menuIcon: 'cross',
	},
	{
		emoji: '🚀',
		key: 'project',
		role: 'open',
		appliesTo: 'folder',
		formatSettingKey: 'projectFolderFormat',
		defaultFormat: '{action} - {amount} - {outcome}',
				// No template of its own; declared so every member of the union has the
		// property and uniform access stays type-safe.
		templateSettingKey: undefined,
		// Declared across every entry so the union stays uniform — see the
		// templateSettingKey note above.
		requiredPrefix: undefined,
		allowsCycle: false,
menuLabel: 'project 🚀',
		menuIcon: 'rocket',
	},
	{
		emoji: '🎯',
		key: 'target',
		role: 'open',
		appliesTo: 'folder',
		formatSettingKey: 'targetFolderFormat',
		// The identity-first goal shape. Fresh installs get this; existing vaults
		// keep the legacy three-field form until they opt in (migrateSettings).
		defaultFormat: '{identity} - {action} - {amount} - {outcome}',
				// No template of its own; declared so every member of the union has the
		// property and uniform access stays type-safe.
		templateSettingKey: undefined,
		// Declared across every entry so the union stays uniform — see the
		// templateSettingKey note above.
		requiredPrefix: undefined,
		allowsCycle: false,
menuLabel: 'goal 🎯',
		menuIcon: 'target',
	},
] as const satisfies readonly EmojiSpec[];

/**
 * The registry. Exported at its LITERAL type, so `specByEmoji` and friends return
 * the exact union and the four `as` casts this file used to need are gone.
 *
 * It was briefly annotated `readonly EmojiSpec[]`, which discarded the literal
 * types — every consumer then cast back, and `formatKeyOf` would happily accept a
 * hand-made spec with a settings key that does not exist and return it typed as
 * if it did.
 */
export const EMOJI_REGISTRY = REGISTRY;

/* ── Types DERIVED from the registry — the compiler keeps them in lockstep ──
   Because the registry is `as const`, these unions are the exact literal keys
   the entries name. Adding an entry with a new key widens them automatically;
   a typo'd key in a lookup is a compile error, not a silent string. */

/**
 * A registry entry AT ITS LITERAL TYPE.
 *
 * `EmojiSpec` is the authoring shape (`satisfies` checks entries against it) and
 * widens the keys to `string`; this is what consumers get back, so a settings
 * lookup keeps the exact key union and a foreign spec cannot be smuggled in.
 */
export type RegistrySpec = (typeof REGISTRY)[number];

/** The settings keys that hold filename formats — one per registry entry. */
export type FormatSettingKey = (typeof REGISTRY)[number]['formatSettingKey'];
/** The settings keys that hold template paths — only entries that declare one. */
export type TemplateSettingKey = Extract<
	(typeof REGISTRY)[number],
	{ templateSettingKey: string }
>['templateSettingKey'];

/** The name-format templates, one per registry entry. Shape follows the registry. */
export type TaskFormatSettings = Record<FormatSettingKey, string>;
/** The per-type template paths. Shape follows the registry. */
export type TaskTemplateSettings = Record<TemplateSettingKey, string>;

/** DEFAULT_SETTINGS' format entries, straight from the registry. */
export function defaultFormats(): TaskFormatSettings {
	return Object.fromEntries(
		REGISTRY.map((s) => [s.formatSettingKey, s.defaultFormat]),
	) as TaskFormatSettings;
}

/**
 * DEFAULT_SETTINGS' template entries: empty, so migrateSettings fills them into
 * an existing data.json without a version bump — an existing vault gains a
 * setting, not a behaviour.
 */
export function defaultTemplates(): TaskTemplateSettings {
	const entries: [string, string][] = [];
	for (const spec of EMOJI_REGISTRY) {
		if (spec.templateSettingKey) entries.push([spec.templateSettingKey, '']);
	}
	return Object.fromEntries(entries) as TaskTemplateSettings;
}

/**
 * Marker prefix for ACTIVE items, written before the identifying emoji:
 * `🅰️ 🎯 Goal name`. Tolerated by all parsing, preserved across renames and
 * status changes, and highlighted in the timeline/calendar views.
 */
export const ACTIVE_MARKER = '🅰️';

/** Fallback color for event blocks/chips without an explicit calendar color. */
export const DEFAULT_EVENT_COLOR = '#4c78a8';

/* ── Derived lookups (do not edit — everything below follows the registry) ── */

/**
 * Every registry key → its emoji, typed by the KEYS THAT EXIST.
 *
 * `Record<string, string>` let `BY_KEY['unchekced']` type-check and hand back
 * `undefined` at runtime, typed `string` — and that value feeds `changeStatus`
 * and every emoji comparison. Renaming a registry key is now a compile error at
 * each lookup instead of a silent undefined.
 */
function specsByKey(): Record<RegistrySpec['key'], string> {
	const map = {} as Record<RegistrySpec['key'], string>;
	for (const spec of EMOJI_REGISTRY) map[spec.key] = spec.emoji;
	return map;
}
const BY_KEY = specsByKey();

/** Task-status emoji prefixes (used for note filenames). */
export const TASK_EMOJIS = {
	UNCHECKED: BY_KEY['unchecked'],
	SCHEDULED: BY_KEY['scheduled'],
	CHECKED: BY_KEY['checked'],
	UNIMPORTANT: BY_KEY['unimportant'],
} as const;

const VARIATION_SELECTORS = /[\uFE00-\uFE0F]/g;

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex fragment for one emoji. The variation selector is only made optional for
 * emoji that actually carry one (so `\u25FB\uFE0F` and bare `\u25FB` both match). Adding it
 * everywhere would let the regex accept forms like `\u2705\uFE0F` that extractTaskEmoji
 * does not recognise, breaking the "hasTaskEmoji \u21D2 known emoji" invariant.
 */
function emojiPattern(emoji: string): string {
	const bare = emoji.replace(VARIATION_SELECTORS, '');
	return bare === emoji ? escapeRegex(emoji) : escapeRegex(bare) + '\uFE0F?';
}

const ENTITY_ALTERNATION = EMOJI_REGISTRY.map((s) => emojiPattern(s.emoji)).join('|');
const MARKER_PATTERN = emojiPattern(ACTIVE_MARKER);

/**
 * Matches any recognised emoji prefix — optionally preceded by the active
 * marker — followed by whitespace. Variation selectors are optional so both
 * `◻️ name` and the bare `◻ name` parse.
 */
export const TASK_EMOJI_REGEX = new RegExp(
	`^(?:${MARKER_PATTERN}\\s+)?(?:${ENTITY_ALTERNATION})\\s+`,
	'u',
);

/** Matches (repeated) leading entity emojis for stray-prefix cleanup. */
export const ENTITY_EMOJI_STRIP_REGEX = new RegExp(`^(?:${ENTITY_ALTERNATION})\\s*`, 'u');

/** Look up the registry entry for a (normalized or canonical) emoji. */
export function specByEmoji(emoji: string): RegistrySpec | undefined {
	const bare = emoji.replace(VARIATION_SELECTORS, '');
	return EMOJI_REGISTRY.find((s) => s.emoji.replace(VARIATION_SELECTORS, '') === bare);
}

/** True when the emoji marks a finished state (done or dropped). */
export function isDoneRole(emoji: string): boolean {
	const role = specByEmoji(emoji)?.role;
	return role === 'done' || role === 'dropped';
}

/** The configured name format for an emoji (defaults to the unchecked format). */
export function formatKeyFor(emoji: string): FormatSettingKey {
	return specByEmoji(emoji)?.formatSettingKey ?? 'uncheckedTaskFormat';
}

/** The template setting key for an emoji, if that status has one. */
export function templateKeyFor(emoji: string): TemplateSettingKey | undefined {
	return specByEmoji(emoji)?.templateSettingKey;
}

/**
 * A spec's settings keys, at their derived types.
 *
 * Kept as named functions (rather than reading the property directly at each
 * call site) because they document WHY a settings object may be indexed with
 * them — and because `templateSettingKey` is optional, so the `undefined` is
 * part of the contract.
 */
export function formatKeyOf(spec: RegistrySpec): FormatSettingKey {
	return spec.formatSettingKey;
}

export function templateKeyOf(spec: RegistrySpec): TemplateSettingKey | undefined {
	return spec.templateSettingKey;
}

/** Registry entries applicable to a file or folder (for menu building). */
export function specsFor(kind: 'file' | 'folder'): readonly EmojiSpec[] {
	// done/dropped states apply to both files and folders (matching the old menus).
	return EMOJI_REGISTRY.filter(
		(s) => s.appliesTo === kind || s.role === 'done' || s.role === 'dropped',
	);
}

/** Obsidian view types registered by this plugin. */
export const VIEW_TYPE_TIMELINE = 'task-notes-timeline';
export const VIEW_TYPE_CALENDAR = 'task-notes-calendar';
export const VIEW_TYPE_TASK_PROPERTIES = 'task-notes-properties';

/** Ribbon / view icons (Lucide ids bundled with Obsidian). */
export const ICON_TIMELINE = 'calendar-clock';
export const ICON_TASK_PROPERTIES = 'pencil';

/** The timeline ranges the unified timeline view can display. */
export const TIMELINE_RANGES = ['day', '3days', 'week', 'month', '6months', 'year'] as const;
export type TimelineRange = (typeof TIMELINE_RANGES)[number];

/**
 * The ranges the toolbar shows as buttons. The rest stay fully functional and
 * reachable (the toolbar's overflow menu, commands, the settings default) —
 * this only decides what competes for space in the toolbar.
 */
export const PRIMARY_TIMELINE_RANGES = ['day', '3days', 'week', 'month'] as const;

/**
 * The tail of the same ascending sequence, reachable from the toolbar's menu.
 * `[...PRIMARY, ...SECONDARY]` must equal TIMELINE_RANGES — asserted in tests,
 * so the toolbar can never silently stop reading in order.
 */
export const SECONDARY_TIMELINE_RANGES = ['6months', 'year'] as const;

/** True for the ranges the toolbar shows as their own button. */
export function isPrimaryRange(range: TimelineRange): boolean {
	return (PRIMARY_TIMELINE_RANGES as readonly TimelineRange[]).includes(range);
}

/**
 * True for the ranges drawn as a time grid rather than a calendar.
 *
 * A type predicate, not a boolean: `RANGE_DAY_SPAN` below is keyed on exactly
 * this union, which is why the check had been written out three separate times
 * in Timeline.svelte instead of being called.
 */
export function isGridRange(range: TimelineRange): range is keyof typeof RANGE_DAY_SPAN {
	return range === 'day' || range === '3days' || range === 'week';
}

/**
 * One step out from each range — the ladder the zoom-out command walks. It
 * follows the same ascending order the toolbar shows, so zooming out never skips
 * a rung the user can see. `null` ends it.
 */
export const ZOOM_OUT: Record<TimelineRange, TimelineRange | null> = {
	day: '3days',
	'3days': 'week',
	week: 'month',
	month: '6months',
	'6months': 'year',
	year: null,
};

/** Human labels, shared by the toolbar, the overflow menu and the settings tab. */
export const RANGE_LABELS: Record<TimelineRange, string> = {
	day: 'Day',
	'3days': '3 days',
	week: 'Week',
	month: 'Month',
	'6months': '6 months',
	year: 'Year',
};

/** How many days each time-grid range spans. Month+ ranges use the month grid instead. */
export const RANGE_DAY_SPAN: Record<'day' | '3days' | 'week', number> = {
	day: 1,
	'3days': 3,
	week: 7,
};

/**
 * The one label for "merge the daily template into this note".
 *
 * Offered from the palette, the day menu and the file menu; a constant is what
 * keeps three copies of a sentence from drifting apart.
 */
export const APPLY_TEMPLATE_LABEL = 'Apply daily note template now';

/** Key under which the ICS last-good response cache is persisted in data.json. */
export const ICS_CACHE_DATA_KEY = 'icsCache';

/**
 * Key under which remote occurrences the user has ticked off are persisted in
 * data.json. Local-only: a remote calendar is read-only, so "done" for one of
 * its events can only ever be remembered on this side.
 */
export const HIDDEN_REMOTE_DATA_KEY = 'hiddenRemoteEvents';
