<script lang="ts">
	// ONE month grid, three densities. The timeline's month range, the sidebar
	// calendar, the embedded rail and the 6-month/year overviews were four
	// near-identical implementations; they are all this component now, which is
	// also how remote (ICS) events finally reach the sidebar.
	import type { LocalEvent, RemoteEvent, TaskEvent } from '../../../../types';
	import type { TaskNotesSettings } from '../../../../settings/settings';
	import {
		monthGridDays,
		weekdayShortLabels,
		weekdayMinLabels,
		isSameMonth,
		keyToMoment,
	} from '../../../../core/date-key';
	import { chipDropDate } from '../../../../core/chip-drag';
	import { eventDayKeys } from '../../../../core/event-range';
	import { dayIntent, ownsPointer, type DayIntent } from '../../../../core/interaction';
	import {
		visibleRowCount,
		CAL_CHIP_PX,
		CAL_CHIP_COARSE_PX,
		CAL_DAYNUM_PX,
	} from '../../../../core/row-budget';
	import EventChip from '../EventChip.svelte';
	import { eventTitle } from '../../../../core/event-title';

	export type MonthVariant = 'chips' | 'dots' | 'dot';

	/** An extra signal a host wants shown on a day (sidebar task/word dots). */
	export interface DayMarker {
		kind: string;
		title?: string;
	}

	interface DisplayEvent {
		key: string;
		event: TaskEvent;
	}

	let {
		anchor,
		events = [],
		settings,
		variant = 'chips',
		today,
		focusedDay = null,
		showWeekdays = true,
		maxChips = 4,
		draggable = false,
		markers = null,
		onDayClick,
		onDayContextMenu = null,
		onEventClick = null,
		onEventContextMenu = null,
		onEventDrop = null,
		onOverflowClick = null,
		onSetChecked = null,
		onSetRemoteHidden = null,
		renderMarkdown = null,
		hiddenRemote = new Set<string>(),
	}: {
		anchor: string;
		events?: TaskEvent[];
		settings: TaskNotesSettings;
		variant?: MonthVariant;
		today: string;
		focusedDay?: string | null;
		showWeekdays?: boolean;
		maxChips?: number;
		draggable?: boolean;
		markers?: ((day: string) => DayMarker[]) | null;
		onDayClick: (day: string, intent: DayIntent) => void;
		onDayContextMenu?: ((day: string, e: MouseEvent) => void) | null;
		onEventClick?: ((event: TaskEvent) => void) | null;
		onEventContextMenu?: ((event: TaskEvent, e: MouseEvent) => void) | null;
		onEventDrop?: ((event: TaskEvent, newDate: string) => void) | null;
		onOverflowClick?: ((day: string) => void) | null;
		/** Tick/untick a chip's own planner line. Absent = chips show no checkbox. */
		onSetChecked?: ((event: LocalEvent, next: boolean) => void) | null;
		/** Hide/show one remote occurrence. Absent = remote chips show no checkbox. */
		onSetRemoteHidden?: ((event: RemoteEvent, hidden: boolean) => void) | null;
		/** Render a chip title as Markdown; absent = plain text. See EventChip. */
		renderMarkdown?: ((el: HTMLElement, text: string) => (() => void) | void) | null;
		hiddenRemote?: ReadonlySet<string>;
	} = $props();

	const MAX_DOTS = 3;

	/**
	 * How many chips a cell can actually show.
	 *
	 * `maxChips` alone was a fixed count regardless of cell height, so in a short
	 * cell (48px on a narrow pane, 40px narrower still) four chips were drawn into
	 * room for two and the rest were silently clipped — including the "+N more"
	 * that would have explained it, because it lived inside the clipped list.
	 *
	 * `visibleRowCount` already encodes exactly this rule for blocks — draw
	 * everything if it fits, otherwise keep one slot back for the counter — so it
	 * is reused rather than reimplemented.
	 */
	let cellPx = $state(0);
	/**
	 * A chip is taller on a touch device — `@media (pointer: coarse)` adds 4px of
	 * padding above and below — so the budget has to ask which one is drawing.
	 * Matched with the same query the stylesheet uses, not a guess about width.
	 */
	let chipPx = $derived(
		typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
			? CAL_CHIP_COARSE_PX
			: CAL_CHIP_PX,
	);
	let chipBudget = $derived(
		cellPx > 0
			? Math.max(0, Math.floor((cellPx - CAL_DAYNUM_PX) / chipPx))
			: // Before the first measurement, trust the caller's cap rather than
				// drawing nothing — one frame of over-draw beats an empty grid.
				maxChips,
	);

	let days = $derived(monthGridDays(anchor, settings.firstDayOfWeek));
	let weekdays = $derived(
		variant === 'chips' ? weekdayShortLabels(settings.firstDayOfWeek) : weekdayMinLabels(settings.firstDayOfWeek),
	);
	/** Events per day, computed once for the whole grid rather than per cell. */
	let byDay = $derived.by(() => {
		const map = new Map<string, TaskEvent[]>();
		const from = days[0];
		const to = days[days.length - 1];
		for (const ev of events) {
			for (const key of eventDayKeys(ev, from, to)) {
				const list = map.get(key);
				if (list) list.push(ev);
				else map.set(key, [ev]);
			}
		}
		for (const list of map.values()) list.sort((a, b) => sortKey(a) - sortKey(b));
		return map;
	});

	function sortKey(ev: TaskEvent): number {
		if (ev.kind === 'local') return ev.startMinutes ?? -1;
		const d = new Date(ev.startTs);
		return d.getHours() * 60 + d.getMinutes();
	}

	function eventsOn(day: string): TaskEvent[] {
		return byDay.get(day) ?? [];
	}

	/** A domain id may repeat; the rendered occurrence in this cell may not. */
	function displayEventsOn(day: string): DisplayEvent[] {
		return eventsOn(day).map((event, index) => ({
			key: `${event.id}::${day}::${index}`,
			event,
		}));
	}

	/**
	 * Each day's chip list, computed ONCE per render.
	 *
	 * `byDisplayKey` walked all 42 days calling `displayEventsOn`, and then the
	 * template called it again for every cell — so `eventsOn` ran twice per day and
	 * allocated a second set of wrapper objects each time. MiniMonths renders twelve
	 * of these grids at once, which made it twenty-four full passes per redraw.
	 */
	let displayByDay = $derived(new Map(days.map((day) => [day, displayEventsOn(day)])));

	let byDisplayKey = $derived(
		new Map(
			[...displayByDay.values()].flatMap((items) => items.map((item) => [item.key, item.event])),
		),
	);

	// The grabbed chip's own cell — so grabbing a multi-day chip by a middle day
	// moves it relatively instead of jumping to its start.
	// pointerId, like every gesture in the TimeGrid: without it a second finger's
	// pointerup ran the drop with ITS coordinates — a cross-day write and a rename
	// from two stray taps. The exact bug ownsPointer exists to prevent.
	let drag = $state<{ pointerId: number; key: string; originDay: string } | null>(null);
	let gridEl = $state<HTMLElement | null>(null);

	$effect(() => {
		const el = gridEl;
		// `days` so a month with six week-rows re-measures rather than keeping the
		// five-row cell height.
		void days;
		if (!el) return;
		const rows = Math.max(1, Math.ceil(days.length / 7));
		const measure = (): void => {
			// scrollHeight, not clientHeight. `.tn-cal-grid` is `overflow-y: auto`
			// with `grid-auto-rows: minmax(--tn-cell-min-height, 1fr)`, so when six
			// rows do not fit the pane, clientHeight is the VISIBLE box and the
			// row height came out far too small — which drove the chip budget to
			// zero and made every populated day in a narrow month view render no
			// chips at all, only "+N more".
			cellPx = Math.max(el.scrollHeight, el.clientHeight) / rows;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});


	function onPointerDown(e: PointerEvent) {
		if (!draggable || e.button !== 0) return; // right-click must never reschedule
		// A control inside a chip (its checkbox) acts on click; starting a drag here
		// would swallow that click.
		if ((e.target as HTMLElement).closest('[data-badge]')) return;
		const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-chip-key]');
		if (!chip) return;
		const key = chip.getAttribute('data-chip-key');
		const originDay = chip.closest<HTMLElement>('[data-daykey]')?.getAttribute('data-daykey');
		if (!key || !originDay) return;
		drag = { pointerId: e.pointerId, key, originDay };
		gridEl?.setPointerCapture?.(e.pointerId);
	}

	function onPointerUp(e: PointerEvent) {
		if (!ownsPointer(drag, e)) return;
		const { key, originDay } = drag;
		drag = null;
		const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-daykey]');
		// Scoped to THIS grid, exactly as TimeGrid scopes its own hit-tests. Two
		// views can be open at once by design (a tab and the sidebar), both render
		// `[data-daykey]`, and pointer capture does not affect elementFromPoint —
		// so a chip released over the OTHER view's calendar used to resolve a day
		// from it and write a cross-day move the user never made there.
		const targetDay = el && gridEl?.contains(el) ? el.getAttribute('data-daykey') : null;
		const ev = byDisplayKey.get(key);
		if (!ev || ev.kind === 'remote' || !targetDay) return;

		// Dropped on the cell it came from = a click, never a write.
		if (targetDay === originDay) {
			onEventClick?.(ev);
			return;
		}
		onEventDrop?.(ev, chipDropDate(ev.date, originDay, targetDay));
	}

	function onContextMenu(e: MouseEvent) {
		const target = e.target as HTMLElement;
		const chipKey = target.closest<HTMLElement>('[data-chip-key]')?.getAttribute('data-chip-key');
		const ev = chipKey ? byDisplayKey.get(chipKey) : null;
		if (ev && onEventContextMenu) {
			e.preventDefault();
			e.stopPropagation();
			onEventContextMenu(ev, e);
			return;
		}
		const day = target.closest<HTMLElement>('[data-daykey]')?.getAttribute('data-daykey');
		if (day && onDayContextMenu) {
			e.preventDefault();
			e.stopPropagation();
			onDayContextMenu(day, e);
		}
	}

	/** Density bucket 1–4 for the year overview's single dot. */
	function density(day: string): number {
		return Math.min(eventsOn(day).length, 4);
	}
