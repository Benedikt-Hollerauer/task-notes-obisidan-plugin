<script lang="ts">
	import type { TaskEvent } from '../../../../types';
	import type { TaskNotesSettings } from '../../../../settings/settings';
	import type { TimelineRange } from '../../../../constants';
	import { monthsInOverview, monthTitle } from '../../../../core/date-key';
	import type { DayIntent } from '../../../../core/interaction';
	import MonthGrid from '../calendar/MonthGrid.svelte';

	let {
		anchor,
		count,
		events,
		settings,
		today,
		focusedDay = null,
		navigate,
		onDayClick = null,
	}: {
		anchor: string;
		count: 6 | 12;
		events: TaskEvent[];
		settings: TaskNotesSettings;
		today: string;
		focusedDay?: string | null;
		navigate: (range: TimelineRange, anchor: string) => void;
		onDayClick?: ((day: string, intent: DayIntent) => void) | null;
	} = $props();

	let months = $derived(monthsInOverview(anchor, count));
	/** The month we are actually in — twelve identical tiles need an anchor. */
	let currentMonth = $derived(today.slice(0, 7));
</script>

<div class="tn-minimonths" class:tn-year={count === 12}>
	{#each months as monthKey (monthKey)}
		<div class="tn-mini" class:tn-mini-current={monthKey.slice(0, 7) === currentMonth}>
			<button
				class="tn-mini-title"
				class:tn-current={monthKey.slice(0, 7) === currentMonth}
				title={`Open ${monthTitle(monthKey)} as a month grid`}
				onclick={() => navigate('month', monthKey)}
			>
				{monthTitle(monthKey)}
			</button>
			<MonthGrid
				anchor={monthKey}
				{events}
				{settings}
				{today}
				{focusedDay}
				variant="dot"
				onDayClick={(day, intent) =>
					onDayClick ? onDayClick(day, intent) : navigate('day', day)}
			/>
		</div>
	{/each}
</div>
