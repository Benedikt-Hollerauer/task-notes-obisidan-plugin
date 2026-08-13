<script lang="ts">
	import type { LineTarget, LocalEvent, RemoteEvent, TaskEvent } from '../../../../types';
	import type { BodyRow } from '../../../../core/line-tree';
	import type { TimelineActions } from '../../context';
	import type { TaskNotesSettings } from '../../../../settings/settings';
	import type { AllDayItem, DayBlocks, TimedBlock } from '../layout';
	import { minutesToColon, snap, clamp } from '../../../../core/timestamps';
	import { dayNoteLabel, dayShortLabel } from '../../../../core/date-key';
	import { scrollTopFor, scrollTopAfterWindowShift } from './scroll';
	import { untrack, tick } from 'svelte';
	import { dayWindow, windowHours, fitBlockInWindow } from '../../../../core/day-window';
	import { chipDropDate, isClickGesture, type Point } from '../../../../core/chip-drag';
	import { dayAt, ownsPointer, dayIntent } from '../../../../core/interaction';
	import { visibleRowCount, showsTimeLabel, ROW_PX, HEAD_PX } from '../../../../core/row-budget';
	import { clampLaneHeight, laneMaxPx, LANE_MIN_PX, LANE_DEFAULT_PX } from '../../../../core/lane';
	import {
		nextHourHeight,
		scrollTopAfterZoom,
		HOUR_HEIGHT_MIN,
		HOUR_HEIGHT_MAX,
	} from '../../../../core/zoom';
	import Icon from '../Icon.svelte';
	import TaskCheck from '../TaskCheck.svelte';
	import EventChip from '../EventChip.svelte';
	import { eventTitle } from '../../../../core/event-title';
	import { lineTitle } from '../../../../core/line-title';
	import { isChecked } from '../../../../core/planner-line';
	import { isEventDone } from '../../../../core/event-visibility';
	import { isHappeningNow, minutesOfDay } from '../../../../core/now';

	let {
		columns,
		settings,
		now,
		today,
		scrollRequest,
		actions,
		onFocusDay,
		hiddenRemote,
		dayFormat,
		laneHeight = $bindable(null),
		dayHasNote,
	}: {
		/**
		 * The visible days, each PAIRED with its blocks. One array on purpose: as
		 * two index-coupled arrays, a stale keyed {#each} item could render one
		 * day's header over another day's blocks (the frozen-header bug).
		 */
		columns: { day: string; blocks: DayBlocks }[];
		settings: TaskNotesSettings;
		now: number;
		/** Reactive today key, so the highlight follows midnight. */
		today: string;
		/** Bumping `seq` asks the grid to scroll; `at` says where to. */
		scrollRequest: { at: 'dayStart' | 'now'; seq: number };
		actions: TimelineActions;
		onFocusDay: (dayKey: string) => void;
		/** Remote occurrences ticked off locally (see core/remote-hidden.ts). */
		hiddenRemote: ReadonlySet<string>;
		/** The moment format daily notes are named with, for the day headers. */
		dayFormat: string;
		/** Dragged height of the all-day lane, or null for automatic. Bindable. */
		laneHeight?: number | null;
		/** Which of the visible days already have a daily note. */
		dayHasNote: ReadonlySet<string>;
	} = $props();

	/** The day keys alone — for dayAt, the needle, and every hit-test. */
	let days = $derived(columns.map((c) => c.day));

	const DOUBLE_CLICK_MS = 400;
	/**
	 * Never build more than this collapsed. A flat cap made zooming in past
	 * ~200px/h reveal nothing: the block had room for forty rows and still drew
	 * twelve. The cap now scales with the room the block actually has, and only
	 * exists at all so one block drawn to the day edge cannot freeze the pane.
	 */
	const MAX_COLLAPSED_ROWS = 60;
	/** …or more than this expanded: one block should not be able to freeze the pane. */
	const MAX_EXPANDED_ROWS = 200;

	/** The one block currently expanded over its neighbours, if any. */
	let expandedKey = $state<string | null>(null);

	/**
	 * The current minute, derived once. `now` is a millisecond timestamp ticking
	 * every 30s; deriving the MINUTE means every block's now-state recomputes
	 * twice a minute at most, instead of on every tick.
	 */
	let nowMinutes = $derived(minutesOfDay(now));

	let pxPerMinute = $derived(settings.hourHeightPx / 60);

	/**
	 * The hours actually drawn: the configured window, stretched to hold whatever
	 * the days on screen contain. One window for every column, so they stay
	 * aligned and a block means the same height wherever it is.
	 */
	let win = $derived(
		dayWindow(
			columns.flatMap((c) => c.blocks.timed.map((b) => ({ startMin: b.startMin, endMin: b.endMin }))),
			settings,
		),
	);
	let HOURS = $derived(windowHours(win));
	/**
	 * How finely the ruler subdivides an hour. At 30px an hour there is no room
	 * for anything but the hour line; by 200px a half-hour rule stops a block
	 * from floating unanchored, and past 400px quarter-hours are readable.
	 */
	let hourSubdivisions = $derived(
		settings.hourHeightPx >= 400 ? 4 : settings.hourHeightPx >= 200 ? 2 : 1,
	);
	/** The sub-hour marks to draw, as a fraction of the hour and their label. */
	let subLabels = $derived(
		Array.from({ length: hourSubdivisions - 1 }, (_, i) => {
			const minute = ((i + 1) * 60) / hourSubdivisions;
			return { fraction: minute / 60, label: `${minute}`.padStart(2, '0') };
		}),
	);
	let dayHeight = $derived((win.endMin - win.startMin) * pxPerMinute);
	/** Minutes since midnight → pixels from the top of the grid. */
	let yOf = $derived((minutes: number) => (minutes - win.startMin) * pxPerMinute);

	let columnsEl = $state<HTMLElement | null>(null);
	let scrollEl = $state<HTMLElement | null>(null);

	// The window is derived from the blocks on screen, so a flush that adds an
	// early row moves every block down. Hold the same minute at the top edge, or
	// the user ends up looking at a different time BECAUSE nothing scrolled.
	// Declared before the scroll-request effect so a real Today request wins.
	let lastWinStart = -1;
	$effect(() => {
		const startMin = win.startMin;
		const height = dayHeight;
		if (!scrollEl) return;
		const prev = lastWinStart;
		lastWinStart = startMin;
		if (prev < 0 || prev === startMin) return;
		const el = scrollEl;
		untrack(() => {
			el.scrollTop = scrollTopAfterWindowShift(
				el.scrollTop,
				prev,
				startMin,
				settings.hourHeightPx,
				el.clientHeight,
				height,
			);
		});
	});

	// Scroll only when asked (mount, or a Today/command request) — never on a data
	// rebuild, which would yank the view while the user is reading it.
	let lastScrollSeq = -1;
	$effect(() => {
		const req = scrollRequest;
		if (!scrollEl || req.seq === lastScrollSeq) return;
		lastScrollSeq = req.seq;
		const minutes = req.at === 'now' ? minutesOfDay(Date.now()) : settings.dayStartHour * 60;
		scrollEl.scrollTop = scrollTopFor(
			Math.max(0, minutes - win.startMin),
			settings.hourHeightPx,
			scrollEl.clientHeight,
			dayHeight,
		);
	});

	// ── Zoom ──────────────────────────────────────────────────────────────
	/**
	 * One zoom step, holding whatever sits `anchorOffsetPx` down the viewport
	 * exactly where it is. Rescaling without this makes the grid appear to jump
	 * to a different time BECAUSE nothing scrolled.
	 */
	let zoomSeq = 0;
	/** Where the grid is being driven while an earlier notch's render is pending. */
	let zoomTarget: number | null = null;

	async function zoomBy(direction: 1 | -1, anchorOffsetPx: number): Promise<void> {
		const prev = settings.hourHeightPx;
		const next = nextHourHeight(prev, direction);
		if (next === prev) return;
		const el = scrollEl;
		// Chain off the position the previous notch is ABOUT to write, not the one
		// on screen: a fast wheel spin interleaves, and reading the stale scrollTop
		// made the two notches compound into a jump to a time nobody scrolled to.
		const from = zoomTarget ?? el?.scrollTop ?? 0;
		const target = el
			? scrollTopAfterZoom(
					from,
					anchorOffsetPx,
					prev,
					next,
					el.clientHeight,
					(win.endMin - win.startMin) * (next / 60),
				)
			: null;
		zoomTarget = target;
		const seq = ++zoomSeq;
		await actions.setHourHeight(next);
		// The settings store publishes synchronously; wait for the render it
		// schedules, or scrollTop is clamped against the OLD content height.
		await tick();
		if (seq !== zoomSeq) return; // a later notch owns the scroll now
		zoomTarget = null;
		if (el && target !== null) el.scrollTop = target;
	}

	/** A button has no pointer to zoom around, so it holds the middle of the view. */
	function zoomFromCentre(direction: 1 | -1): void {
		void zoomBy(direction, scrollEl ? scrollEl.clientHeight / 2 : 0);
	}

	// Attached by hand rather than with `onwheel`, so `{ passive: false }` is
	// guaranteed: without preventDefault, Ctrl-scroll zooms the whole Obsidian
	// window and the grid never sees the gesture.
	$effect(() => {
		const el = scrollEl;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			if (e.deltaY === 0) return;
			void zoomBy(e.deltaY < 0 ? 1 : -1, e.clientY - el.getBoundingClientRect().top);
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	let byKey = $derived(
		new Map(columns.flatMap((c) => [...c.blocks.timed, ...c.blocks.allDay]).map((b) => [b.key, b.event])),
	);

	let gridEl = $state<HTMLElement | null>(null);

	// The header and all-day rows sit OUTSIDE the scroller, so a visible scrollbar
	// makes them wider than the columns below and every day header drifts left of
	// its column. `scrollbar-gutter: stable` keeps that width constant; mirror it
	// as padding on those rows. Measured, because it is 0 with overlay scrollbars.
	$effect(() => {
		void days;
		void dayHeight;
		if (!scrollEl || !gridEl) return;
		gridEl.style.setProperty('--tn-sbw', `${scrollEl.offsetWidth - scrollEl.clientWidth}px`);
	});
	/** An empty all-day lane must not reserve space or draw a border. */
	let hasAllDay = $derived(columns.some((c) => c.blocks.allDay.length > 0));

	// ── The all-day lane ──────────────────────────────────────────────────
	// Nothing is ever hidden behind a "+N more": the lane fits its chips and
	// scrolls once it runs out of room. How much room it gets is measured
	// against the PANE, not the window — a `vh` cap could not shrink when the
	// pane was split, so the lane kept its full height and squeezed the grid.
	// An AUTOMATIC lane is sized by CSS: `height: auto` under `--tn-lane-max`.
	// Nothing measures its content. It used to, on the very element it had just
	// given a height to — and `scrollHeight >= clientHeight` always, so a dragged
	// lane reported its own height as its content, "fit to its items" became a
	// no-op, and the button then hid itself. The measurement was the bug.
	let allDayEl = $state<HTMLElement | null>(null);
	let panePx = $state(0);

	$effect(() => {
		const pane = gridEl;
		if (!pane) return;
		const measure = () => {
			// Written inside untrack: this comes from the DOM, and reacting to our
			// own write would spin the effect against the ResizeObserver.
			untrack(() => (panePx = pane.clientHeight));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(pane);
		return () => ro.disconnect();
	});

	// Published to CSS so the lane's cap and an expanded block's ceiling are both
	// shares of the PANE. `vh` is the window, which a split pane cannot shrink.
	$effect(() => {
		gridEl?.style.setProperty('--tn-lane-max', `${laneMaxPx(panePx)}px`);
		gridEl?.style.setProperty('--tn-lane-min', `${LANE_MIN_PX}px`);
		gridEl?.style.setProperty('--tn-pane-h', `${panePx}px`);
	});

	/**
	 * Drag the divider between the lane and the grid.
	 *
	 * Held in a plain `let` like the chip gesture: the drag must not depend on
	 * render timing, and pointer capture is taken on the grid root, which never
	 * unmounts, rather than on the handle. `pointerId` is what keeps a second
	 * finger's events from being read as this gesture's.
	 */
	let laneDrag: { pointerId: number; fromY: number; fromHeight: number } | null = null;
	/** Reactive mirror of the gesture, for the divider's own styling only. */
	let laneDragging = $state(false);

	function onLaneResizeDown(e: PointerEvent): void {
		if (e.button !== 0 || laneDrag || allDayGesture || drag) return;
		// From the RENDERED height, so dragging out of the automatic state is
		// continuous rather than jumping to a default.
		laneDrag = {
			pointerId: e.pointerId,
			fromY: e.clientY,
			fromHeight: allDayEl?.offsetHeight ?? LANE_DEFAULT_PX,
		};
		laneDragging = true;
		gridEl?.setPointerCapture?.(e.pointerId);
		e.preventDefault();
		e.stopPropagation();
	}

	function endLaneResize(e: PointerEvent): void {
		if (!ownsPointer(laneDrag, e)) return;
		laneDrag = null;
		laneDragging = false;
	}

	function onLaneResizeMove(e: PointerEvent): void {
		if (!ownsPointer(laneDrag, e)) return;
		laneHeight = clampLaneHeight(laneDrag.fromHeight + (e.clientY - laneDrag.fromY), panePx);
	}

	/** Double-click the divider to hand the height back to the content. */
	function resetLaneHeight(): void {
		laneHeight = null;
	}

	// ── Drag state ────────────────────────────────────────────────────────
	type Mode = 'move' | 'resize' | 'create';
	interface Drag {
		/** The pointer that started it: a second finger must not drive this drag. */
		pointerId: number;
		mode: Mode;
		eventKey: string | null;
		originStart: number;
		originEnd: number;
		originDayIndex: number;
		grabOffset: number; // minutes between pointer and block start (move)
		dayIndex: number;
		curStart: number;
		curEnd: number;
		/**
		 * The lane column the pointer is currently over, or null for the timed
		 * grid. Set = "dropping here makes this an all-day item".
		 */
		toLaneDay: number | null;
		/**
		 * grabOffset was measured with the PRE-drag layout. Starting a move mounts
		 * the all-day lane (it is the drop target), which pushes the grid down —
		 * so the first pointermove re-measures against the settled layout. Without
		 * this, at 60px/h a 1-pixel twitch wrote a 30-minute move nobody made.
		 */
		offsetSettled: boolean;
		/**
		 * Has the pointer been OUTSIDE the all-day lane since this drag began?
		 *
		 * The lane is the drop target for "make this all-day", and starting a move
		 * on a day with no all-day items MOUNTS it — which pushes the grid down
		 * ~30px under a pointer that has not moved. A block near the top of the
		 * scroller therefore ends up under the lane by itself, and the release
		 * wrote the line untimed: a 09:00 block silently lost its time.
		 *
		 * Click-slop does not cover this. Slop is 4px (mouse); the layout shift is
		 * ~30px, so any twitch past 4px stops the gesture looking like a click
		 * while the pointer is still sitting where it always was.
		 *
		 * So the lane must be ENTERED, not merely arrived under: it is ignored
		 * until the pointer has been seen outside it at least once. Dragging
		 * upward into the lane sets this on the first move and behaves exactly as
		 * before.
		 */
		laneArmed: boolean;
		/** Where the press landed, for the click-slop tests below. */
		from: Point;
	}
	let drag = $state<Drag | null>(null);
	/**
	 * The lane shows while a block is being moved even when it is empty: it is the
	 * drop target for "make this all-day", and on exactly the days that have no
	 * all-day items yet there would otherwise be nothing to aim at.
	 */
	let laneVisible = $derived(hasAllDay || drag?.mode === 'move');
	let lastUp = { id: '', ts: 0 };

	/**
	 * An all-day chip being dragged down onto the grid to give it a time.
	 *
	 * Held in a PLAIN let, not $state: the gesture must not depend on Svelte
	 * re-render timing, on `pointerup` vs `lostpointercapture` ordering, or on the
	 * chip surviving an index rebuild mid-drag. Only the ghost preview is reactive.
	 */
	let allDayGesture: { pointerId: number; key: string; originDay: string; from: Point } | null = null;
	let allDayPreview = $state<{ dayIndex: number; start: number } | null>(null);
	/**
	 * The lane column a dragged CHIP is hovering, or null.
	 *
	 * The lane already highlighted while dragging a timed block into it, but not
	 * while dragging a chip from one day's lane to another's — so the one gesture
	 * that is entirely within the lane was the one with no drop target shown.
	 */
	let chipLaneDay = $state<number | null>(null);
	/** Reactive mirror of the gesture, for the drag styling only. */
	let draggingChip = $state<{ key: string; day: string } | null>(null);

	function onAllDayPointerDown(e: PointerEvent, item: AllDayItem) {
		if (e.button !== 0) return;
		if (item.event.kind === 'remote') return; // remote entries are read-only
		allDayGesture = { pointerId: e.pointerId, key: item.key, originDay: item.dayKey, from: { x: e.clientX, y: e.clientY } };
		allDayPreview = null;
		draggingChip = { key: item.key, day: item.dayKey };
		// Capture on the grid root, which never unmounts — capturing on the chip
		// loses the gesture the moment an index rebuild replaces it.
		gridEl?.setPointerCapture?.(e.pointerId);
		e.preventDefault();
	}

	/**
	 * Abandon the chip gesture completely. Clearing only the preview left the
	 * gesture armed, so the next pointerup anywhere on the grid performed a move.
	 * `lostpointercapture` fires after `pointerup`, which has already taken the
	 * gesture into a local, so a normal drop is unaffected.
	 */
	function endAllDayGesture(e: PointerEvent): void {
		if (!ownsPointer(allDayGesture, e)) return;
		allDayGesture = null;
		allDayPreview = null;
		chipLaneDay = null;
		draggingChip = null;
	}

	function onAllDayPointerMove(e: PointerEvent) {
		if (!ownsPointer(allDayGesture, e)) return;
		const hit = pointerDay(e.clientX, e.clientY);
		allDayPreview = hit
			? { dayIndex: hit.index, start: snap(pointerMinutes(e.clientY), settings.snapMinutes) }
			: null;
		// Only ANOTHER day's lane: dropping back on the origin is a click, not a
		// move, so highlighting it would promise a write that never happens.
		const lane = hit ? null : pointerLane(e.clientX, e.clientY);
		chipLaneDay = lane && lane.key !== allDayGesture?.originDay ? lane.index : null;
	}

	async function onAllDayPointerUp(e: PointerEvent) {
		// A second finger's pointerup must not end — or act on — this gesture.
		if (!ownsPointer(allDayGesture, e)) return;
		const gesture = allDayGesture;
		allDayGesture = null;
		allDayPreview = null;
		chipLaneDay = null;
		draggingChip = null;
		if (!gesture) return;

		const ev = byKey.get(gesture.key);
		if (!ev || ev.kind === 'remote') return;

		const hit = pointerDay(e.clientX, e.clientY);
		if (hit) {
			// Relative move: a multi-day chip grabbed on its 3rd day and dropped one
			// column right shifts the whole event by one day — it does not teleport.
			const newDate = chipDropDate(ev.date, gesture.originDay, hit.key);
			// Inside the drawn window, keeping its LENGTH: a drop near the bottom
			// slides the block up rather than writing a shorter event than asked for.
			const { start, end } = fitBlockInWindow(
				win,
				snap(pointerMinutes(e.clientY), settings.snapMinutes),
				settings.defaultEventDurationMinutes,
			);
			await actions.applyBlockEdit(ev, newDate, start, end);
			return;
		}

		// Dropped on another day's all-day lane: move the day, keep it untimed.
		const lane = pointerLane(e.clientX, e.clientY);
		if (lane && lane.key !== gesture.originDay) {
			await actions.applyBlockEdit(ev, chipDropDate(ev.date, gesture.originDay, lane.key), null, null);
			return;
		}

		// Released off the grid. Only a barely-moved gesture counts as a click —
		// this is the click detection the chip's old `onclick` did wrongly, since
		// preventDefault on pointerdown does NOT suppress `click`.
		if (isClickGesture(gesture.from, { x: e.clientX, y: e.clientY }, e.pointerType))
			actions.openEvent(ev);
	}

	function pointerMinutes(clientY: number): number {
		if (!columnsEl) return win.startMin;
		const rect = columnsEl.getBoundingClientRect();
		const y = clientY - rect.top;
		// Inverse of `yOf`: the grid may start at 07:00, so pixel 0 is not midnight.
		return clamp(win.startMin + y / pxPerMinute, win.startMin, win.endMin);
	}

	/**
	 * Which day column is under the pointer, by hit-testing the DOM.
	 *
	 * Arithmetic on `columnsEl`'s rect drifts: `.tn-columns` sits inside the
	 * scrollable body (so it loses the scrollbar's width) while the header rows do
	 * not, which made the right edge of a column resolve to the NEXT day — the
	 * "jumps to a new day" bug, and a silent cross-day move on a mere click.
	 * Returns null when the pointer is off the grid; callers keep their last value
	 * rather than snapping to day 0.
	 */
	function pointerDay(clientX: number, clientY: number): { index: number; key: string } | null {
		const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-column]');
		// Scoped to the TIMED grid. The all-day lane also carries data-column now
		// (for dayAt), and without this containment a pointer over the lane
		// resolved as a day hit — which made a plain click on an all-day chip take
		// the timed-drop branch: a 00:00 planner line and a rename, from a click.
		if (!el || !columnsEl?.contains(el)) return null;
		// Through dayAt, like every other read of a data-column.
		return dayAt(el.getAttribute('data-column'), days);
	}

	/**
	 * The all-day lane column under the pointer.
	 *
	 * Scoped to THIS grid, and matched on `[data-lane]` rather than `[data-daykey]`:
	 * the sidebar calendar is a sibling of this component and emits data-daykey on
	 * every one of its cells, so releasing a chip over the rail used to resolve a
	 * date from the MONTH grid and silently move the event to another month.
	 */
	function pointerLane(clientX: number, clientY: number): { index: number; key: string } | null {
		const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-lane]');
		if (!el || !gridEl?.contains(el)) return null;
		return dayAt(el.getAttribute('data-column'), days);
	}

	function eventAt(target: HTMLElement): TaskEvent | null {
		const blockEl = target.closest<HTMLElement>('[data-block-key]');
		const key = blockEl?.getAttribute('data-block-key');
		return key ? byKey.get(key) ?? null : null;
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return; // right/middle click must never start a drag or write
		if (drag || laneDrag || allDayGesture) return; // one gesture at a time
		const target = e.target as HTMLElement;
		if (target.closest('[data-badge]')) return; // badge buttons act on click, not drag
		const blockEl = target.closest<HTMLElement>('[data-block-key]');
		// The press's own target knows its column; elementFromPoint is only needed
		// once pointer capture has retargeted the moves. Never guess day 0 — that
		// makes a motionless click report "moved" and perform a cross-day write.
		const hit = dayAt(target.closest<HTMLElement>('[data-column]')?.getAttribute('data-column') ?? null, days);
		if (!hit) return;
		const dayIndex = hit.index;
		const rawMin = pointerMinutes(e.clientY);

		if (blockEl) {
			const key = blockEl.getAttribute('data-block-key')!;
			const ev = byKey.get(key);
			if (!ev || ev.kind === 'remote') return; // remote blocks are read-only
			const block = columns[dayIndex]?.blocks.timed.find((b) => b.key === key) ?? findBlock(key);
			if (!block) return;
			// A block running past midnight is drawn to the day edge; its geometry is
			// not its real duration, so dragging it would destroy the user's end time.
			if (!block.draggable) return;
			const isResize = !!target.closest('[data-handle="end"]');
			// Snap the origin the same way pointermove snaps the current values —
			// comparing a snapped value against an unsnapped one would report
			// "moved" for a motionless click on any block not already on a boundary.
			const step = settings.snapMinutes;
			const originStart = snap(block.startMin, step);
			const originEnd = isResize ? snap(block.endMin, step) : originStart + (block.endMin - block.startMin);
			drag = {
				pointerId: e.pointerId,
				mode: isResize ? 'resize' : 'move',
				eventKey: key,
				originStart,
				originEnd,
				originDayIndex: dayIndex,
				grabOffset: rawMin - originStart,
				dayIndex,
				curStart: originStart,
				curEnd: originEnd,
				toLaneDay: null,
				offsetSettled: false,
				// A day that already HAS all-day items did not mount the lane for
				// this drag, so nothing shifted and the lane is a target at once.
				laneArmed: hasAllDay,
				from: { x: e.clientX, y: e.clientY },
			};
		} else if (target.closest('[data-column]')) {
			const start = snap(rawMin, settings.snapMinutes);
			drag = {
				pointerId: e.pointerId,
				mode: 'create',
				eventKey: null,
				originStart: start,
				originEnd: start + settings.defaultEventDurationMinutes,
				originDayIndex: dayIndex,
				grabOffset: 0,
				dayIndex,
				curStart: start,
				curEnd: start + settings.defaultEventDurationMinutes,
				toLaneDay: null,
				// Create never mounts the lane, so its layout cannot shift.
				offsetSettled: true,
				laneArmed: true,
				from: { x: e.clientX, y: e.clientY },
			};
		} else {
			return;
		}
		// Capture on the container: a block removed mid-drag (index rebuild) would
		// otherwise strand the gesture with no pointerup.
		columnsEl?.setPointerCapture?.(e.pointerId);
		e.preventDefault();
	}

	function findBlock(key: string): TimedBlock | undefined {
		for (const c of columns) {
			const b = c.blocks.timed.find((x) => x.key === key);
			if (b) return b;
		}
		return undefined;
	}

	function onPointerMove(e: PointerEvent) {
		if (!ownsPointer(drag, e)) return;
		// Dragging an expanded block would drag overlay geometry: collapse it first.
		expandedKey = null;
		const rawMin = pointerMinutes(e.clientY);
		const step = settings.snapMinutes;
		if (drag.mode === 'move') {
			// Over the all-day lane = "make this all-day". Checked before the column
			// so the lane wins where they overlap. The lane day lives ONLY in
			// toLaneDay — writing it into dayIndex let a drag that later left the
			// grid commit a cross-day move to a day the pointer only skimmed.
			//
			// NOT UNTIL THE GESTURE LEAVES SLOP. The lane MOUNTS because this drag
			// started (`laneVisible` reads `drag.mode === 'move'`), which drops the
			// grid ~30px under a pointer that has not moved — so a plain click on a
			// block near the top of the scroller ended up inside the lane, and the
			// release below took the lane branch without ever testing for a click.
			// Clicking a 09:00 block silently stripped its time. Slop is 4px (mouse)
			// / 12px (touch), far below the shift, so a deliberate drag still lands.
			// The RAW geometry first, and arm off that — not off the slop test. Both
			// "still a click" and "outside the lane" produce a null lane, so arming
			// on the combined result would arm during the slop window, while the
			// pointer is sitting motionless under the freshly mounted lane. The
			// latch has to mean "the pointer was really somewhere else".
			const rawLane = pointerLane(e.clientX, e.clientY);
			if (!rawLane) drag.laneArmed = true;
			const lane =
				drag.laneArmed && !isClickGesture(drag.from, { x: e.clientX, y: e.clientY }, e.pointerType)
					? rawLane
					: null;
			drag.toLaneDay = lane?.index ?? null;
			if (lane) return;
			if (!drag.offsetSettled) {
				// Re-anchor against the layout as it is NOW: starting a move mounts
				// the all-day lane (it is the drop target), which pushes the grid
				// down, so the offset measured at pointerdown is against a layout
				// that no longer exists. At 60px/hour a 1-pixel twitch was writing a
				// 30-minute move nobody made.
				//
				// AFTER the lane check, deliberately. pointerMinutes clamps to the
				// grid, so re-anchoring while the pointer is over the lane would
				// latch a clamped, meaningless offset — and then the block would
				// jump the moment the pointer came back down.
				drag.grabOffset = pointerMinutes(e.clientY) - drag.originStart;
				drag.offsetSettled = true;
			}
			// Keep the previous column when the pointer leaves the grid horizontally,
			// instead of snapping to day 0.
			drag.dayIndex = pointerDay(e.clientX, e.clientY)?.index ?? drag.dayIndex;
			const dur = drag.originEnd - drag.originStart;
			const fitted = fitBlockInWindow(win, snap(rawMin - drag.grabOffset, step), dur);
			drag.curStart = fitted.start;
			drag.curEnd = fitted.end;
		} else {
			let end = snap(rawMin, step);
			end = clamp(end, drag.originStart + step, win.endMin);
			drag.curEnd = end;
		}
	}

	async function onPointerUp(e: PointerEvent) {
		if (!ownsPointer(drag, e)) return;
		const d = drag;
		drag = null;
		const targetDay = days[d.dayIndex];
		if (targetDay == null) {
			actions.notify('the timeline changed mid-drag — nothing was moved.');
			return;
		}

		if (d.mode === 'create') {
			await actions.createBlock(targetDay, d.curStart, d.curEnd);
			return;
		}
		if (!d.eventKey) return;
		const ev = byKey.get(d.eventKey);
		if (!ev || ev.kind === 'remote') return;

		// Dropped in the all-day lane: the item keeps its day and loses its time.
		// `applyBlockEdit` already treats null start/end as "untimed", and
		// serializePlannerLine already writes that shape — no new write path.
		// The same slop test again at the release: this branch runs BEFORE `moved`,
		// so it is the one place a click could still commit a write.
		if (d.toLaneDay != null && !isClickGesture(d.from, { x: e.clientX, y: e.clientY }, e.pointerType)) {
			const laneDay = days[d.toLaneDay];
			if (laneDay) await actions.applyBlockEdit(ev, laneDay, null, null);
			return;
		}

		const moved =
			d.curStart !== d.originStart ||
			d.curEnd !== d.originEnd ||
			d.dayIndex !== d.originDayIndex;

		if (moved) {
			await actions.applyBlockEdit(ev, targetDay, d.curStart, d.curEnd);
			return;
		}

		// No movement = a click. Detect the double-click ourselves: preventDefault on
		// pointerdown suppresses the compatibility mouse events dblclick relies on.
		if ((e.ctrlKey || e.metaKey) && ev.kind === 'local') {
			void actions.openPlacement(ev, false);
			return;
		}

		const isDouble = lastUp.id === d.eventKey && e.timeStamp - lastUp.ts < DOUBLE_CLICK_MS;
		lastUp = isDouble ? { id: '', ts: 0 } : { id: d.eventKey, ts: e.timeStamp };
		if (isDouble) {
			// The first click of the pair expanded it; opening the note supersedes that.
			expandedKey = null;
			actions.openEvent(ev);
			return;
		}
		// A single click opens the block up over its neighbours, so a busy hour can
		// be read and ticked through at any zoom level. One at a time.
		if (ev.kind === 'local' && ev.body) expandedKey = expandedKey === d.eventKey ? null : d.eventKey;
	}

	function onContextMenu(e: MouseEvent) {
		const ev = eventAt(e.target as HTMLElement);
		if (!ev) return;
		e.preventDefault();
		e.stopPropagation();
		actions.showEventMenu(ev, e);
	}

	function onBlockKeyDown(e: KeyboardEvent, ev: TaskEvent, blockId?: string): void {
		// A control inside the block handles its own keys; preventDefault() below
		// would otherwise cancel the native checkbox toggle.
		if ((e.target as HTMLElement).closest('[data-badge]')) return;
		if (e.key === 'Escape' && expandedKey) {
			expandedKey = null;
			return;
		}
		if (e.key === ' ' && blockId && ev.kind === 'local' && ev.body) {
			e.preventDefault();
			expandedKey = expandedKey === blockId ? null : blockId;
			return;
		}
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		if (ev.kind === 'local') actions.openEvent(ev);
	}

	function needleTop(): number | null {
		if (days.indexOf(today) < 0) return null;
		// Outside the drawn window there is nowhere honest to put it.
		if (nowMinutes < win.startMin || nowMinutes > win.endMin) return null;
		return yOf(nowMinutes);
	}

	/**
	 * What each block draws: the rows that fit when collapsed, all of them when
	 * expanded, and how many are left over.
	 *
	 * One derived map rather than two functions calling each other: the template
	 * asks three times per block, and each ask used to re-filter the body — five
	 * passes over every block's rows on every render.
	 */
	let rowPlan = $derived.by(() => {
		const plan = new Map<string, { rows: BodyRow[]; hidden: number }>();
		for (const c of columns) {
			for (const b of c.blocks.timed) {
				const ev = b.event;
				if (ev.kind !== 'local' || !ev.body) continue;
				const all = settings.showCheckedBlocks ? ev.body : ev.body.filter((r) => !isChecked(r.line));
				const rows =
					expandedKey === b.key
						? all.slice(0, MAX_EXPANDED_ROWS)
						: all.slice(
								0,
								visibleRowCount(
									all.length,
									Math.floor(((b.endMin - b.startMin) * pxPerMinute - HEAD_PX) / ROW_PX),
									MAX_COLLAPSED_ROWS,
								),
							);
				// Keyed by the BLOCK, not the event: one multi-day event draws a block
				// per day with different geometry, so `id` made the last day's row
				// budget overwrite the first's — rows silently clipped, and the
				// "+N more" count computed for the wrong height.
				plan.set(b.key, { rows, hidden: all.length - rows.length });
			}
		}
		return plan;
	});

	function visibleRows(b: TimedBlock): BodyRow[] {
		return rowPlan.get(b.key)?.rows ?? [];
	}

	function hiddenRows(b: TimedBlock): number {
		return rowPlan.get(b.key)?.hidden ?? 0;
	}

	/** A body row addresses its own line; its block's line scopes the lookup. */
	function rowTarget(ev: LocalEvent, row: BodyRow): LineTarget | null {
		if (!ev.placement) return null;
		return { dailyNotePath: ev.placement.dailyNotePath, lineNo: row.line.lineNo, raw: row.line.raw };
	}

	function toggleRow(ev: LocalEvent, row: BodyRow, next: boolean): void {
		const target = rowTarget(ev, row);
		if (!target || !ev.placement) return;
		void actions.setLineChecked(target, next, ev.placement);
	}

	/** A remote event is read-only: ticking it hides it HERE and nowhere else. */
	function toggleRemote(ev: RemoteEvent, next: boolean): void {
		void actions.setRemoteHidden(ev, next);
	}

	function toggleBlock(ev: LocalEvent, next: boolean): void {
		if (!ev.placement) return;
		void actions.setLineChecked(ev.placement, next);
	}

	function blockLabel(b: TimedBlock): string {
		return `${minutesToColon(b.startMin)}–${minutesToColon(b.endMin)}`;
	}

	function blockAria(b: TimedBlock): string {
		const ev = b.event;
		const count = ev.kind === 'local' && ev.bodyProgress ? `, ${ev.bodyProgress.done} of ${ev.bodyProgress.total} done` : '';
		return ev.title ? `${ev.title}, ${blockLabel(b)}${count}` : `${blockLabel(b)}${count}`;
	}

	/**
	 * A day header says exactly what its note is called — `2026-08-11`, not a
	 * second date format invented for the header. `dayFormat` is the core Daily
	 * Notes naming format, so the two can never disagree.
	 */
	function dayLabel(key: string): string {
		return dayNoteLabel(key, dayFormat);
	}

	/**
	 * What the note button will do, said out loud.
	 *
	 * Creating a daily note is a write, so the control never hides which one it
	 * is: a filled page means the note exists, an outlined page with a `+` means
	 * the menu's first item would create it. This says so in words for anyone
	 * who cannot see the difference between two glyphs.
	 */
	/**
	 * What a click on a day header means, from the SHARED rule rather than a
	 * hand-rolled copy of half of it — this header honoured only Ctrl/Cmd, so
	 * Ctrl+Shift silently opened in the same tab and Alt did nothing.
	 */
	function onDayHeaderClick(key: string, e: MouseEvent): void {
		switch (dayIntent(e)) {
			case 'open':
				void actions.openDailyNote(key);
				return;
			case 'open-new-leaf':
				void actions.openDailyNote(key, true);
				return;
			// 'timeline' means "open the timeline at that day" — which is where you
			// already are, so here it is the same request as a plain click.
			default:
				onFocusDay(key);
		}
	}

	/**
	 * Open the day menu from the note button.
	 *
	 * Enter and Space on a `<button>` fire a click with `detail: 0` and coordinates
	 * of (0, 0). `showAtMouseEvent` reads those coordinates, so the keyboard route
	 * would drop the menu in the top-left corner of the screen while the mouse
	 * route put it under the pointer. Fall back to the button's own box.
	 */
	function openDayMenu(key: string, e: MouseEvent): void {
		if (e.detail !== 0) {
			actions.showDayMenu(key, e);
			return;
		}
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		actions.showDayMenu(
			key,
			new MouseEvent('click', {
				clientX: rect.left,
				clientY: rect.bottom,
				view: (e.currentTarget as HTMLElement).ownerDocument.defaultView,
			}),
		);
	}

	/**
	 * Render one line of Markdown and hand its resource cleanup to the Svelte
	 * attachment. An unchanged keyed node keeps its attachment across ordinary
	 * grid redraws, so zoom and clock ticks do not restart the asynchronous work.
	 */
	function renderMarkdownInto(node: HTMLElement, text: string, sourcePath = ''): (() => void) | void {
		node.dataset.tnMd = text;
		// The note the text came from, so a [[wikilink]] in a planner line resolves
		// the way it does in that note rather than from the vault root.
		return actions.renderMarkdown(node, text, sourcePath);
	}

	function noteAria(key: string): string {
		const name = dayLabel(key);
		return dayHasNote.has(key)
			? `Daily note for ${name} — open it, open it in a new tab, or apply the template`
			: `No daily note for ${name} yet — create and open it, here or in a new tab`;
	}

	function classesFor(b: TimedBlock, overlapping: boolean, dayKey: string): string {
		const ev = b.event;
		let cls = ev.kind === 'remote' ? 'tn-block tn-block-remote' : 'tn-block';
		if (b.key === expandedKey) cls += ' tn-block-expanded';
		// A block that owns a list is a container, and reads as one: its own line
		// bold at full strength, its rows indented and dimmed underneath.
		if (ev.kind === 'local' && ev.body) cls += ' tn-block-has-body';
		// The one block you are actually in. Derived from nowMinutes, which only
		// changes on the 30s tick, so this does not churn on every render.
		if (isHappeningNow(b, dayKey, today, nowMinutes)) cls += ' tn-block-now';
		// Too short to spend a line on `10:00–11:00`, which its own position and
		// height already state. The title gets that space instead — so only when
		// there IS a title: the index deliberately leaves a block title-less when
		// its text lives in its body rows, and hiding the time there would leave
		// the head completely empty.
		if (ev.title && !showsTimeLabel((b.endMin - b.startMin) * pxPerMinute))
			cls += ' tn-block-tight';
		// Two things at once is a rule you keep, so it is marked — a thin warning
		// edge along the top, not the full-height stripe this used to be.
		if (overlapping) cls += ' tn-block-overlap';
		if (b.crossesMidnight) cls += ' tn-block-wrap';
		if (b.continuesBefore) cls += ' tn-block-from-before';
		if (b.continuesAfter) cls += ' tn-block-into-next';
		// One predicate for "done", the same one the chips and the visibility filter
		// use — this used to be split across the two branches below and drift was
		// only a matter of time.
		if (isEventDone(ev, hiddenRemote)) cls += ' tn-block-done';
		if (ev.kind === 'remote') return cls;
		if (!ev.linked) cls += ' tn-block-unlinked';
		if (ev.duplicate) cls += ' tn-block-dup';
		return cls;
	}

	/** Tooltip explaining every state a block can be in (the missing legend). */
	function blockTitle(b: TimedBlock, overlapping: boolean, dayKey: string): string {
		// Only the geometry is this view's to describe; the event's own states come
		// from the one place that knows them, so no two views can word them apart.
		return eventTitle(b.event, {
			hiddenRemote,
			extra: [
				!b.event.title && blockLabel(b),
				b.event.kind === 'local' &&
					b.event.body &&
					`${b.event.body.length} line${b.event.body.length === 1 ? '' : 's'} in this block`,
				b.crossesMidnight && 'Runs past midnight — edit the planner line directly',
				b.continuesBefore && b.continuesAfter
					? 'Runs all day — part of a longer event'
					: b.continuesBefore
						? 'Continues from the previous day'
						: b.continuesAfter && 'Continues into the next day',
				overlapping && 'Overlaps another block',
				isHappeningNow(b, dayKey, today, nowMinutes) && 'Happening now',
			],
		});
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="tn-grid"
	bind:this={gridEl}
	onpointermove={(e) => {
		onLaneResizeMove(e);
		onAllDayPointerMove(e);
	}}
	onpointerup={(e) => {
		endLaneResize(e);
		void onAllDayPointerUp(e);
	}}
	onpointercancel={(e) => {
		endLaneResize(e);
		endAllDayGesture(e);
	}}
	onlostpointercapture={(e) => {
		endLaneResize(e);
		endAllDayGesture(e);
	}}
>
	<div class="tn-header-row">
		<div class="tn-ruler-spacer tn-zoom">
			<button
				class="tn-zoom-btn"
				aria-label="Zoom out — shorter hours"
				title="Shorter hours · Ctrl/Cmd-scroll on the grid does the same"
				disabled={settings.hourHeightPx <= HOUR_HEIGHT_MIN}
				onclick={() => zoomFromCentre(-1)}
			>
				−
			</button>
			<button
				class="tn-zoom-btn"
				aria-label="Zoom in — taller hours"
				title="Taller hours · Ctrl/Cmd-scroll on the grid does the same"
				disabled={settings.hourHeightPx >= HOUR_HEIGHT_MAX}
				onclick={() => zoomFromCentre(1)}
			>
				+
			</button>
		</div>
		{#each columns as col (col.day)}
			{@const day = col.day}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="tn-day-cell"
				class:tn-today={day === today}
				oncontextmenu={(e) => {
					e.preventDefault();
					e.stopPropagation();
					actions.showDayMenu(day, e);
				}}
			>
				<button
					class="tn-day-header"
					title={`${dayLabel(day)} · click to zoom into this day · Ctrl/Cmd-click for its daily note`}
					onclick={(e) => onDayHeaderClick(day, e)}
				>
					<!-- Both render; a container query on the cell picks, so the choice
					     follows the COLUMN's width rather than the range or the pane. -->
					<span class="tn-day-long">{dayLabel(day)}</span>
					<span class="tn-day-short">{dayShortLabel(day)}</span>
				</button>
				<!-- Opens the day menu on a LEFT click. Those three actions used to be
				     reachable only by right-clicking the cell, which is not a gesture
				     anything on screen advertised. Right-click still works. -->
				<button
					class="tn-day-note"
					class:tn-has-note={dayHasNote.has(day)}
					aria-haspopup="menu"
					aria-label={noteAria(day)}
					title={noteAria(day)}
					onclick={(e) => openDayMenu(day, e)}
				>
					<Icon name={dayHasNote.has(day) ? 'file-text' : 'file-plus'} size={14} strokeWidth={2} />
					<!-- Hidden by a container query once the column is too narrow to
					     spend width on it; the button still opens the same menu. -->
					<span class="tn-day-note-caret" aria-hidden="true">
						<Icon name="chevron-down" size={10} strokeWidth={2.5} />
					</span>
				</button>
			</div>
		{/each}
	</div>

	{#if laneVisible}
		<div
			class="tn-allday-row"
			style:height={laneHeight === null ? null : `${clampLaneHeight(laneHeight, panePx)}px`}
			bind:this={allDayEl}
		>
			<div class="tn-ruler-spacer tn-allday-label">
				<!-- Two labels, one shown — the same pattern the day headers use. At the
				     default 52px ruler "ALL DAY" needed ~55px and was clipped to "ALL …". -->
				<span class="tn-allday-title tn-allday-long">All day</span>
				<span class="tn-allday-title tn-allday-short">Day</span>
				{#if laneHeight !== null}
					<button
						class="tn-allday-toggle"
						title="Fit the lane to its items"
						aria-label="Fit the all-day lane to its items"
						onclick={resetLaneHeight}
					>
						<Icon name="chevron-up" size={12} strokeWidth={2.5} />
					</button>
				{/if}
			</div>
			{#each columns as col, i (col.day)}
				{@const day = col.day}
				<!-- `data-column` as well as `data-daykey`: the index is what dayAt
				     validates, and it is how the lane hit-test tells a real lane column
				     apart from the sidebar calendar, which also emits data-daykey. -->
				<div
					class="tn-allday-col"
					class:tn-lane-target={(drag?.mode === 'move' && drag.toLaneDay === i) ||
						chipLaneDay === i}
					data-daykey={day}
					data-column={i}
					data-lane="1"
				>
					{#each col.blocks.allDay as item (item.key)}
						<EventChip
							event={item.event}
							variant="allday"
							{hiddenRemote}
							renderMarkdown={actions.renderMarkdown}
							showCloud
							onConvertRemote={actions.convertRemote}
							dragging={draggingChip?.key === item.key && draggingChip?.day === item.dayKey}
							data-chip-key={item.key}
							onSetChecked={(ev, next) => toggleBlock(ev, next)}
							onSetRemoteHidden={(ev, next) => toggleRemote(ev, next)}
							title={eventTitle(item.event, { hiddenRemote, draggableToGrid: true })}
							onpointerdown={(e: PointerEvent) => onAllDayPointerDown(e, item)}
							onkeydown={(e: KeyboardEvent) => onBlockKeyDown(e, item.event)}
							oncontextmenu={(e: MouseEvent) => {
								e.preventDefault();
								e.stopPropagation();
								actions.showEventMenu(item.event, e);
							}}
						/>
					{/each}
				</div>
			{/each}
		</div>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="tn-lane-resize"
			class:tn-dragging={laneDragging}
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize the all-day lane"
			title="Drag to resize the all-day lane · double-click to fit its items"
			onpointerdown={onLaneResizeDown}
			ondblclick={resetLaneHeight}
		></div>
	{/if}

	<div class="tn-scroll" bind:this={scrollEl}>
		<div class="tn-body" style:height={`${dayHeight}px`} style:--tn-hour-h={`${settings.hourHeightPx}px`}>
			<div class="tn-ruler">
				{#each HOURS as h}
					<div class="tn-hour">
						<span>{`${h}`.padStart(2, '0')}:00</span>
						{#each subLabels as sub}
							<span class="tn-hour-sub" style:top={`${sub.fraction * 100}%`}>
								{`${h}`.padStart(2, '0')}:{sub.label}
							</span>
						{/each}
					</div>
				{/each}
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="tn-columns"
				aria-label="Time grid"
				bind:this={columnsEl}
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				oncontextmenu={onContextMenu}
				onpointercancel={(e) => ownsPointer(drag, e) && (drag = null)}
				onlostpointercapture={(e) => ownsPointer(drag, e) && (drag = null)}
			>
				{#each columns as col, i (col.day)}
					{@const day = col.day}
					<div class="tn-col" data-column={i}>
						{#each HOURS as h}
							<div class="tn-hline" style:top={`${yOf(h * 60)}px`}></div>
							{#each subLabels as sub}
								<div
									class="tn-hline tn-hline-sub"
									style:top={`${yOf(h * 60 + sub.fraction * 60)}px`}
								></div>
							{/each}
						{/each}

						<!-- Keyed on the COMPOSED key, never the bare id: a duplicate id
						     makes Svelte throw each_key_duplicate mid-update, and an
						     uncaught throw silently freezes this DOM (see the boundary
						     around the grid). -->
						{#each col.blocks.timed as b (b.key)}
							{@const overlapping = col.blocks.overlapping.has(b.key)}
							<div
								class={classesFor(b, overlapping, day)}
								data-block-key={b.key}
								data-block-id={b.id}
								role="button"
								tabindex="0"
								aria-label={blockAria(b)}
								aria-expanded={b.event.kind === 'local' && b.event.body ? b.key === expandedKey : undefined}
								onkeydown={(e) => onBlockKeyDown(e, b.event, b.key)}
								style:top={`${yOf(b.startMin)}px`}
								style:height={`${(b.endMin - b.startMin) * pxPerMinute}px`}
								style:--tn-block-h={`${(b.endMin - b.startMin) * pxPerMinute}px`}
								style:left={`${b.left * 100}%`}
								style:width={`${b.width * 100}%`}
								style:--tn-block-color={b.event.kind === 'remote' && b.event.color ? b.event.color : null}
								title={blockTitle(b, overlapping, day)}
							>
								<div class="tn-block-head">
									{#if b.event.kind === 'remote'}
										{@const remote = b.event}
										<TaskCheck
											checked={hiddenRemote.has(remote.id)}
											label={`Hide "${remote.title}" from the timeline`}
											title="Hide this occurrence here — your calendar is not changed"
											onToggle={(next) => toggleRemote(remote, next)}
										/>
									{:else if b.event.kind === 'local' && b.event.placement}
										{@const localEvent = b.event}
										<TaskCheck
											checked={localEvent.checked}
											label={`Done: ${localEvent.title || blockLabel(b)}`}
											status={localEvent.checked ? 'x' : undefined}
											onToggle={(next) => toggleBlock(localEvent, next)}
										/>
									{/if}
									<span class="tn-block-time">{blockLabel(b)}</span>
									{#if b.event.title}
										{@const titleText = b.event.title}
										{@const source =
											b.event.kind === 'local'
												? (b.event.placement?.dailyNotePath ?? b.event.filePath ?? '')
												: ''}
										<!-- `markdown-rendered` is Obsidian's own class, and it is the
										     reason a highlight is visible at all: app.css styles `b`/`strong`
										     and `i`/`em` as BARE elements, but scopes `mark` to
										     `.markdown-rendered mark`. Without it `**bold**` worked and
										     `==highlight==` could never show. -->
										<!-- Plain text in the markup, so a title never depends on the
										     async renderer firing; the attachment upgrades it in place. -->
										<span
											class="tn-block-title markdown-rendered"
											{@attach (node: HTMLElement) => renderMarkdownInto(node, titleText, source)}
											>{titleText}</span
										>
									{/if}
									{#if b.event.kind === 'local' && b.event.bodyProgress}
										{@const p = b.event.bodyProgress}
										<span class="tn-block-count" title={`${p.done} of ${p.total} done`}>
											{p.done}/{p.total}
										</span>
									{/if}
									{#if b.event.kind === 'remote'}
										{@const remoteEvent = b.event}
										<!-- Drawn in currentColor, so it survives whatever colour the
										     calendar carries and the contrast foreground chosen for it. -->
										<span class="tn-remote-mark" title={`From ${remoteEvent.calendarName}`}>
											<Icon name="cloud" size={11} strokeWidth={2.5} />
										</span>
										<!-- The convert route, beside the glyph that says where this came
										     from. It existed only in the right-click menu, which is not a
										     route at all on a phone and was unreliable the moment anything
										     else went wrong. `data-badge` is load-bearing: it is what the
										     pointerdown and keydown guards look for to keep a press on this
										     button from starting a drag on the block under it. -->
										<button
											class="tn-block-badge"
											data-badge="convert"
											aria-label={`Create a task note from "${remoteEvent.title}"`}
											title="Create a task note from this event — your calendar is not changed"
											onpointerdown={(e) => e.stopPropagation()}
											onclick={(e) => {
												e.stopPropagation();
												actions.convertRemote(remoteEvent);
											}}
										>
											<Icon name="file-plus" size={11} strokeWidth={2.5} />
										</button>
									{/if}
									{#if b.event.kind === 'local' && !b.event.linked}
										{@const localEvent = b.event}
										<!-- In the HEAD, not under the body: as its own row it pushed a
										     short block's content out of an `overflow: hidden` box, and a
										     30-minute block is only ~30px tall to begin with. -->
										<button
											class="tn-block-badge"
											data-badge="link"
											aria-label="Add to the day plan"
											title="Not in the day plan — click to add it"
											onpointerdown={(e) => e.stopPropagation()}
											onclick={(e) => {
												e.stopPropagation();
												void actions.linkEvent(localEvent);
											}}
										>
											<Icon name="plus" size={11} strokeWidth={2.5} />
										</button>
									{/if}
								</div>

								{#if b.event.kind === 'local' && b.event.body}
									{@const owner = b.event}
									<div class="tn-block-body">
										{#each visibleRows(b) as row (row.line.lineNo)}
											<div
												class="tn-body-row"
												class:tn-row-done={isChecked(row.line)}
												style:--tn-row-depth={row.depth}
											>
												{#if row.line.hasCheckbox}
													<TaskCheck
														checked={isChecked(row.line)}
														label={lineTitle(row.line.text)}
														status={row.line.status}
														onToggle={(next) => toggleRow(owner, row, next)}
													/>
												{/if}
												{#if row.line.startMinutes != null}
													<span class="tn-row-time">{minutesToColon(row.line.startMinutes)}</span>
												{/if}
												<span
													class="tn-row-title markdown-rendered"
													{@attach (node: HTMLElement) =>
														renderMarkdownInto(
															node,
															lineTitle(row.line.text),
															owner.placement?.dailyNotePath ?? owner.filePath ?? '',
														)}>{lineTitle(row.line.text)}</span
												>
											</div>
										{/each}
										{#if hiddenRows(b) > 0}
											<div class="tn-block-more">+{hiddenRows(b)} more</div>
										{/if}
									</div>
								{/if}
								{#if b.draggable}
									<div class="tn-resize" data-handle="end"></div>
								{/if}
							</div>
						{/each}

						{#if allDayPreview && days[allDayPreview.dayIndex] === day}
							<div
								class="tn-ghost"
								style:top={`${yOf(allDayPreview.start)}px`}
								style:height={`${settings.defaultEventDurationMinutes * pxPerMinute}px`}
							>
								{minutesToColon(allDayPreview.start)}
							</div>
						{/if}

						<!-- Not while the pointer is over the lane: the block is becoming
						     all-day, so a time ghost in the column would contradict it. -->
						{#if drag && drag.toLaneDay == null && days[drag.dayIndex] === day}
							<div
								class="tn-ghost"
								style:top={`${yOf(drag.curStart)}px`}
								style:height={`${(drag.curEnd - drag.curStart) * pxPerMinute}px`}
							>
								{minutesToColon(drag.curStart)}–{minutesToColon(drag.curEnd)}
							</div>
						{/if}

						{#if needleTop() !== null && day === today}
							<div class="tn-needle" style:top={`${needleTop()}px`}></div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>
