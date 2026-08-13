import type { App } from 'obsidian';
import type { LineTarget, LocalEvent, RemoteEvent, TaskEvent } from '../../types';
import type { TimelineRange } from '../../constants';

/** One entry of a native menu opened by the view. */
export interface MenuItemSpec {
	label: string;
	checked?: boolean;
	icon?: string;
	onPick: () => void;
}

/** Actions the timeline view can invoke against the plugin's services. */
export interface TimelineActions {
	/** Move/resize a block. `start`/`end` are null for an all-day (untimed) item. */
	applyBlockEdit(event: LocalEvent, date: string, start: number | null, end: number | null): Promise<void>;
	createBlock(date: string, start: number, end: number): Promise<void>;
	/**
	 * Offer to put an unlinked note into its day's plan. Opens a dialog — nothing
	 * is written until it is confirmed — so this returns immediately.
	 */
	linkEvent(event: LocalEvent): void;
	/**
	 * Turn a read-only calendar occurrence into a 📅 note of your own. Opens the
	 * same prefilled dialog the right-click menu opens — nothing is written until
	 * it is confirmed — so this returns immediately, and the remote occurrence is
	 * left on the timeline either way.
	 */
	convertRemote(event: RemoteEvent): void;
	/** Open the event's own note (falls back to its daily-note line). */
	openEvent(event: LocalEvent): void;
	/** Open the daily note scrolled to the event's planner line. */
	openPlacement(event: LocalEvent, newLeaf?: boolean): Promise<void>;
	/**
	 * Hide or show ONE remote occurrence. Stored locally only — the source
	 * calendar is never written to. "Show completed" brings hidden ones back.
	 */
	setRemoteHidden(event: RemoteEvent, hidden: boolean): Promise<void>;
	/**
	 * The toolbar's show/hide-completed switch. Writes the SAME setting the
	 * settings tab writes — two sources of truth for one filter would be a bug.
	 */
	setShowCompleted(next: boolean): Promise<void>;
	/** Say something to the user. The views hold no Obsidian imports of their own. */
	notify(message: string): void;
	/** Open a native menu at the pointer — used for the toolbar's range overflow. */
	showMenu(items: MenuItemSpec[], mouseEvent: MouseEvent): void;
	/** Show the right-click menu for a block/chip. */
	showEventMenu(event: TaskEvent, mouseEvent: MouseEvent): void;
	/** Show the right-click menu for a day cell. */
	showDayMenu(dateKey: string, mouseEvent: MouseEvent): void;
	openDailyNote(dateKey: string, newLeaf?: boolean): Promise<void>;
	/** Tick/untick one line of a daily note; `parent` scopes a body row to its block. */
	setLineChecked(target: LineTarget, next: boolean, parent?: LineTarget): Promise<void>;
	/**
	 * Timeline zoom — how tall an hour is drawn. Writes the SAME setting the
	 * settings slider writes, debounced, because a wheel fires it continuously
	 * and every write serialises the ICS response cache with it.
	 */
	setHourHeight(px: number): Promise<void>;
	/**
	 * Render `text` as Markdown into `el`.
	 *
	 * Goes through the context for the usual reason: the Svelte views hold no
	 * Obsidian imports, and MarkdownRenderer is very much an Obsidian import.
	 * The implementation sets the plain text first and swaps in the rendered
	 * output when it arrives, so a block never flashes empty.
	 */
	renderMarkdown(el: HTMLElement, text: string, sourcePath?: string): void;
}

/** Everything the view remembers in the workspace layout. */
export interface TimelineViewState {
	range: TimelineRange;
	anchor: string;
	calendarOpen: boolean;
	/**
	 * Height in px the all-day lane has been dragged to, or null for automatic
	 * (fit its content, capped against the pane).
	 */
	laneHeight: number | null;
}

/**
 * Merge a persisted (partial) state over the live one.
 *
 * `null` is a VALUE for `laneHeight` — "size yourself to your items" — not an
 * absence. Keying on `typeof === 'number'` meant that once the lane had been
 * dragged to 240 no restore could ever hand it back to automatic.
 */
export function mergeViewState(
	current: TimelineViewState,
	incoming: Partial<TimelineViewState> | null | undefined,
): TimelineViewState {
	const given = (key: keyof TimelineViewState): boolean =>
		!!incoming && Object.prototype.hasOwnProperty.call(incoming, key);
	return {
		range: incoming?.range || current.range,
		// Truthiness, not `??`: a corrupted layout handing back an empty anchor
		// would otherwise blank the view — `keyToMoment('')` is an invalid moment.
		anchor: incoming?.anchor || current.anchor,
		calendarOpen: typeof incoming?.calendarOpen === 'boolean' ? incoming.calendarOpen : current.calendarOpen,
		laneHeight: given('laneHeight')
			? typeof incoming?.laneHeight === 'number'
				? incoming.laneHeight
				: null
			: current.laneHeight,
	};
}

export interface TimelineViewContext {
	app: App;
	/** Word count of a day's daily note, or null if it doesn't exist. */
	wordCountFor(dateKey: string): Promise<number | null>;
	/** True if the day's daily note has unchecked tasks. */
	hasUncheckedTasks(dateKey: string): boolean;
	/** The moment format daily notes are named with, for the day headers. */
	dailyNoteFormat(): string;
	/** True when the day's daily note already exists — so a control can say which. */
	hasDailyNote(dateKey: string): boolean;
	initialState: TimelineViewState;
	actions: TimelineActions;
	/** Persist the view's own state into the workspace layout. */
	persist(state: TimelineViewState): void;
}

