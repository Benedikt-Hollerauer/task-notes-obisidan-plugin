<script lang="ts">
	/**
	 * Drives EventChip's markdown attachment from the outside, so a test can make
	 * it re-run WITHOUT changing the title.
	 *
	 * That distinction is the whole point. When the title changes, the
	 * `data-tn-md` stamp differs and the label re-renders however the guard is
	 * written — so a test that changes the title proves nothing about the latch.
	 * The bug only shows when the SAME text is rendered again into a node an
	 * earlier attempt left empty, which is what swapping the renderer reproduces.
	 *
	 * The state lives here rather than in the test because runes are compiled,
	 * and the test file is plain TypeScript.
	 */
	import { untrack } from 'svelte';
	import EventChip from '../../src/ui/views/svelte/EventChip.svelte';
	import type { TaskEvent } from '../../src/types';

	type Renderer = (el: HTMLElement, text: string, sourcePath?: string) => (() => void) | void;

	let { event, initial }: { event: TaskEvent; initial: Renderer } = $props();

	// `untrack` states the intent the compiler warns about: this reads `initial`
	// ONCE, to seed the state. Later changes come through setRenderer, which is
	// the whole point — the test drives the swap explicitly.
	let renderMarkdown = $state<Renderer>(untrack(() => initial));

	/** Swap the injected renderer; reachable on the object `mount` returns. */
	export function setRenderer(next: Renderer): void {
		renderMarkdown = next;
	}
</script>

<EventChip {event} variant="allday" hiddenRemote={new Set<string>()} {renderMarkdown} />
