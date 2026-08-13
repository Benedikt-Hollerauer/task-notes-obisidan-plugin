// Pure domain types shared across layers (no Obsidian imports).

import type { BodyRow, LineTree } from './core/line-tree';

/** Parsed properties of a task/event name. */
export interface TaskProperties {
	actionWords: string;
	amount: string;
	amountOutcome: string;
	// Optional named fields, declared per-format (see core/format-fields.ts).
	identity?: string;  // goals/areas/resources: who you are when doing this
	name?: string;      // areas/resources: the subject itself
	cycle?: string;     // routines: the repetition/condition
	// Optional date/time fields (events only).
	startDate?: string; // YYYY-MM-DD
	endDate?: string;   // YYYY-MM-DD (multi-day range end)
	time?: string;      // HH.MMh
}

/**
 * The name-format templates, one per registry entry. The SHAPE is derived from
 * EMOJI_REGISTRY in constants.ts — re-exported here so the many importers of
 * this module keep their import path. Adding a registry entry adds its key.
 */
export type { TaskFormatSettings } from './constants';

/** A parsed Day-Planner-style planner line inside a daily note. */
export interface PlannerLine {
	/** 0-based line index within the note. */
	lineNo: number;
	/** The full, original line text (used for minimal-diff rewriting). */
	raw: string;
	/** Leading indentation (spaces/tabs). */
	indent: string;
	/** List marker character: `-`, `*`, or `+`. */
	marker: string;
	/** Checkbox status char between the brackets, e.g. ' ' or 'x'. */
	status: string;
	/**
	 * Whether the line actually HAS a checkbox. A plain `- 16:00 Reviewed the deck`
	 * must stay checkbox-free when the plugin rewrites it — adding `[ ]` would be a
	 * change to the user's note that they never asked for.
	 */
	hasCheckbox: boolean;
	/** Start time in minutes since midnight, or null if the line has no time. */
	startMinutes: number | null;
	/** End time in minutes since midnight, or null. */
	endMinutes: number | null;
	/** Everything after the (optional) time range. */
	text: string;
	/** Wikilink target (path text) if the text is a single wikilink, else null. */
	linkTarget: string | null;
	/** Wikilink alias if present. */
	linkAlias: string | null;
}

/** The minimum needed to address ONE line of ONE daily note for a write. */
export interface LineTarget {
	dailyNotePath: string;
	lineNo: number;
	/** The line's exact text, which is how it is re-found before writing. */
	raw: string;
}

/** Where a local event is scheduled inside a daily note. */
export interface EventPlacement extends LineTarget {
	date: string; // YYYY-MM-DD of the owning daily note
	status: string;
	checked: boolean;
}

/** A schedulable item shown on the timeline/calendar. */
export type TaskEvent = LocalEvent | RemoteEvent;

export interface LocalEvent {
	kind: 'local';
	/** Stable id: 📅 file path, or `${dailyPath}::${lineNo}` for plain-text blocks. */
	id: string;
	/** Path of the backing 📅 note (absent for plain-text blocks). */
	filePath?: string;
	title: string;
	/** YYYY-MM-DD the block is drawn on. */
	date: string;
	/** Start minutes since midnight, or null for all-day / untimed. */
	startMinutes: number | null;
	/** End minutes since midnight (from the planner line, or default duration). */
	endMinutes: number | null;
	/** Multi-day range end date from the filename (YYYY-MM-DD), if any. */
	endDate?: string;
	/** Checked/done state (from the planner line status). */
	checked: boolean;
	/** True when linked in a daily note; false = "not in day plan". */
	linked: boolean;
	/**
	 * False when the event comes from a timed line OUTSIDE the planner section
	 * (`## Log`, `## Meetings`, …). Such a line may be dragged, but it must never
	 * cause the plugin to rename a file: only the day plan has that authority.
	 */
	inDayPlan?: boolean;
	/** Placement inside a daily note, when linked. */
	placement?: EventPlacement;
	/** True when more than one placement claims this file (needs user attention). */
	duplicate?: boolean;
	/**
	 * The lines indented under this event's line — its body. Absent when nothing
	 * is nested under it. `BodyRow.line` is shared with the day's plan, not copied.
	 */
	body?: BodyRow[];
	/** How many body rows with a checkbox are ticked. Absent when none have one. */
	bodyProgress?: { done: number; total: number };
}

export interface RemoteEvent {
	kind: 'remote';
	id: string;
	calendarId: string;
	calendarName: string;
	title: string;
	/** Epoch millis. */
	startTs: number;
	endTs: number;
	allDay: boolean;
	color: string;
}

/** A day's parsed lines. */
export interface DayPlan {
	date: string;
	path: string;
	/** Lines inside the planner section. Only these may drive automatic renames. */
	lines: PlannerLine[];
	/**
	 * Timed list lines found ELSEWHERE in the note (`## Log`, `## Meetings`, …).
	 * They render on the timeline and can be dragged, but never claim a file, so
	 * they can't widen automatic renames or fake a duplicate.
	 */
	extraLines: PlannerLine[];
	/** Which lines are nested under which (see core/line-tree.ts). */
	tree: LineTree;
}

/** What happened the last time a remote calendar was refreshed. */
export interface IcsStatus {
	state: 'ok' | 'cached' | 'error';
	/** Events currently contributed by this calendar. */
	count: number;
	/** Epoch ms of the last attempt. */
	at: number;
	/** Human-readable reason, when something went wrong. */
	error?: string;
}
