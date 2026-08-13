<script lang="ts">
	/**
	 * The one checkbox every view uses.
	 *
	 * Deliberately a bare `input[type=checkbox]`: Obsidian draws task checkboxes
	 * from `app.css` and themes hook that with `data-task`, so anything we draw
	 * ourselves collides with it rather than replacing it. styles.css only sizes
	 * the flex box around it.
	 */
	let {
		checked,
		label,
		title = undefined,
		status = undefined,
		onToggle,
	}: {
		checked: boolean;
		/** Screen-reader label — every box says what ticking it would do. */
		label: string;
		title?: string;
		/**
		 * The status character as written in the note (`x`, `/`, `!`, …), so a
		 * theme can render custom statuses. Omitted for anything that isn't a task.
		 */
		status?: string;
		onToggle: (next: boolean) => void;
	} = $props();

	/** `- [ ]` carries no status: an empty `data-task` would match theme rules. */
	let task = $derived(status && status.trim() ? status : undefined);

	let input = $state<HTMLInputElement | null>(null);

	/**
	 * THE STUCK-CHECKBOX FIX. Both halves are load-bearing; neither is enough.
	 *
	 * `preventDefault()` below runs the DOM's *legacy-canceled-activation
	 * behaviour*, which restores `input.checked` to its pre-click value at the END
	 * of event dispatch. Svelte writes the new value earlier, in a microtask, and
	 * its setter is MEMOISED — `if (attributes.checked === (attributes.checked =
	 * next)) return`. So Svelte records "already wrote false", the browser then
	 * puts `true` back, and every later flush short-circuits against that cache.
	 * The box sticks while the model is perfectly fine.
	 *
	 * Only the remote path was fast enough to lose that race: it publishes to its
	 * store synchronously, whereas a local tick goes through a serial queue, a
	 * vault write and a 150 ms debounce and so lands well after the restore.
	 *
	 * (1) This effect writes the property DIRECTLY, which bypasses the poisoned
	 *     cache, whenever the model changes.
	 */
	$effect(() => {
		const el = input;
		const next = checked;
		if (el && el.checked !== next) el.checked = next;
	});

	/**
	 * (2) …and this re-asserts it on a MACROTASK after a click, because the
	 * browser's restore happens after the microtask checkpoint the effect runs in.
	 * Without it, the first untick of a remote event is undone before it is seen.
	 */
	function resyncAfterDispatch(): void {
		setTimeout(() => {
			if (input && input.checked !== checked) input.checked = checked;
		}, 0);
	}
</script>

<input
	bind:this={input}
	type="checkbox"
	class="task-list-item-checkbox tn-check"
	data-badge="check"
	data-task={task}
	{checked}
	{title}
	aria-label={label}
	onpointerdown={(e) => e.stopPropagation()}
	onclick={(e) => {
		// The note is the source of truth: the box shows what the FILE says, not
		// what the click implied, so a write that gets rejected can never leave a
		// tick that didn't happen.
		e.preventDefault();
		e.stopPropagation();
		onToggle(!checked);
		resyncAfterDispatch();
	}}
/>