</script>

<div class="tn-cal-grid-wrap tn-cal-v-{variant}">
	{#if showWeekdays}
		<div class="tn-cal-weekdays">
			{#each weekdays as wd}
				<div class="tn-cal-wd">{wd}</div>
			{/each}
		</div>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="tn-cal-grid"
		aria-label="Month grid"
		bind:this={gridEl}
		onpointerdown={onPointerDown}
		onpointerup={onPointerUp}
		oncontextmenu={onContextMenu}
		onpointercancel={(e) => {
			// Only THIS drag's pointer may cancel it. A second finger touching down
			// and lifting fires pointercancel with its own id, which used to clear a
			// drag the first finger was still holding — the chip stopped following
			// and the drop did nothing.
			if (ownsPointer(drag, e)) drag = null;
		}}
		onlostpointercapture={(e) => ownsPointer(drag, e) && (drag = null)}
	>
		{#each days as day (day)}
			{@const dayEvents = eventsOn(day)}
			{@const displayedEvents = displayByDay.get(day) ?? []}
			{@const shownChips = visibleRowCount(dayEvents.length, chipBudget, maxChips)}
			<div
				class="tn-cal-cell"
				class:tn-outside={!isSameMonth(day, anchor)}
				class:tn-today={day === today}
				class:tn-focused={day === focusedDay}
				data-daykey={day}
			>
				<button
					class="tn-cal-daynum"
					title={`${day} · click to focus · Ctrl/Cmd-click for the daily note · Alt-click for the timeline`}
					onclick={(e) => onDayClick(day, dayIntent(e))}
				>
					<span class="tn-cal-num">{keyToMoment(day).date()}</span>

					<!-- Dots live INSIDE the button so the whole cell is one target. -->
					{#if variant === 'dots'}
						<span class="tn-cal-dots-row">
							{#if settings.calendarShowEventDots}
								{#each displayedEvents.slice(0, MAX_DOTS) as item (item.key)}
									{@const ev = item.event}
									<!-- A square in the calendar's own colour: shape says "not one of
									     mine", colour says which calendar. -->
									<span
										class="tn-cal-dot"
										class:tn-dot-event={ev.kind === 'local'}
										class:tn-dot-remote={ev.kind === 'remote'}
										style:--tn-dot-color={ev.kind === 'remote' && ev.color ? ev.color : null}
										title={eventTitle(ev, { hiddenRemote })}
									></span>
								{/each}
							{/if}
							{#each markers?.(day) ?? [] as marker}
								<span class="tn-cal-dot tn-dot-{marker.kind}" title={marker.title}></span>
							{/each}
						</span>
					{:else if variant === 'dot' && density(day) > 0}
						<span
							class="tn-cal-dot tn-dot-density"
							style:--tn-dot-n={density(day)}
							title={`${dayEvents.length} events`}
						></span>
					{/if}
				</button>

				{#if variant === 'chips'}
					<div class="tn-cal-chip-list">
						{#each displayedEvents.slice(0, shownChips) as item (item.key)}
							{@const ev = item.event}
							<EventChip
								event={ev}
								variant="cal"
								{hiddenRemote}
								dragging={drag?.key === item.key}
								data-chip-key={item.key}
								{onSetChecked}
								{onSetRemoteHidden}
								{renderMarkdown}
								aria-label={ev.title}
								title={eventTitle(ev, { hiddenRemote })}
								onkeydown={(e: KeyboardEvent) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onEventClick?.(ev);
									}
								}}
							/>
						{/each}
					</div>
					<!-- Outside the clipped list on purpose: as its last child, the
					     counter explaining the truncation was the first thing truncated. -->
					{#if dayEvents.length > shownChips}
						<button class="tn-cal-more" onclick={() => onOverflowClick?.(day)}>
							+{dayEvents.length - shownChips} more
						</button>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
</div>
