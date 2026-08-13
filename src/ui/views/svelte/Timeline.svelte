<script lang="ts">
	import type { TaskEvent } from '../../../types';
	import type { TimelineViewContext, TimelineViewState } from '../context';
	import type { TimelineRange } from '../../../constants';
	import {
		PRIMARY_TIMELINE_RANGES,
		SECONDARY_TIMELINE_RANGES,
		RANGE_LABELS,
		ZOOM_OUT,
		isPrimaryRange,
		isGridRange,
		DEFAULT_EVENT_COLOR,
	} from '../../../constants';
	import { fromStore } from 'svelte/store';
	import { untrack } from 'svelte';
	import {
		localEventsStore,
		remoteEventsStore,
		hiddenRemoteStore,
		nowStore,
		settingsStore,
		focusedDayStore,
		focusDay,
		todayKeyStore,
	} from '../../../state/stores';
	import { rangeBounds, timelineDays, keyToMoment, addDays, monthTitle, monthGridDays } from '../../../core/date-key';
	import { isEventVisible } from '../../../core/event-visibility';
	import { eventTouchesRange } from '../../../core/event-range';
	import { shouldMoveAnchor, shouldPageMonth } from '../../../core/focus';
	import type { DayIntent } from '../../../core/interaction';
	import { dayBlocks } from './layout';
	import TimeGrid from './timegrid/TimeGrid.svelte';
	import MonthGrid from './calendar/MonthGrid.svelte';
	import type { DayMarker } from './calendar/MonthGrid.svelte';
	import MiniMonths from './minimonths/MiniMonths.svelte';
	import Icon from './Icon.svelte';

	let { ctx }: { ctx: TimelineViewContext } = $props();

	const settingsS = fromStore(settingsStore);
	const localS = fromStore(localEventsStore);
	const remoteS = fromStore(remoteEventsStore);
	const hiddenS = fromStore(hiddenRemoteStore);
	const nowS = fromStore(nowStore);
	const focusS = fromStore(focusedDayStore);
	const todayS = fromStore(todayKeyStore);

	// svelte-ignore state_referenced_locally
	const initial = ctx.initialState;
	let range = $state<TimelineRange>(initial.range);
	let anchor = $state<string>(initial.anchor);

	let settings = $derived(settingsS.current);
	/** Remote occurrences ticked off locally — see core/remote-hidden.ts. */
	let hiddenRemote = $derived(hiddenS.current);
	let bounds = $derived(rangeBounds(anchor, range, settings.firstDayOfWeek));

	let allEvents = $derived<TaskEvent[]>([...localS.current.events, ...remoteS.current.events]);
	let visible = $derived(
		allEvents.filter(
			(ev) =>
				eventTouchesRange(ev, bounds.from, bounds.to) &&
				isEventVisible(ev, settings.showCheckedBlocks, hiddenRemote),
		),
	);

	let gridDays = $derived(isGridRange(range) ? timelineDays(anchor, range, settings.firstDayOfWeek) : []);

	function shift(dir: 1 | -1): void {
		const m = keyToMoment(anchor);
		shiftAnchor(dir, m);
		focusDay(anchor, 'timeline');
	}

	function shiftAnchor(dir: 1 | -1, m: ReturnType<typeof keyToMoment>): void {
		switch (range) {
			case 'day':
				anchor = addDays(anchor, dir);
				break;
			case '3days':
				anchor = addDays(anchor, dir * 3);
				break;
			case 'week':
				anchor = addDays(anchor, dir * 7);
				break;
			case 'month':
				anchor = m.add(dir, 'month').format('YYYY-MM-DD');
				break;
			case '6months':
				anchor = m.add(dir * 6, 'month').format('YYYY-MM-DD');
				break;
			case 'year':
				anchor = m.add(dir, 'year').format('YYYY-MM-DD');
				break;
		}
	}

	function goToday(): void {
		anchor = todayS.current;
		focusDay(anchor, 'timeline');
		scrollTo('now');
	}

	/** A day click anywhere in a calendar: focus, open the note, or jump. */
	function onCalendarDayClick(day: string, intent: DayIntent): void {
		// 'focus' and 'timeline' mean the same thing in this view — the body IS
		// the timeline, so jumping to a day and focusing it are one action.
		if (intent === 'focus' || intent === 'timeline') {
			focusAndZoom(day);
			return;
		}
		focusDay(day, 'timeline');
		void ctx.actions.openDailyNote(day, intent === 'open-new-leaf');
	}

	/** Focus a day and zoom the body to it (day headers, month cells, mini months). */
	function focusAndZoom(key: string): void {
		anchor = key;
		range = 'day';
		focusDay(key, 'timeline');
	}

	// ── Embedded calendar rail ──────────────────────────────────────────────
	// It is a NAVIGATOR, so it only shows in the time-grid ranges; in the month
	// and overview ranges the body already is a calendar and the rail would be
	// redundant. Hidden (not disabled) — a disabled control reads as broken.
	let calendarOpen = $state<boolean>(initial.calendarOpen ?? true);
	/** Height the all-day lane has been dragged to, or null for automatic. */
	let laneHeight = $state<number | null>(initial.laneHeight ?? null);
	let showRail = $derived(isGridRange(range));
	let railAnchor = $state<string>(initial.anchor);

	$effect(() => {
		// Follow the body unless the user paged the rail somewhere else.
		const focus = focusS.current;
		untrack(() => {
			if (shouldPageMonth(focus, railAnchor)) railAnchor = focus.key;
		});
	});

	let railEvents = $derived.by(() => {
		const b = rangeBounds(railAnchor, 'month', settings.firstDayOfWeek);
		return allEvents.filter(
			(ev) => eventTouchesRange(ev, b.from, b.to) && isEventVisible(ev, settings.showCheckedBlocks, hiddenRemote),
		);
	});

	function shiftRailMonth(dir: 1 | -1): void {
		railAnchor = keyToMoment(railAnchor).add(dir, 'month').format('YYYY-MM-DD');
	}

	// ── Day signals shown as dots in the rail ───────────────────────────────
	let railDays = $derived(monthGridDays(railAnchor, settings.firstDayOfWeek));

	/**
	 * Which visible days already have a daily note, so the header can say whether
	 * its button opens one or creates one.
	 *
	 * Keyed on the index version, not on render: creating, deleting or renaming a
	 * file bumps it, so this is a handful of path lookups per index change rather
	 * than seven per frame.
	 */
	let dayHasNote = $derived.by(() => {
		void localS.current.version;
		return new Set(gridDays.filter((d) => ctx.hasDailyNote(d)));
	});

	let taskDays = $derived.by(() => {
		void localS.current.version;
		const map = new Map<string, boolean>();
		if (settings.calendarShowTaskDots) {
			for (const d of railDays) map.set(d, ctx.hasUncheckedTasks(d));
		}
		return map;
	});

	let wordCounts = $state<Map<string, number | null>>(new Map());
	$effect(() => {
		if (!settings.calendarShowWordCountDots || !showRail || !calendarOpen) {
			wordCounts = new Map();
			return;
		}
		const grid = railDays;
		void localS.current.version;
		let cancelled = false;
		void (async () => {
			// Parallel, and one failed read must not blank the whole month.
			const entries = await Promise.all(
				grid.map(async (d): Promise<[string, number | null]> => {
					try {
						return [d, await ctx.wordCountFor(d)];
					} catch {
						return [d, null];
					}
				}),
			);
			if (!cancelled) wordCounts = new Map(entries);
		})();
		return () => {
			cancelled = true;
		};
	});

	/** Non-event signals: a hollow ring for tasks, a faint dot for writing. */
	function railMarkers(day: string): DayMarker[] {
		const out: DayMarker[] = [];
		if (taskDays.get(day)) out.push({ kind: 'task', title: 'Has unchecked tasks' });
		const words = wordCounts.get(day) ?? 0;
		if (words) out.push({ kind: 'word', title: `${words} words` });
		return out;
	}

	export function toggleCalendar(): void {
		// Only meaningful where the rail exists; toggling while it's hidden would
		// silently invert its state for when the user returns to a grid range.
		if (!showRail) return;
		calendarOpen = !calendarOpen;
	}

	// ── Overlap warning (detection only, never auto-fixed) ──────────────────
	/**
	 * ONE array of (day, blocks) pairs — never two arrays coupled by index. When
	 * they were separate (`days` + `perDay`), a stale keyed {#each} item could keep
	 * an old day's header while rendering the CURRENT day's blocks under it: the
	 * "title says Aug 11, header says Aug 10" screenshot. A pair makes that state
	 * unrepresentable — a stale column is stale consistently.
	 */
	let columns = $derived(gridDays.map((day) => ({ day, blocks: dayBlocks(day, visible, settings) })));
	let overlapCount = $derived(columns.reduce((n, c) => n + c.blocks.overlapping.size, 0));

	function focusFirstOverlap(): void {
		const hit = columns.find((c) => c.blocks.overlapping.size > 0);
		if (hit) focusAndZoom(hit.day);
	}

	// ── Range switching ─────────────────────────────────────────────────────
	function setRange(next: TimelineRange): void {
		range = next;
	}

	/** Still reachable from the command palette; no longer bound to the title. */
	export function zoomOut(): void {
		const next = ZOOM_OUT[range];
		if (next) range = next;
	}

	/** The ranges that don't fit the toolbar, offered in a native menu. */
	/**
	 * Fade the range pills' right edge ONLY while they really overflow.
	 *
	 * The mask used to be unconditional, and `100%` of a non-overflowing element
	 * is its own width — so the last 14px of the row were always half-faded. With
	 * the `›` button formerly inside the scroller that landed straight on the
	 * chevron and read as a smudge, which is what "weird shadow" was.
	 *
	 * A ResizeObserver rather than a one-shot measure: the pane is resizable and
	 * the row wraps, so overflow starts and stops without any state changing here.
	 */
	function watchOverflow(node: HTMLElement): () => void {
		const sync = (): void => node.toggleClass('tn-overflowing', node.scrollWidth > node.clientWidth);
		const observer = new ResizeObserver(sync);
		observer.observe(node);
		sync();
		return () => observer.disconnect();
	}

	function openRangeMenu(e: MouseEvent): void {
		ctx.actions.showMenu(
			SECONDARY_TIMELINE_RANGES.map((r) => ({
				label: RANGE_LABELS[r],
				checked: r === range,
				onPick: () => setRange(r),
			})),
			e,
		);
	}

	let scrollRequest = $state<{ at: 'dayStart' | 'now'; seq: number }>({ at: 'dayStart', seq: 0 });
	function scrollTo(at: 'dayStart' | 'now'): void {
		scrollRequest = { at, seq: scrollRequest.seq + 1 };
	}

	/**
	 * Loop guard #3: the effect tracks ONLY the focus store, and reads/writes the
	 * anchor inside untrack(), so changing the anchor here can never re-run it.
	 * Loop guard #2: this never publishes — the anchor write is silent.
	 */
	let lastFocusSeq = -1;
	$effect(() => {
		const focus = focusS.current;
		if (focus.seq === lastFocusSeq) return;
		lastFocusSeq = focus.seq;
		untrack(() => {
			if (!shouldMoveAnchor(focus, rangeBounds(anchor, range, settings.firstDayOfWeek))) return;
			anchor = focus.key;
		});
	});

	function navigate(nextRange: TimelineRange, nextAnchor: string): void {
		range = nextRange;
		anchor = nextAnchor;
		focusDay(nextAnchor, 'timeline');
	}

	/**
	 * Applied by the view when Obsidian restores or a command changes the state.
	 * Updating props in place (instead of remounting) preserves scroll and drags.
	 */
	export function applyState(next: TimelineViewState): void {
		// A layout restore is not a user navigation: apply locally, publish nothing.
		if (next.range !== range) range = next.range;
		if (next.anchor !== anchor) {
			anchor = next.anchor;
			// Keep the rail on the body's month; without this the two show different
			// months after a restore, with no day highlighted anywhere.
			railAnchor = next.anchor;
		}
		if (typeof next.calendarOpen === 'boolean') calendarOpen = next.calendarOpen;
		laneHeight = next.laneHeight;
	}

	/** Imperative API for commands (see main.ts registerCommands). */
	export function today(): void {
		goToday();
	}
	export function step(dir: 1 | -1): void {
		shift(dir);
	}

	function title(): string {
		const m = keyToMoment(anchor);
		switch (range) {
			case 'day':
				return m.format('dddd, MMMM D, YYYY');
			case '3days': {
				const end = keyToMoment(addDays(anchor, 2));
				return `${m.format('MMM D')} – ${end.format('MMM D')}`;
			}
			case 'week': {
				const days = timelineDays(anchor, 'week', settings.firstDayOfWeek);
				return `${keyToMoment(days[0]).format('MMM D')} – ${keyToMoment(days[6]).format('MMM D, YYYY')}`;
			}
			case 'month':
				return monthTitle(anchor);
			case '6months': {
				const end = m.clone().add(5, 'month');
				return `${m.format('MMM')} – ${end.format('MMM YYYY')}`;
			}
			case 'year':
				return m.format('YYYY');
		}
	}

	$effect(() => {
		ctx.persist({ range, anchor, calendarOpen, laneHeight });
	});

