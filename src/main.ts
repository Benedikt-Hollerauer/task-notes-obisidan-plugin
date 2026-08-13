import {
	Plugin,
	TFile,
	WorkspaceLeaf,
	Notice,
	Menu,
	MarkdownRenderer,
	Component,
	debounce,
} from 'obsidian';
import { get } from 'svelte/store';
import {
	VIEW_TYPE_TIMELINE,
	VIEW_TYPE_CALENDAR,
	VIEW_TYPE_TASK_PROPERTIES,
	ICON_TIMELINE,
	APPLY_TEMPLATE_LABEL,
	ICS_CACHE_DATA_KEY,
	HIDDEN_REMOTE_DATA_KEY,
	TASK_EMOJIS,
	EMOJI_REGISTRY,
	type TimelineRange,
} from './constants';
import { DEFAULT_SETTINGS, migrateSettings, type TaskNotesSettings } from './settings/settings';
import { TaskNotesSettingTab, type SettingsHost } from './settings/settings-tab';
import {
	settingsStore,
	focusedDayStore,
	nowStore,
	localEventsStore,
	hiddenRemoteStore,
	focusDay,
} from './state/stores';
import {
	normalizeHidden,
	flattenHidden,
	toggleHidden,
	pruneHidden,
	type HiddenRemoteMap,
} from './core/remote-hidden';

import { DailyNoteService, type TemplateMergeOutcome } from './services/daily-note-service';
import { TaskFileService } from './services/task-file-service';
import { ChecklistGuard } from './services/checklist-guard';
import { EventIndex } from './services/event-index';
import { SyncEngine } from './services/sync-engine';
import { IcsService } from './services/ics-service';
import { NotificationService } from './services/notification-service';

import { ExplorerDecorator } from './ui/explorer/explorer-decorator';
import { TaskMenus } from './ui/menus';
import { TimelineView } from './ui/views/timeline-view';
import { TaskPropertiesView, revealTaskProperties } from './ui/views/task-properties-view';
import { TextPromptModal, ConfirmModal } from './ui/modals/simple-modals';
import { TaskPropertiesModal } from './ui/modals/task-properties-modal';
import { TaskPropertiesForm } from './ui/modals/task-properties-form';
import { BLOCK_KIND_LINE, blockKindFor, blockKindOptions } from './core/block-kind';
import { remotePrefill } from './core/remote-prefill';
import { inlineSegments } from './core/inline-markdown';
import { needsMarkdownRender } from './core/markdown-significance';
import { linkPrefill } from './core/link-prefill';
import { getTaskFormatByEmoji, parseTaskProperties } from './core/task-name';
import { extractTaskName } from './core/emoji';
import { resolveSlot } from './core/event-slot';
import { WikilinkSuggest } from './ui/modals/file-suggest';
import { ScheduleTodayModal } from './ui/modals/schedule-today-modal';
import type { TimelineActions } from './ui/views/context';
import type { LocalEvent, RemoteEvent, TaskEvent, TaskProperties } from './types';

import { todayKey } from './core/date-key';
import { insertTimedLine } from './core/planner-section';
import { serializePlannerLine } from './core/planner-line';
import { dotToMinutes, minutesToColon, minutesToDot } from './core/timestamps';
import { findPlacementLine } from './core/placement';
import { hasUncheckedItem } from './core/checklist';
import { HOUR_HEIGHT_MIN, HOUR_HEIGHT_MAX } from './core/zoom';
import { dayMenuItems, type DayMenuAction } from './core/day-menu';
import { notifyError, showMenuSafely, errorMessage, structuredNotice } from './lib/obsidian-utils';
import { createSerialQueue } from './core/serial-queue';
import { normalizeIcsCache } from './core/ics-diagnosis';
import { mountManagedRender } from './ui/managed-render';

export default class TaskNotesPlugin extends Plugin implements SettingsHost {
	settings: TaskNotesSettings = DEFAULT_SETTINGS;
	private icsCache: Record<string, string> = {};
	private hiddenRemote: HiddenRemoteMap = {};
	private lastTemplateCheckDay = '';
	// `resetTimer: true` on every one of these: without it Obsidian's debounce is
	// first-call-wins, which turns "coalesce a burst of keystrokes into one run"
	// into "run on the first keystroke and ignore the rest of the burst".
	private reindexSoon = debounce(
		() => void this.eventIndex.reindexAll().catch((e) => notifyError('Failed to rebuild the event index', e)),
		600,
		true,
	);
	private reconfigureIcsSoon = debounce(() => this.icsService.reconfigure(this), 800, true);
	private recolorIcsSoon = debounce(() => this.icsService.recolor(), 120, true);
	/**
	 * Write settings to disk shortly after they change, for anything a CONTINUOUS
	 * gesture drives. serialize() embeds the ICS response cache, which can be
	 * megabytes, and the zoom wheel fires dozens of times a second.
	 */
	private saveSettingsSoon = debounce(() => void this.persist(), 400, true);
	/** Keep data.json writes in invocation order so an older cache write cannot win. */
	private persistQueued = createSerialQueue();
	private templateWarned = false;

	private dailyNotes!: DailyNoteService;
	private taskFiles!: TaskFileService;
	private eventIndex!: EventIndex;
	private syncEngine!: SyncEngine;
	private icsService!: IcsService;
	private notifications!: NotificationService;
	private menus!: TaskMenus;
	private explorer!: ExplorerDecorator;

