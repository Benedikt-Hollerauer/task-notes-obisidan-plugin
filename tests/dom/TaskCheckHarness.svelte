<script lang="ts">
	/**
	 * Wires TaskCheck the way a REMOTE event does, and forces the ORDERING that
	 * makes the bug — which is the whole point of this harness.
	 *
	 * In a real browser: the click listener runs, then the microtask checkpoint
	 * flushes Svelte's effects, and only then does dispatch finish and the
	 * canceled-activation behaviour restore `input.checked`. Svelte's setter is
	 * memoised, so that flush records "already written" and the restore wins
	 * permanently.
	 *
	 * happy-dom runs the entire click in one synchronous stack, so no microtask
	 * checkpoint occurs mid-dispatch and the interleaving never happens on its own.
	 * The explicit `flushSync()` below stands in for that checkpoint. Without it
	 * this test passes against the broken component and proves nothing — verified.
	 *
	 * The synchronous model update mirrors `hideRemoteEvent`, which publishes to
	 * its store before its first `await`; the local path's write goes through a
	 * serial queue and a debounce, lands much later, and is why only remote events
	 * showed the bug.
	 */
	import { flushSync } from 'svelte';
	import TaskCheck from '../../src/ui/views/svelte/TaskCheck.svelte';

	let { onToggle = undefined }: { onToggle?: (next: boolean) => void } = $props();

	/** Starts ticked — a remote occurrence already hidden. */
	let hidden = $state(true);
</script>

<TaskCheck
	checked={hidden}
	label="Hide this occurrence"
	onToggle={(next) => {
		hidden = next;
		onToggle?.(next);
		// The microtask checkpoint the browser would run here, before the restore.
		flushSync();
	}}
/>
