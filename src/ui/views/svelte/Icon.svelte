<script lang="ts">
	// Inline Lucide icons — the same set Obsidian itself draws — so the toolbar
	// looks native instead of falling back to whatever glyph the font happens to
	// have. Drawn inline rather than via `setIcon` to keep components free of
	// Obsidian imports (and so they stay unit-testable).
	export type IconName =
		| 'calendar'
		| 'chevron-left'
		| 'chevron-right'
		| 'chevron-down'
		| 'chevron-up'
		| 'file-text'
		| 'file-plus'
		| 'cloud'
		| 'check-check'
		| 'plus';

	// A 2-unit stroke on a 24 viewBox goes muddy below ~13px, so a small glyph
	// asks for a heavier one rather than being drawn faint.
	let {
		name,
		size = 16,
		strokeWidth = 2,
	}: { name: IconName; size?: number; strokeWidth?: number } = $props();
</script>

<svg
	class="tn-icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#if name === 'calendar'}
		<rect x="3" y="4" width="18" height="18" rx="2" />
		<path d="M16 2v4M8 2v4M3 10h18" />
	{:else if name === 'chevron-left'}
		<path d="m15 18-6-6 6-6" />
	{:else if name === 'chevron-right'}
		<path d="m9 18 6-6-6-6" />
	{:else if name === 'chevron-down'}
		<path d="m6 9 6 6 6-6" />
	{:else if name === 'chevron-up'}
		<path d="m18 15-6-6-6 6" />
	{:else if name === 'file-text'}
		<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
		<path d="M14 2v5h5M8 13h8M8 17h8" />
	{:else if name === 'file-plus'}
		<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
		<path d="M14 2v5h5M12 12v6M9 15h6" />
	{:else if name === 'cloud'}
		<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
	{:else if name === 'plus'}
		<path d="M12 5v14M5 12h14" />
	{:else if name === 'check-check'}
		<path d="M18 6 7 17l-5-5" />
		<path d="m22 10-7.5 7.5L13 16" />
	{/if}
</svg>