	async onload(): Promise<void> {
		await this.loadSettings();

		// ── services ────────────────────────────────────────────────────
		this.dailyNotes = new DailyNoteService(
			this.app,
			() => this.settings.plannerHeading,
			() => this.settings.strictDailyNoteFolder,
		);
		this.taskFiles = new TaskFileService(this.app, () => this.settings);
		this.eventIndex = new EventIndex(
			this.app,
			this.dailyNotes,
			() => this.settings,
			(paths) =>
				paths.forEach((p) =>
					void this.syncEngine
						.reconcile(p)
						.catch((e) => notifyError(`Failed to sync events from ${p}`, e)),
				),
		);
		this.syncEngine = new SyncEngine(this.app, this.eventIndex, this.dailyNotes, () => this.settings);
		this.icsService = new IcsService(
			this.app,
			() => this.settings,
			this.icsCache,
			(cache) => {
				this.icsCache = cache;
				void this.persist();
			},
		);
		this.notifications = new NotificationService(
			() => this.settings,
			// A remote event has no note to open; only local ones are clickable.
			(event) => {
				if (event.kind === 'local') this.openEvent(event);
			},
		);
		this.menus = new TaskMenus(
			this.app,
			this.taskFiles,
			this.syncEngine,
			() => this.settings,
			(item) => item instanceof TFile && this.dailyNotes.isDailyNote(item),
		);
		this.explorer = new ExplorerDecorator(this.app, (item, e) => this.menus.showContextMenu(item, e));
		const checklistGuard = new ChecklistGuard(this.app, this.taskFiles, () => this.settings);

		// ── settings tab ────────────────────────────────────────────────
		this.addSettingTab(new TaskNotesSettingTab(this.app, this));

		// ── registrations ───────────────────────────────────────────────
		// NOTE: the index/sync/guard listeners are registered in onLayoutReady
		// below, not here: Obsidian replays a `create` event for every existing
		// file at startup, which would otherwise look like a vault-wide edit.
		this.icsService.register(this);
		this.notifications.register(this);
		this.explorer.register(this);

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				this.menus.addFileMenu(menu, file);
				// The same action the day menu and the palette offer, where you are
				// most likely to want it: on the daily note itself.
				if (file instanceof TFile && this.dailyNotes.isDailyNote(file)) {
					menu.addItem((mi) =>
						mi
							.setTitle(APPLY_TEMPLATE_LABEL)
							.setIcon('copy')
							.onClick(() => void this.applyTemplateNow(file)),
					);
				}
			}),
		);
		this.registerEvent(this.app.workspace.on('file-open', (file) => this.onFileOpen(file)));

		this.registerViews();
		this.registerCommands();
		// One ribbon icon: the calendar opens from inside the timeline (and its command).
		this.addRibbonIcon(ICON_TIMELINE, 'Open timeline', () => void this.activateTimeline());

		// current-time tick for the needle / today highlight
		this.registerInterval(window.setInterval(() => nowStore.set(Date.now()), 30_000));
		// daily-template merge on day rollover
		this.lastTemplateCheckDay = todayKey();
		this.registerInterval(
			window.setInterval(
				() => void this.checkDayRollover().catch((e) => notifyError('Failed to check the daily template', e)),
				60_000,
			),
		);

		this.app.workspace.onLayoutReady(() => {
			this.eventIndex.register(this);
			this.syncEngine.register(this);
			checklistGuard.register(this);
			if (this.settings.showExplorerCheckboxes) this.explorer.start();
			checklistGuard.seed();
			void this.eventIndex.initialScan().catch((e) => notifyError('Failed to build the event index', e));
			void this.icsService.refreshAll().catch((e) => notifyError('Failed to refresh remote calendars', e));
			void this.checkTodaysTemplate().catch((e) => notifyError('Failed to check today’s template', e));
		});
	}

	onunload(): void {
		this.reindexSoon.cancel();
		this.reconfigureIcsSoon.cancel();
		this.recolorIcsSoon.cancel();
		// Flushed, not cancelled: a pending zoom change is the user's, and dropping
		// it would silently discard a setting they just made.
		this.saveSettingsSoon.run();
		this.eventIndex?.dispose();
		this.syncEngine?.dispose();
		this.icsService?.dispose();
		this.explorer?.stop();
	}

	// ── settings host ───────────────────────────────────────────────────
	private serialize(): Record<string, unknown> {
		return {
			...this.settings,
			// Settings rows mutate calendar objects in place. Copy the mutable leaves
			// so a queued snapshot cannot change underneath an in-flight saveData call.
			icsCalendars: this.settings.icsCalendars.map((calendar) => ({ ...calendar })),
			[ICS_CACHE_DATA_KEY]: { ...this.icsCache },
			[HIDDEN_REMOTE_DATA_KEY]: Object.fromEntries(
				Object.entries(this.hiddenRemote).map(([calendarId, ids]) => [calendarId, [...ids]]),
			),
		};
	}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Record<string, unknown> | null;
		this.icsCache = normalizeIcsCache(raw?.[ICS_CACHE_DATA_KEY]);
		const hidden = normalizeHidden(raw?.[HIDDEN_REMOTE_DATA_KEY]);
		const clean = raw ? { ...raw } : {};
		// Both blobs are stripped BEFORE migrateSettings: it merges unknown keys
		// straight onto the settings object, which would leave two diverging copies.
		delete (clean as Record<string, unknown>)[ICS_CACHE_DATA_KEY];
		delete (clean as Record<string, unknown>)[HIDDEN_REMOTE_DATA_KEY];
		// A vault with no persisted data at all AND no legacy keys is genuinely new.
		const isFreshVault = raw === null;
		this.settings = migrateSettings(clean, isFreshVault);
		settingsStore.set(this.settings);

		// Forget marks that can never match an event again. Load time only — doing
		// this on every ICS refresh would rewrite data.json on a timer.
		const pruned = pruneHidden(hidden, new Set(this.settings.icsCalendars.map((c) => c.id)), Date.now());
		this.hiddenRemote = pruned.map;
		hiddenRemoteStore.set(flattenHidden(this.hiddenRemote));
		if (pruned.changed) await this.persist();
	}

	async saveSettings(): Promise<void> {
		// Publish before writing: serialize() embeds the ICS response cache, which
		// can be megabytes, and no view should wait on disk to re-render.
		settingsStore.set({ ...this.settings });
		await this.persist();
	}

	/**
	 * Write everything persisted to data.json. Callers that must publish to a
	 * store first still do so themselves — that ordering is load-bearing; this is
	 * only the write, with one error policy instead of four.
	 */
	private async persist(): Promise<void> {
		const snapshot = this.serialize();
		await this.persistQueued(async () => {
			try {
				await this.saveData(snapshot);
			} catch (e) {
				notifyError('Failed to save Task Notes data', e);
			}
		});
	}

	getTemplateFiles(): TFile[] {
		return this.taskFiles.getTemplateFiles();
	}

	/**
	 * Tick a remote occurrence off — locally. The source calendar is never
	 * written to; the mark lives in this plugin's own data file.
	 */
	private async hideRemoteEvent(event: RemoteEvent, hidden: boolean): Promise<void> {
		const next = toggleHidden(this.hiddenRemote, event.calendarId, event.id, hidden);
		if (!next.changed) return;
		this.hiddenRemote = next.map;
		// Publish first: the tick should land instantly, not after a disk write that
		// also serialises the ICS response cache.
		hiddenRemoteStore.set(flattenHidden(this.hiddenRemote));
		await this.persist();
	}

	/**
	 * Re-read the notes when a setting the INDEX depends on changes — the timeline
	 * heading, which lines count as blocks, how long an event is by default.
	 * Debounced, because the heading field fires per keystroke.
	 */
	onIndexSettingsChanged(): void {
		this.reindexSoon();
	}

	/**
	 * The file-explorer decoration was switched. `stop()` removes every checkbox
	 * it added, so turning it off leaves Obsidian's explorer exactly as it found
	 * it — no reload needed.
	 */
	onExplorerSettingChanged(): void {
		if (this.settings.showExplorerCheckboxes) this.explorer.start();
		else this.explorer.stop();
	}

	onIcsSettingsChanged(): void {
		this.reconfigureIcsSoon();
	}

	/**
	 * A calendar's COLOUR changed. Re-draw only — the events are already in hand,
	 * and a colour picker drag must never turn into a fetch storm against
	 * somebody's calendar server.
	 */
	onIcsColorsChanged(): void {
		this.recolorIcsSoon();
	}

	// ── views ───────────────────────────────────────────────────────────
	private registerViews(): void {
		this.registerView(
			VIEW_TYPE_TASK_PROPERTIES,
			(leaf: WorkspaceLeaf) => new TaskPropertiesView(leaf, this.taskFiles, this.menus, () => this.settings),
		);
		const actions = this.buildTimelineActions();
		// ONE view, openable as a tab or in a sidebar. The legacy calendar id is
		// still registered so a workspace saved before the merge restores cleanly.
		for (const type of [VIEW_TYPE_TIMELINE, VIEW_TYPE_CALENDAR]) {
			this.registerView(
				type,
				(leaf: WorkspaceLeaf) =>
					new TimelineView(
						leaf,
						actions,
						{
							wordCountFor: (key) => this.wordCountFor(key),
							hasUncheckedTasks: (key) => this.hasUncheckedTasks(key),
							dailyNoteFormat: () => this.dailyNotes.format(),
							hasDailyNote: (key) => this.dailyNotes.getExisting(key) != null,
						},
						this.settings.timelineDefaultRange,
						type,
					),
			);
		}
	}

	private buildTimelineActions(): TimelineActions {
		// Every async action is guarded: a rejected write must surface as a notice,
		// never as an unhandled rejection from an un-awaited call in a component.
		const guard =
			<A extends unknown[]>(fn: (...args: A) => Promise<void>, message: string) =>
			(...args: A): Promise<void> =>
				fn(...args).catch((e) => notifyError(message, e));

		return {
			applyBlockEdit: guard(
				(event: LocalEvent, date: string, start: number | null, end: number | null) =>
					this.syncEngine.applyBlockEdit(event, date, start, end),
				'Failed to reschedule',
			),
			createBlock: guard(
				(date: string, start: number, end: number) => this.createBlock(date, start, end),
				'Failed to create time block',
			),
			linkEvent: (event: LocalEvent) => this.promptAddToPlan(event),
			openEvent: (event) => this.openEvent(event),
			openPlacement: guard(
				(event: LocalEvent, newLeaf?: boolean) => this.openPlacement(event, newLeaf ?? false),
				'Failed to open the daily note',
			),
			setRemoteHidden: guard(
				(event, hidden) => this.hideRemoteEvent(event, hidden),
				'Failed to update the calendar filter',
			),
			setShowCompleted: guard(async (next: boolean) => {
				if (this.settings.showCheckedBlocks === next) return;
				this.settings.showCheckedBlocks = next;
				await this.saveSettings();
			}, 'Failed to change the completed filter'),
			setHourHeight: guard(async (px: number) => {
				const next = Math.min(Math.max(Math.round(px), HOUR_HEIGHT_MIN), HOUR_HEIGHT_MAX);
				if (this.settings.hourHeightPx === next) return;
				this.settings.hourHeightPx = next;
				// Publish now so the grid rescales under the pointer; write later,
				// because a zoom wheel fires continuously. See saveSettingsSoon.
				settingsStore.set({ ...this.settings });
				this.saveSettingsSoon();
			}, 'Failed to change the zoom level'),
			renderMarkdown: (el, text, sourcePath) => this.renderMarkdownInto(el, text, sourcePath ?? ''),
			notify: (message) => new Notice(message),
			showMenu: (items, mouseEvent) => {
				const menu = new Menu();
				for (const item of items) {
					menu.addItem((mi) => {
						mi.setTitle(item.label).onClick(item.onPick);
						mi.setChecked(!!item.checked);
						if (item.icon) mi.setIcon(item.icon);
					});
				}
				showMenuSafely(menu, mouseEvent);
			},
			convertRemote: (event) => this.convertRemoteEvent(event),
			showEventMenu: (event, mouseEvent) => this.showEventMenu(event, mouseEvent),
			showDayMenu: (dateKey, mouseEvent) => this.showDayMenu(dateKey, mouseEvent),
			openDailyNote: guard(
				(dateKey: string, newLeaf?: boolean) => this.openOrCreateDaily(dateKey, newLeaf ?? false),
				'Failed to open the daily note',
			),
			setLineChecked: guard(
				(target, next, parent?) => this.syncEngine.setLineChecked(target, next, parent),
				'Failed to update the checkbox',
			),
		};
	}

	/**
	 * Everything you can do with one day's note.
	 *
	 * Reached two ways: left-clicking the day's note button in the timeline
	 * header, and right-clicking the day cell. Both call this, so neither route
	 * can offer a different set — which is why the item list itself lives in
	 * core/day-menu.ts, where a test can read it.
	 */
	private showDayMenu(dateKey: string, mouseEvent: MouseEvent): void {
		const menu = new Menu();
		const existing = this.dailyNotes.getExisting(dateKey);
		// No "Zoom to this day": a plain click on a day already does exactly that,
		// in the header, the month grid, the rail and the overviews alike. A menu
		// entry for the gesture you just used to open the menu is noise.
		for (const item of dayMenuItems(!!existing)) {
			if (item.separatorBefore) menu.addSeparator();
			menu.addItem((mi) =>
				mi
					.setTitle(item.label)
					.setIcon(item.icon)
					.onClick(() => this.runDayMenuAction(item.action, dateKey, existing)),
			);
		}
		// showMenuSafely already reports its own failure; a second try/catch here
		// was catching nothing.
		showMenuSafely(menu, mouseEvent);
	}

	private runDayMenuAction(action: DayMenuAction, dateKey: string, existing: TFile | null): void {
		switch (action) {
			case 'open':
				void this.openOrCreateDaily(dateKey, false);
				return;
			case 'open-new-tab':
				void this.openOrCreateDaily(dateKey, true);
				return;
			case 'apply-template':
				// dayMenuItems only offers this when the note exists; the guard is for
				// the compiler, not for a case that can happen.
				if (existing) void this.applyTemplateNow(existing);
				return;
		}
	}

	/**
	 * Ask before putting an unlinked note into a day's plan.
	 *
	 * It used to write on the click: a planner line, a daily note (bypassing the
	 * confirm setting every other creation honours), an invented 08:00 when the
	 * name carried no time, and then a RENAME of the note to match that invented
	 * time — which rewrites every wikilink to it in the vault. Four writes, none
	 * announced. Now everything it is about to do is on screen first, and Cancel
	 * writes nothing at all.
	 */
	private promptAddToPlan(event: LocalEvent): void {
		if (!event.filePath || event.date == null) return;
		const file = this.app.vault.getFileByPath(event.filePath);
		if (!file) return;

		const emoji = TASK_EMOJIS.SCHEDULED;
		const format = getTaskFormatByEmoji(emoji, this.settings);
		const parsed = parseTaskProperties(extractTaskName(file.basename), true, format);
		const seed = linkPrefill(event, parsed, {
			dayStartHour: this.settings.dayStartHour,
			defaultEventDurationMinutes: this.settings.defaultEventDurationMinutes,
		});

		const modal = new TaskPropertiesModal(
			this.app,
			emoji,
			file.basename,
			this.settings,
			(props) => void this.addToPlan(file, props, modal.chosenDuration),
			seed.props,
			{ durationMinutes: seed.durationMinutes, timeWasMissing: seed.timeWasMissing },
		);
		modal.open();
	}

	private async addToPlan(file: TFile, props: TaskProperties, durationMinutes: number): Promise<void> {
		if (!props.startDate) return;
		const start = props.time ? (dotToMinutes(props.time) ?? 0) : this.settings.dayStartHour * 60;
		const end = start + durationMinutes;
		// Rename FIRST, so the line that follows links the name the note will
		// actually have. The user just confirmed both in one dialog.
		const renamed = await this.taskFiles.convert(file, TASK_EMOJIS.SCHEDULED, props);
		if (!renamed) return;
		await this.syncEngine.linkFileIntoDay(file.path, props.startDate, start, end);
	}

	/**
	 * Render Markdown into a timeline element.
	 *
	 * Rendered OFF-SCREEN and swapped in, with the plain text shown meanwhile:
	 * MarkdownRenderer is async, and rendering straight into the element would
	 * leave every block blank until it resolved — on a grid that redraws on every
	 * zoom notch and clock tick, that flicker is the whole experience.
	 *
	 * Re-render churn is handled by Svelte attachments: they restart only when a
	 * dependency changes or their keyed element is replaced, and run the cleanup
	 * returned here before doing so.
	 */
	private renderMarkdownInto(el: HTMLElement, text: string, sourcePath: string): () => void {
		return mountManagedRender(
			el,
			() => {
				// SYNCHRONOUS first pass, always. Obsidian's renderer is async and
				// may fail; the title must stay readable while it works.
				el.empty();
				for (const seg of inlineSegments(text)) {
					let node: HTMLElement = el;
					for (const mark of [...seg.marks].reverse()) node = node.createEl(mark);
					node.appendText(seg.text);
				}
			},
			needsMarkdownRender(text)
				? () => {
						const holder = createDiv();
						// The owner lives exactly as long as the mounted output: unloading it
						// immediately breaks renderer-managed links and embeds.
						const owner = new Component();
						owner.load();
						let completion: Promise<void>;
						try {
							completion = MarkdownRenderer.render(this.app, text, holder, sourcePath, owner);
						} catch (error) {
							owner.unload();
							throw error;
						}
						return {
							holder,
							completion,
							dispose: () => owner.unload(),
						};
					}
				: null,
			(error) => console.error('Task Notes: failed to render markdown', error),
		);
	}

	/**
	 * Turn a read-only calendar occurrence into a 📅 note of your own.
	 *
	 * Opens the ordinary create dialog rather than writing immediately: the
	 * filename grammar needs action/amount/outcome, and a calendar title like
	 * "Design review" does not split into those. Nothing touches the vault until
	 * Create is pressed.
	 */
	private convertRemoteEvent(event: RemoteEvent): void {
		new TaskPropertiesModal(
			this.app,
			TASK_EMOJIS.SCHEDULED,
			event.title,
			this.settings,
			(props) => void this.createFromRemote(props),
			remotePrefill(event),
		).open();
	}

	/**
	 * The calendar event STAYS. Both it and the new note show, side by side —
	 * `overlapLayout` already lays two events in one slot as two half-width
	 * blocks, so nothing is hidden behind anything.
	 *
	 * This used to offer "hide the calendar copy?" straight afterwards, with the
	 * hide as the dialog's primary button. That was the only way a calendar event
	 * could vanish (there is no dedup anywhere), and it read like a tidy-up rather
	 * than a choice. Hiding one occurrence is still a tick away on its checkbox,
	 * where it is visible and reversible.
	 */
	private async createFromRemote(props: TaskProperties): Promise<void> {
		await this.taskFiles.createTaskNote(TASK_EMOJIS.SCHEDULED, props);
	}

	/**
	 * Build the right-click menu for a timeline/calendar block.
	 *
	 * The BUILD is what is wrapped, not the show. `showMenuSafely` has caught its
	 * own throw since v3.3, so the try that used to sit around it caught nothing;
	 * meanwhile the three calls that can genuinely fail — a store read, a vault
	 * lookup, and the delegated item construction in `menus.populate` — all sat
	 * outside it. A throw there escapes into a DOM event handler, where it is
	 * invisible: you right-click and simply nothing happens.
	 */
	private showEventMenu(event: TaskEvent, mouseEvent: MouseEvent): void {
		try {
			const menu = this.buildEventMenu(event);
			showMenuSafely(menu, mouseEvent);
		} catch (err) {
			notifyError('Failed to open the menu for this block', err);
		}
	}

	/** The items themselves. Separated so the try above covers building them. */
	private buildEventMenu(event: TaskEvent): Menu {
		if (event.kind === 'remote') {
			// Read-only in the calendar it came from, but hideable here — and this is
			// the keyboard-reachable half of the checkbox.
			const hidden = get(hiddenRemoteStore).has(event.id);
			const menu = new Menu();
			menu.addItem((mi) =>
				mi
					.setTitle(hidden ? 'Show this occurrence' : 'Hide this occurrence')
					.setIcon(hidden ? 'eye' : 'eye-off')
					.onClick(() => void this.hideRemoteEvent(event, !hidden)),
			);
			menu.addItem((mi) =>
				mi
					.setTitle('Create a task note from this event')
					.setIcon('plus-circle')
					.onClick(() => this.convertRemoteEvent(event)),
			);
			menu.addItem((mi) =>
				mi
					.setTitle('Refresh remote calendars')
					.setIcon('refresh-cw')
					.onClick(
						() =>
							void this.icsService
								.refreshAll()
								.catch((e) => notifyError('Failed to refresh remote calendars', e)),
					),
			);
			return menu;
		}
		const menu = new Menu();

		if (event.placement) {
			menu.addItem((mi) =>
				mi
					.setTitle('Open in daily note')
					.setIcon('calendar-days')
					.onClick(() => void this.openPlacement(event, false)),
			);
		}
		if (event.filePath) {
			menu.addItem((mi) =>
				mi
					.setTitle('Open event note')
					.setIcon('file-text')
					.onClick(() => this.openEvent(event)),
			);
		}
		if (event.filePath && !event.linked) {
			menu.addItem((mi) =>
				mi
					.setTitle('Link into day plan')
					.setIcon('link')
					// Same dialog as the block's own + button: one route, one prompt.
					.onClick(() => this.promptAddToPlan(event)),
			);
		}

		const file = event.filePath ? this.app.vault.getFileByPath(event.filePath) : null;
		if (file) {
			menu.addSeparator();
			this.menus.populate(menu, file);
		}

		return menu;
	}

	/** Open the daily note with the cursor on the event's planner line. */
	private async openPlacement(event: LocalEvent, newLeaf: boolean): Promise<void> {
		const placement = event.placement;
		if (!placement) {
			this.openEvent(event);
			return;
		}
		const file = this.app.vault.getFileByPath(placement.dailyNotePath);
		if (!file) return;
		let line = placement.lineNo;
		try {
			const content = await this.app.vault.cachedRead(file);
			// Re-resolve by raw text: the index can lag the file by a flush cycle.
			const found = findPlacementLine(content, placement);
			if (found >= 0) line = found;
		} catch {
			/* fall back to the recorded line */
		}
		await this.openInLeaf(file, newLeaf, { line, ch: 0 });
	}

	private async openInLeaf(file: TFile, newLeaf: boolean, eState?: Record<string, unknown>): Promise<void> {
		try {
			// Opening a note must never replace the view the click came from: when the
			// timeline is the active leaf, open in a tab beside it instead.
			const inTimeline = this.app.workspace.getActiveViewOfType(TimelineView) != null;
			const leaf = this.app.workspace.getLeaf(newLeaf || inTimeline ? 'tab' : false);
			await leaf.openFile(file, eState ? { eState } : undefined);
		} catch (err) {
			notifyError('Failed to open file', err);
		}
	}


	private async wordCountFor(dateKey: string): Promise<number | null> {
		const file = this.dailyNotes.getExisting(dateKey);
		if (!file) return null;
		const content = await this.app.vault.cachedRead(file);
		return content.trim() ? content.trim().split(/\s+/).length : 0;
	}

	private hasUncheckedTasks(dateKey: string): boolean {
		const file = this.dailyNotes.getExisting(dateKey);
		if (!file) return false;
		const cache = this.app.metadataCache.getFileCache(file);
		return hasUncheckedItem(cache?.listItems);
	}

	// ── commands ────────────────────────────────────────────────────────
	private registerCommands(): void {
		this.addCommand({ id: 'open-timeline', name: 'Open timeline', callback: () => void this.activateTimeline() });
		this.addCommand({ id: 'open-timeline-day', name: 'Open timeline: day', callback: () => void this.activateTimeline('day') });
		this.addCommand({ id: 'open-timeline-week', name: 'Open timeline: week', callback: () => void this.activateTimeline('week') });
		this.addCommand({ id: 'open-timeline-month', name: 'Open timeline: month', callback: () => void this.activateTimeline('month') });
		this.addCommand({
			id: 'open-calendar',
			name: 'Open calendar in the sidebar',
			callback: () => void this.activateCalendar(),
		});
		this.addCommand({
			id: 'open-task-properties',
			name: 'Open task properties',
			callback: () => void revealTaskProperties(this.app),
		});
		this.addCommand({
			id: 'apply-daily-template',
			name: APPLY_TEMPLATE_LABEL,
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const isDaily = file != null && this.dailyNotes.isDailyNote(file);
				if (checking) return isDaily;
				if (file) void this.applyTemplateNow(file);
				return true;
			},
		});
		this.addCommand({ id: 'open-timeline-3days', name: 'Open timeline: 3 days', callback: () => void this.activateTimeline('3days') });
		this.addCommand({ id: 'open-timeline-6months', name: 'Open timeline: 6 months', callback: () => void this.activateTimeline('6months') });
		this.addCommand({ id: 'open-timeline-year', name: 'Open timeline: year', callback: () => void this.activateTimeline('year') });

		// Navigation commands so the toolbar is hotkey-able. Existing command ids
		// above are untouched — users may already have hotkeys bound to them.
		this.addCommand({
			id: 'open-daily-note',
			// "or create": this writes a new file when the day has none, and
			// core/day-menu.ts sets the rule that an item which would create one
			// must say so rather than hide it behind the word "open". The day menu
			// complied; this command did not, and `calendarConfirmCreate` is off by
			// default, so it created the note unannounced.
			name: "Open (or create) the focused day's daily note",
			// With nothing focused this is today, so one command covers both readings.
			callback: () => void this.openOrCreateDaily(get(focusedDayStore).key || todayKey(), false),
		});
		this.timelineCommand('timeline-today', 'Timeline: go to today', (t) => t.today());
		this.timelineCommand('timeline-next', 'Timeline: next period', (t) => t.step(1));
		this.timelineCommand('timeline-prev', 'Timeline: previous period', (t) => t.step(-1));
		this.timelineCommand('timeline-zoom-out', 'Timeline: zoom out', (t) => t.zoomOut());
		this.timelineCommand('timeline-toggle-calendar', 'Timeline: toggle calendar', (t) => t.toggleCalendar());

		this.addCommand({
			id: 'resync-calendars',
			name: 'Refresh remote calendars',
			callback: () =>
				void this.icsService
					.refreshAll()
					.catch((e) => notifyError('Failed to refresh remote calendars', e)),
		});
		this.addCommand({
			id: 'test-notification',
			name: 'Send a test notification',
			// "Do reminders work on this machine?" had no answer short of creating an
			// event and waiting for it — which is why a silently-dropped OS
			// notification went unnoticed for so long.
			callback: () => this.notifications.sendTest(),
		});
		this.addCommand({
			id: 'toggle-completed',
			name: 'Show/hide completed items',
			callback: () => {
				this.settings.showCheckedBlocks = !this.settings.showCheckedBlocks;
				void this.saveSettings();
				new Notice(
					this.settings.showCheckedBlocks ? 'Completed items shown.' : 'Completed items hidden.',
				);
			},
		});
		this.addCommand({
			id: 'apply-template-past-bare',
			name: 'Apply daily template to bare past notes',
			callback: () => void this.applyTemplateToPastBareNotes(),
		});
		this.addCommand({
			id: 'schedule-todays-events',
			name: "Schedule today's events",
			callback: () => void this.scheduleTodaysEvents(),
		});
		this.addCommand({
			id: 'create-event',
			name: 'Create scheduled event from active note',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (checking) return file != null;
				if (file) this.menus.convert(file, TASK_EMOJIS.SCHEDULED);
				return true;
			},
		});

		// One command per entity, so every kind is reachable from the palette —
		// not just by right-clicking in the file explorer.
		for (const spec of EMOJI_REGISTRY) {
			if (spec.appliesTo !== 'file' || spec.key === 'scheduled') continue;
			this.addCommand({
				id: `convert-to-${spec.key}`,
				name: `Convert active note to ${spec.menuLabel}`,
				checkCallback: (checking) => {
					const file = this.app.workspace.getActiveFile();
					if (checking) return file != null;
					if (file) this.menus.convert(file, spec.emoji);
					return true;
				},
			});
		}
	}

	/**
	 * A broken template silently disables the feature forever, so say so — once per
	 * session, the way a failing calendar does.
	 */
	/**
	 * Say what an AUTOMATIC template merge did.
	 *
	 * A successful merge used to say nothing at all — the note was rewritten in
	 * place and the only way to notice was to read it. A merge that would have
	 * lost content says so loudly, because that is a refusal the user needs to
	 * act on (usually: their template already contains a line the planned block
	 * also uses).
	 */
	private reportTemplateOutcome(outcome: TemplateMergeOutcome, file: TFile): void {
		if (outcome.status === 'merged') {
			structuredNotice('Daily note template applied', file.basename);
			return;
		}
		if (outcome.status === 'would-lose-content') {
			structuredNotice(
				`Template NOT applied — it would have removed ${outcome.dropped.length} planned line(s)`,
				`${file.basename} — already has: ${outcome.dropped.join(', ')}`,
				{ warn: true },
			);
			return;
		}
		if (outcome.status !== 'template-unreadable' || this.templateWarned) return;
		this.templateWarned = true;
		notifyError('Could not read your daily note template', outcome.error);
	}

	/** The daily-note template configured in core Daily Notes, or null. */
	dailyTemplatePath(): string | null {
		return this.dailyNotes.templatePath();
	}

	/**
	 * Merge the template into today's note, by hand.
	 *
	 * Deliberately refuses to CREATE the note: a settings button is not a request
	 * to write a new file into the vault.
	 */
	async applyTemplateToToday(): Promise<void> {
		const file = this.dailyNotes.getExisting(todayKey());
		if (!file) {
			new Notice('Today’s daily note does not exist yet — open it first.');
			return;
		}
		await this.applyTemplateNow(file);
	}

	/** The past-bare sweep, which lists the days and confirms before writing. */
	applyTemplateToPastBare(): Promise<void> {
		return this.applyTemplateToPastBareNotes();
	}

	/**
	 * Merge the daily template into days that were planned ahead but never got it —
	 * the automatic sweep only ever looks at today, so a day spent with Obsidian
	 * closed is skipped. Lists them first and writes nothing without a confirm; the
	 * plugin still never walks your vault on its own.
	 */
	private async applyTemplateToPastBareNotes(): Promise<void> {
		const pending = await this.dailyNotes.findBarePastNotes(todayKey());
		if (pending.length === 0) {
			new Notice('No past daily notes are waiting for their template.');
			return;
		}
		const names = pending.map((p) => p.date).join(', ');
		new ConfirmModal(
			this.app,
			`Merge your daily-note template into ${pending.length} note${pending.length === 1 ? '' : 's'} ` +
				`(${names})? Their existing lines are kept — the template is added around them.`,
			async (ok) => {
				if (!ok) return;
				let merged = 0;
				for (const { file } of pending) {
					if ((await this.dailyNotes.applyTemplateIfBare(file)).status === 'merged') merged += 1;
				}
				new Notice(`Template applied to ${merged} note${merged === 1 ? '' : 's'}.`);
			},
		).open();
	}

	/**
	 * Show every 📅 note dated today that no planner line links yet, so the morning
	 * "did I plan all of this?" pass is one command instead of a manual search.
	 */
	private async scheduleTodaysEvents(): Promise<void> {
		// WAIT FOR THE INDEX. `localEventsStore` is empty until the first scan
		// lands, and this read used to happen straight away — so running the
		// command seconds after startup on a large vault reported "everything is
		// already planned" when the plugin had simply not looked yet. The sync
		// engine already flushes before it trusts the index; this did not.
		await this.eventIndex.flushNow();
		const today = todayKey();
		const pending = get(localEventsStore).events.filter(
			(ev) => !ev.linked && ev.date === today && ev.filePath,
		);
		if (pending.length === 0) {
			new Notice('Everything dated today is already in the day plan.');
			return;
		}
		// This modal IS the prompt — it lists what would be added and writes only
		// what you press Add on — so it resolves the slot itself rather than
		// opening a second dialog per note.
		new ScheduleTodayModal(this.app, pending, (ev) => {
			const slot = resolveSlot(ev, this.settings);
			return this.syncEngine.linkUnlinkedEvent(ev, slot.start, slot.end);
		}).open();
	}

	/** Register a command that drives the active timeline view, if there is one. */
	private timelineCommand(
		id: string,
		name: string,
		run: (timeline: NonNullable<ReturnType<TimelineView['exports']>>) => void,
	): void {
		this.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const view = this.activeTimelineView();
				const api = view?.exports();
				if (checking) return !!api;
				if (api) run(api);
				return true;
			},
		});
	}

	private activeTimelineView(): TimelineView | null {
		const active = this.app.workspace.getActiveViewOfType(TimelineView);
		if (active) return active;
		// Both ids render the same view, so a pane opened under either one counts.
		for (const type of [VIEW_TYPE_TIMELINE, VIEW_TYPE_CALENDAR]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				if (leaf.view instanceof TimelineView) return leaf.view;
			}
		}
		return null;
	}

	// ── actions ─────────────────────────────────────────────────────────
	private async activateTimeline(range?: TimelineRange, anchor?: string): Promise<void> {
		const leaf = await this.revealView(VIEW_TYPE_TIMELINE, false);
		if (range && leaf?.view instanceof TimelineView) {
			await leaf.setViewState({ type: VIEW_TYPE_TIMELINE, active: true, state: { range, anchor: anchor ?? todayKey() } });
		}
	}

	private async activateCalendar(): Promise<void> {
		// Same view, docked right — "everything in one tab" wherever you put it.
		await this.revealView(VIEW_TYPE_TIMELINE, true);
	}

	private isSidebarLeaf(leaf: WorkspaceLeaf): boolean {
		const root = leaf.getRoot();
		return root === this.app.workspace.rightSplit || root === this.app.workspace.leftSplit;
	}

	private async revealView(type: string, sidebar: boolean): Promise<WorkspaceLeaf | null> {
		// Either id counts as "already open" — they are the same view now.
		const existing = [
			...this.app.workspace.getLeavesOfType(type),
			...this.app.workspace.getLeavesOfType(type === VIEW_TYPE_TIMELINE ? VIEW_TYPE_CALENDAR : VIEW_TYPE_TIMELINE),
		];
		// "Open in the sidebar" must open in the SIDEBAR even when a tab already
		// shows the same view. The main-area case keeps taking any existing leaf, so
		// the ribbon icon doesn't start spawning duplicate tabs for sidebar users.
		const candidates = sidebar ? existing.filter((l) => this.isSidebarLeaf(l)) : existing;
		let leaf: WorkspaceLeaf | null = candidates[0] ?? null;
		if (!leaf) {
			leaf = sidebar ? this.app.workspace.getRightLeaf(false) : this.app.workspace.getLeaf(true);
			await leaf?.setViewState({ type, active: true });
		}
		if (leaf) await this.app.workspace.revealLeaf(leaf);
		return leaf;
	}

	private openEvent(event: LocalEvent): void {
		if (event.filePath) {
			const file = this.app.vault.getFileByPath(event.filePath);
			if (file) {
				void this.openInLeaf(file, false);
				return;
			}
		}
		// Plain-text block (or a dangling link): show it where it lives.
		if (event.placement) void this.openPlacement(event, false);
	}

	private async openOrCreateDaily(dateKey: string, newLeaf: boolean): Promise<void> {
		let file = this.dailyNotes.getExisting(dateKey);
		if (!file) {
			if (this.settings.calendarConfirmCreate) {
				const confirmed = await new Promise<boolean>((resolve) => {
					new ConfirmModal(this.app, `Create daily note for ${dateKey}?`, resolve).open();
				});
				if (!confirmed) return;
			}
			try {
				file = await this.dailyNotes.getOrCreateBare(dateKey);
			} catch (err) {
				// The service's message names the plugin to enable; showing only a
				// generic string sent the one actionable sentence to the console.
				notifyError(`Failed to create daily note — ${errorMessage(err)}`, err);
				return;
			}
		}
		await this.openInLeaf(file, newLeaf);
	}

	/**
	 * The dialog a drag on the grid opens, and the three things it can produce.
	 *
	 * The default is what it always was — a planner line, nothing created. The
	 * other two make a NOTE and link it into the slot the drag defined: an
	 * ordinary one named by what you typed, or a typed one that goes through the
	 * properties dialog first so the filename grammar gets its fields. See
	 * core/block-kind.ts for which types are offered and why.
	 */
	private async createBlock(dateKey: string, start: number, end: number): Promise<void> {
		const answer = await new Promise<{
			text: string | null;
			choice?: string;
			fields?: TaskPropertiesForm | null;
		}>((resolve) => {
			new TextPromptModal(this.app, {
				title: 'New time block',
				description: `${minutesToColon(start)} – ${minutesToColon(end)} on ${dateKey}. Type [[ to link a note.`,
				label: 'Task',
				placeholder: 'What is this block for?',
				ctaText: 'Add block',
				choice: {
					label: 'Create as',
					options: blockKindOptions(),
					initial: BLOCK_KIND_LINE,
				},
				// A type's own fields appear UNDER the picker rather than in a second
				// window: picking 📅 and filling in its name is one decision.
				fieldsFor: (choice, parent, typed) => {
					const kind = blockKindFor(choice);
					if (kind.kind !== 'typed') return null;
					// `typed` seeds the Action field: the type's own first field asks
					// the same question the Task box did, so the box is hidden and
					// what was already written moves into it.
					return new TaskPropertiesForm(parent, {
						format: getTaskFormatByEmoji(kind.emoji, this.settings),
						prefill: { actionWords: typed, startDate: dateKey, time: minutesToDot(start) },
						durationMinutes: end - start,
					});
				},
				onResult: (text, choice, fields) => resolve({ text, choice, fields }),
				// Linking an existing note is the whole point of the future-event
				// workflow: the line is written as a link, and the note it points at
				// is left alone until its day actually arrives.
				onInput: (inputEl) => new WikilinkSuggest(this.app, inputEl),
			}).open();
		});
		const text = answer.text;
		// Cancelled — the promise always settles. An empty string is legitimate when
		// a type's form replaced the text box; `answer.fields` is what carries the
		// answer then.
		if (text == null || (!text && !answer.fields)) return;

		const kind = blockKindFor(answer.choice);
		if (kind.kind === 'note') {
			await this.createNoteBlock(text, dateKey, start, end);
			return;
		}
		if (kind.kind === 'typed' && answer.fields) {
			// The dialog already validated; read what it collected. The typed text
			// seeds the action field only if the user left that field alone.
			const { props, durationMinutes } = answer.fields.read();
			if (!props.actionWords.trim()) props.actionWords = text;
			await this.createTypedNoteBlock(
				kind.emoji,
				props,
				dateKey,
				start,
				durationMinutes ?? end - start,
			);
			return;
		}

		try {
			const target = await this.dailyNotes.getOrCreateBare(dateKey);
			// serializePlannerLine clamps via minutesToColon, so a block dragged past
			// midnight can never write an unparseable "24:15".
			const line = serializePlannerLine({ startMinutes: start, endMinutes: end, text });
			await this.app.vault.process(target, (content) =>
				// Placed among whatever timed lines the note already has, wherever they
				// live; only a note with none falls back to the configured heading.
				insertTimedLine(content, this.settings.plannerHeading, line, start, {
					sorted: this.settings.sortPlannerLinesOnInsert,
					startMinutes: start,
				}),
			);
		} catch (err) {
			notifyError('Failed to create time block', err);
		}
	}

	/** "Note": an ordinary note named by what you typed, linked into the slot. */
	private async createNoteBlock(
		title: string,
		dateKey: string,
		start: number,
		end: number,
	): Promise<void> {
		try {
			const file = await this.taskFiles.createPlainNote(title);
			// null means the name was taken or unusable — createPlainNote has
			// already said so, and nothing was written. Do not write a line either:
			// it would link a note that does not exist.
			if (!file) return;
			await this.syncEngine.linkFileIntoDay(file.path, dateKey, start, end);
		} catch (err) {
			notifyError('Failed to create the note for this block', err);
		}
	}

	private async createTypedNoteBlock(
		emoji: string,
		props: TaskProperties,
		dateKey: string,
		fallbackStart: number,
		duration: number,
	): Promise<void> {
		try {
			// Resolve the date ONCE, before the name is generated. The name and the
			// planner line have to agree, and they used to be resolved separately:
			// `createTaskNote` generated from `props` as given while the line below
			// fell back to the dragged day. A 📅 format drops its whole "By …,"
			// clause when startDate is empty, so that produced an undated 📅 note
			// sitting on a dated line — a file no part of the plugin can then
			// recognise as scheduled, and which the sync engine cannot repair.
			const dated: TaskProperties = { ...props, startDate: props.startDate || dateKey };
			const file = await this.taskFiles.createTaskNote(emoji, dated);
			if (!file) return; // name taken — already reported, nothing written
			// The dialog owns the time: it may have been edited there, and the note's
			// NAME already carries whatever it says. The drag's start is only the
			// fallback for a type whose format has no {time} to edit.
			const startMin = (dated.time ? dotToMinutes(dated.time) : null) ?? fallbackStart;
			const span = duration > 0 ? duration : this.settings.defaultEventDurationMinutes;
			await this.syncEngine.linkFileIntoDay(
				file.path,
				dated.startDate ?? dateKey,
				startMin,
				startMin + span,
			);
		} catch (err) {
			notifyError('Failed to create the note for this block', err);
		}
	}

	private onFileOpen(file: TFile | null): void {
		const date = file ? this.dailyNotes.dateOf(file) : null;
		// Opening a daily note highlights that day everywhere, but deliberately
		// does NOT move the timeline (see core/focus.ts).
		if (date) focusDay(date, 'file-open');
		// TODAY OR LATER ONLY. This used to fire for `date <= todayKey()` — every
		// past day — so merely OPENING a daily note from 2021 rewrote it with your
		// current template, restamping {{time}}/{{timestamp}} with today's clock.
		// Old daily notes are history; the plugin does not edit history.
		if (file && date && this.settings.applyTemplateOnDayArrival && date >= todayKey()) {
			void this.dailyNotes
				.applyTemplateIfBare(file)
				.then((outcome) => this.reportTemplateOutcome(outcome, file))
				.catch((err) => notifyError('Failed to apply template', err));
		}
	}

	private async applyTemplateNow(file: TFile): Promise<void> {
		const outcome = await this.dailyNotes.applyTemplateIfBare(file);
		if (outcome.status === 'merged') new Notice('Daily note template applied.');
		else if (outcome.status === 'would-lose-content') {
			structuredNotice(
				'Template NOT applied — it would have removed planned lines',
				`${file.basename} — already has: ${outcome.dropped.join(', ')}`,
				{ warn: true },
			);
		} else if (outcome.status === 'template-unreadable') {
			notifyError('Could not read your daily note template', outcome.error);
		} else if (outcome.status === 'no-template') {
			// "Settings → Daily notes" names Obsidian's own UI path: a route, not prose.
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			new Notice('No daily note template is set (Settings → Daily notes).');
		} else {
			new Notice('Nothing to merge — this note already has content beyond its planner lines.');
		}
	}

	private async checkDayRollover(): Promise<void> {
		const today = todayKey();
		if (today === this.lastTemplateCheckDay) return;
		this.lastTemplateCheckDay = today;
		nowStore.set(Date.now());
		await this.checkTodaysTemplate();
	}

	private async checkTodaysTemplate(): Promise<void> {
		if (!this.settings.applyTemplateOnDayArrival) return;
		const file = this.dailyNotes.getExisting(todayKey());
		if (file) this.reportTemplateOutcome(await this.dailyNotes.applyTemplateIfBare(file), file);
	}
}
