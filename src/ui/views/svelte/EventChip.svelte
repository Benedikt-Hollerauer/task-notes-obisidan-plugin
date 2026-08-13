<script lang="ts">
	/**
	 * One event, drawn as a chip.
	 *
	 * The all-day lane and the month grid had grown the same chip twice — same
	 * structure, same checkbox wiring, same tooltip vocabulary. They had already
	 * drifted apart in what that tooltip SAID, which is how you find out two
	 * copies exist. `variant` is the only thing that legitimately differs: the
	 * two chips are deliberately styled differently, and that stays.
	 */
	import type { LocalEvent, RemoteEvent, TaskEvent } from '../../../types';
	import { isEventDone } from '../../../core/event-visibility';
	import Icon from './Icon.svelte';
	import TaskCheck from './TaskCheck.svelte';

	let {
		event,
		variant,
		hiddenRemote,
		dragging = false,
		showCloud = false,
		onSetChecked = null,
		onSetRemoteHidden = null,
		onConvertRemote = null,
		renderMarkdown = null,
		...rest
	}: {
		event: TaskEvent;
		/** Which family of styles to wear: the all-day lane, or a month cell. */
		variant: 'allday' | 'cal';
		hiddenRemote: ReadonlySet<string>;
		dragging?: boolean;
		/** The lane has room for the "from a calendar" glyph; a month cell does not. */
		showCloud?: boolean;
		onSetChecked?: ((event: LocalEvent, next: boolean) => void) | null;
		onSetRemoteHidden?: ((event: RemoteEvent, next: boolean) => void) | null;
		/**
		 * Turn this calendar occurrence into a note of your own. Shown beside the
		 * cloud glyph, and only where that glyph is — a month cell has no room for
		 * either. Omitted, the button is simply absent.
		 */
		onConvertRemote?: ((event: RemoteEvent) => void) | null;
		/**
		 * Render the title as Markdown. Passed in rather than imported, because
		 * this file — like every view here — holds no Obsidian imports of its own.
		 * Omitted, the label falls back to plain text.
		 */
		renderMarkdown?: ((el: HTMLElement, text: string, sourcePath?: string) => (() => void) | void) | null;
		[key: string]: unknown;
	} = $props();

	// The shared predicate, not a copy of it — core/event-visibility.ts exists so
	// "done" has one definition, and this line used to restate it verbatim.
	let done = $derived(isEventDone(event, hiddenRemote));

	/** Svelte owns the returned cleanup for exactly as long as this label is mounted. */
	function renderInto(node: HTMLElement, text: string): (() => void) | void {
		if (!renderMarkdown) return;
		node.dataset.tnMd = text;
		// A planner line's wikilink resolves from ITS note — the daily note the
		// line lives in — falling back to the linked file for unlinked ghosts.
		const sourcePath =
			event.kind === 'local' ? (event.placement?.dailyNotePath ?? event.filePath ?? '') : '';
		return renderMarkdown(node, text, sourcePath);
	}
</script>

<div
	class={variant === 'allday' ? 'tn-allday-chip' : 'tn-cal-chip'}
	role="button"
	tabindex="0"
	class:tn-remote={event.kind === 'remote'}
	class:tn-done={done}
	class:tn-unlinked={event.kind === 'local' && !event.linked}
	class:tn-dragging={dragging}
	data-chip-id={event.id}
	style:--tn-block-color={event.kind === 'remote' && event.color ? event.color : null}
	{...rest}
>
	{#if event.kind === 'remote' && onSetRemoteHidden}
		{@const remote = event}
		{@const setHidden = onSetRemoteHidden}
		<TaskCheck
			checked={hiddenRemote.has(remote.id)}
			label={`Hide "${remote.title}" from the timeline`}
			title="Hide this occurrence here — your calendar is not changed"
			onToggle={(next) => setHidden(remote, next)}
		/>
	{:else if event.kind === 'local' && event.placement && onSetChecked}
		{@const local = event}
		{@const setChecked = onSetChecked}
		<TaskCheck
			checked={local.checked}
			label={`Done: ${local.title}`}
			status={local.checked ? 'x' : undefined}
			onToggle={(next) => setChecked(local, next)}
		/>
	{/if}
	<!-- Rendered when a host supplies renderMarkdown; the plain text stays as the
	     fallback so a chip is never empty. `markdown-rendered` is what makes a
	     ==highlight== visible — see the note in TimeGrid.svelte. -->
	{#if renderMarkdown}
		{@const label = event.title}
		<!-- The plain text is IN the markup, so the chip is readable even if the
		     injected renderer never fires or fails — its whole content must never
		     depend on an async callback succeeding. The attachment upgrades it. -->
		<span
			class="tn-chip-label markdown-rendered"
			{@attach (node: HTMLElement) => renderInto(node, label)}>{label}</span
		>
	{:else}
		<span class="tn-chip-label">{event.title}</span>
	{/if}
	{#if event.kind === 'local' && event.bodyProgress}
		{@const p = event.bodyProgress}
		<span class="tn-block-count">{p.done}/{p.total}</span>
	{/if}
	{#if showCloud && event.kind === 'remote'}
		{@const remote = event}
		<span class="tn-remote-mark" title={`From ${remote.calendarName}`}>
			<Icon name="cloud" size={11} strokeWidth={2.5} />
		</span>
		{#if onConvertRemote}
			<!-- The same control the timed blocks carry, so an all-day calendar
			     event is convertible without hunting for a right-click. -->
			<button
				class="tn-block-badge"
				data-badge="convert"
				aria-label={`Create a task note from "${remote.title}"`}
				title="Create a task note from this event — your calendar is not changed"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => {
					e.stopPropagation();
					onConvertRemote(remote);
				}}
			>
				<Icon name="file-plus" size={11} strokeWidth={2.5} />
			</button>
		{/if}
	{/if}
</div>