</script>

<!-- --tn-local-color is only SET when the user chose one; unset, every var()
     that reads it falls through to the neutral default, so an empty setting is
     byte-identical to the pre-setting look. -->
<div
	class="tn-timeline"
	style:--tn-default-event-color={DEFAULT_EVENT_COLOR}
	style:--tn-local-color={settings.localEventColor || null}
>
	<div class="tn-toolbar">
		<div class="tn-nav">
			{#if showRail}
				<button
					class="tn-btn tn-btn-ghost"
					class:tn-active={calendarOpen}
					aria-pressed={calendarOpen}
					aria-label={calendarOpen ? 'Hide calendar' : 'Show calendar'}
					title={calendarOpen ? 'Hide the calendar' : 'Show the calendar'}
					onclick={toggleCalendar}
				>
					<Icon name="calendar" />
				</button>
			{/if}
			<button
				class="tn-btn tn-btn-ghost"
				class:tn-active={settings.showCheckedBlocks}
				aria-pressed={settings.showCheckedBlocks}
				aria-label={settings.showCheckedBlocks ? 'Hide completed items' : 'Show completed items'}
				title={settings.showCheckedBlocks
					? 'Completed items are shown — click to hide them'
					: 'Completed items are hidden — click to show them'}
				onclick={() => void ctx.actions.setShowCompleted(!settings.showCheckedBlocks)}
			>
				<Icon name="check-check" />
			</button>
			<button class="tn-btn tn-btn-ghost" onclick={() => shift(-1)} aria-label="Previous">
				<Icon name="chevron-left" />
			</button>
			<button class="tn-btn" onclick={goToday}>Today</button>
			<button class="tn-btn tn-btn-ghost" onclick={() => shift(1)} aria-label="Next">
				<Icon name="chevron-right" />
			</button>
		</div>

		<!-- A heading, not a control. This used to be the zoom-out button: the
		     largest target in the toolbar, styled like a label, so one click
		     silently changed the range and the workspace remembered it forever.
		     Ranges are changed from the range buttons, which are all visible. -->
		<span class="tn-title">{title()}</span>

		{#if overlapCount > 0}
			<button
				class="tn-chip-warn"
				title={`${overlapCount} blocks overlap another block in view`}
				onclick={focusFirstOverlap}
			>
				⚠ {overlapCount}
			</button>
		{/if}

		<!-- The pills scroll and fade at their right edge when they overflow; the
		     `›` button must NOT be inside that scroller, or the fade sits on top of
		     it permanently and reads as a smudge on the chevron. The wrapper keeps
		     the two at pill spacing regardless. -->
		<div class="tn-range-group">
			<div class="tn-ranges" role="group" aria-label="Range" {@attach watchOverflow}>
				{#each PRIMARY_TIMELINE_RANGES as r}
					<button
						class="tn-range"
						class:tn-active={r === range}
						aria-pressed={r === range}
						onclick={() => setRange(r)}
					>
						{RANGE_LABELS[r]}
					</button>
				{/each}
			</div>
			<button
				class="tn-range tn-range-more"
				class:tn-active={!isPrimaryRange(range)}
				aria-haspopup="menu"
				aria-label={isPrimaryRange(range)
					? 'More ranges'
					: `Range: ${RANGE_LABELS[range]}. More ranges`}
				title={SECONDARY_TIMELINE_RANGES.map((r) => RANGE_LABELS[r]).join(' · ')}
				onclick={openRangeMenu}
			>
				<!-- The chevron is always drawn: when a menu-held range is active this
				     reads "6 months ⌄" — a label AND something you can obviously click. -->
				{#if !isPrimaryRange(range)}
					<span class="tn-range-more-label">{RANGE_LABELS[range]}</span>
				{/if}
				<Icon name="chevron-down" size={12} />
			</button>
		</div>
	</div>

	<div class="tn-body-wrap">
		{#if showRail && calendarOpen}
			<div class="tn-rail">
				<div class="tn-rail-header">
					<button class="tn-btn tn-btn-ghost" onclick={() => shiftRailMonth(-1)} aria-label="Previous month">
						<Icon name="chevron-left" size={14} />
					</button>
					<button class="tn-rail-title" onclick={() => (railAnchor = anchor)}>{monthTitle(railAnchor)}</button>
					<button class="tn-btn tn-btn-ghost" onclick={() => shiftRailMonth(1)} aria-label="Next month">
						<Icon name="chevron-right" size={14} />
					</button>
				</div>
				<MonthGrid
					anchor={railAnchor}
					events={railEvents}
					{settings}
					variant="dots"
					today={todayS.current}
					focusedDay={focusS.current.key}
					markers={railMarkers}
					onDayClick={onCalendarDayClick}
					onDayContextMenu={(day, e) => ctx.actions.showDayMenu(day, e)}
				/>
			</div>
		{/if}
		{#if isGridRange(range)}
			<!-- A boundary, because a single uncaught throw inside a keyed {#each}
			     leaves its DOM permanently frozen — Svelte marks the effect clean
			     BEFORE running it, so it is never retried and nothing is reported.
			     That is how the grid once showed yesterday's header over today's
			     blocks with a clean-looking console. Failing loudly beats that. -->
			<svelte:boundary
				onerror={(error) => {
					console.error('Task Notes: the timeline failed to render', error);
					ctx.actions.notify('the timeline hit an error and was reloaded — see the console.');
				}}
			>
				<TimeGrid
					{columns}
					{settings}
					now={nowS.current}
					today={todayS.current}
					{scrollRequest}
					actions={ctx.actions}
					onFocusDay={focusAndZoom}
					{hiddenRemote}
					dayFormat={ctx.dailyNoteFormat()}
					{dayHasNote}
					bind:laneHeight
				/>
				{#snippet failed(_error, reset)}
					<div class="tn-grid-failed">
						<p>The timeline hit an error while drawing.</p>
						<button class="tn-btn" onclick={reset}>Reload the grid</button>
					</div>
				{/snippet}
			</svelte:boundary>
		{:else if range === 'month'}
			<div class="tn-month">
				<MonthGrid
					{anchor}
					events={visible}
					{settings}
					variant="chips"
					today={todayS.current}
					focusedDay={focusS.current.key}
					draggable
					onDayClick={onCalendarDayClick}
					onDayContextMenu={(day, e) => ctx.actions.showDayMenu(day, e)}
					onEventClick={(ev) => ev.kind === 'local' && ctx.actions.openEvent(ev)}
					onSetChecked={(ev, next) =>
						ev.placement && void ctx.actions.setLineChecked(ev.placement, next)}
					onSetRemoteHidden={(ev, next) => void ctx.actions.setRemoteHidden(ev, next)}
					renderMarkdown={ctx.actions.renderMarkdown}
					{hiddenRemote}
					onEventContextMenu={(ev, e) => ctx.actions.showEventMenu(ev, e)}
					onEventDrop={(ev, newDate) =>
						ev.kind === 'local' && void ctx.actions.applyBlockEdit(ev, newDate, ev.startMinutes, ev.endMinutes)}
					onOverflowClick={(day) => focusAndZoom(day)}
				/>
			</div>
		{:else}
			<MiniMonths
				{anchor}
				count={range === 'year' ? 12 : 6}
				events={visible}
				{settings}
				today={todayS.current}
				focusedDay={focusS.current.key}
				{navigate}
				onDayClick={onCalendarDayClick}
			/>
		{/if}
	</div>
</div>
