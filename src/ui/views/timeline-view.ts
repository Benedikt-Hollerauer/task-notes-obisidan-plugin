import { ItemView, WorkspaceLeaf, Platform } from 'obsidian';
import { mount, unmount } from 'svelte';
import Timeline from './svelte/Timeline.svelte';
import { VIEW_TYPE_TIMELINE, ICON_TIMELINE, type TimelineRange } from '../../constants';
import { mergeViewState } from './context';
import type { TimelineActions, TimelineViewContext, TimelineViewState } from './context';

import { todayKey } from '../../core/date-key';

/** Facts the views need from services they cannot import Obsidian to reach. */
export interface DaySignals {
	wordCountFor(dateKey: string): Promise<number | null>;
	hasUncheckedTasks(dateKey: string): boolean;
	/** The moment format daily notes are named with, e.g. `YYYY-MM-DD`. */
	dailyNoteFormat(): string;
	/** True when the day's daily note already exists (a path lookup, not a read). */
	hasDailyNote(dateKey: string): boolean;
}

/** The shape Obsidian hands back from the saved layout — every field optional. */
type PersistedState = Partial<TimelineViewState>;

/** The component instance's exported API (Svelte 5 `mount` returns its exports). */
interface TimelineExports {
	applyState(state: TimelineViewState): void;
	today(): void;
	step(dir: 1 | -1): void;
	zoomOut(): void;
	toggleCalendar(): void;
}

export class TimelineView extends ItemView {
	private component: TimelineExports | null = null;
	private state: TimelineViewState;

	constructor(
		leaf: WorkspaceLeaf,
		private actions: TimelineActions,
		private signals: DaySignals,
		defaultRange: TimelineRange,
		/**
		 * One view class, two ids: the main one and the legacy calendar id, so a
		 * workspace saved before the views were merged still restores.
		 */
		private viewType: string = VIEW_TYPE_TIMELINE,
	) {
		super(leaf);
		// The rail stacks ABOVE the grid on a narrow pane and takes 40% of its
		// height, so on a phone the first thing you saw was mostly calendar. A
		// DEFAULT only — the toolbar toggle is unchanged, and a saved workspace
		// keeps whatever you last chose.
		this.state = {
			range: defaultRange,
			anchor: todayKey(),
			calendarOpen: !Platform.isPhone,
			laneHeight: null,
		};
	}

	getViewType(): string {
		return this.viewType;
	}

	getDisplayText(): string {
		// This IS the view's display name, so it is the one string that should be
		// the plugin's name.
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		return 'Task Notes';
	}

	getIcon(): string {
		return ICON_TIMELINE;
	}

	async onOpen(): Promise<void> {
		this.mountComponent();
	}

	async onClose(): Promise<void> {
		this.destroyComponent();
		this.contentEl.removeClass('task-notes-timeline-view');
		this.contentEl.empty();
	}

	getState(): Record<string, unknown> {
		return { ...this.state };
	}

	/** Imperative API used by the navigation commands. */
	exports(): TimelineExports | null {
		return this.component;
	}

	async setState(state: PersistedState, result: unknown): Promise<void> {
		const next = mergeViewState(this.state, state);
		const changed = (Object.keys(next) as (keyof TimelineViewState)[]).some(
			(k) => next[k] !== this.state[k],
		);
		this.state = next;
		// @ts-expect-error base signature
		await super.setState(state, result);
		if (!changed) return;
		// Update in place so scroll position and in-flight drags survive; remounting
		// is only the fallback for a component that isn't mounted yet.
		// Obsidian calls setState AFTER onOpen, so the mounted component started from
		// the defaults; push the restored state into it rather than remounting.
		if (this.component) this.component.applyState(this.state);
		else this.mountComponent();
	}

	private mountComponent(): void {
		this.destroyComponent();
		this.contentEl.empty();
		this.contentEl.addClass('task-notes-timeline-view');
		const ctx: TimelineViewContext = {
			app: this.app,
			initialState: this.state,
			actions: this.actions,
			wordCountFor: (key) => this.signals.wordCountFor(key),
			hasUncheckedTasks: (key) => this.signals.hasUncheckedTasks(key),
			dailyNoteFormat: () => this.signals.dailyNoteFormat(),
			hasDailyNote: (key) => this.signals.hasDailyNote(key),
			persist: (next) => {
				const keys = Object.keys(next) as (keyof TimelineViewState)[];
				if (keys.every((k) => next[k] === this.state[k])) return;
				this.state = { ...next };
				this.app.workspace.requestSaveLayout();
			},
		};
		this.component = mount(Timeline, { target: this.contentEl, props: { ctx } }) as TimelineExports;
	}

	private destroyComponent(): void {
		if (this.component) {
			void unmount(this.component);
			this.component = null;
		}
	}
}
