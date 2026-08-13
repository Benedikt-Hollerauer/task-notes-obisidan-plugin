// What a dragged-out time block should BECOME. Pure (no Obsidian imports).
//
// Dragging on the grid used to have exactly one outcome: a plain planner line.
// That is the right default — most blocks are "gym session", not something that
// deserves a note of its own — but it was also the only option, so anything that
// did deserve a note had to be created somewhere else and dragged in afterwards.
//
// Three outcomes now, and this module is the list, so the dialog, the dispatch
// and the tests all read the same one.
//
//   line   the planner line the drag has always written; nothing else happens
//   note   an ordinary note, named by what you typed, linked into the slot
//   <emoji> a TYPED note — the filename grammar, the format, the template
//
// WHICH TYPES ARE OFFERED. Only file-level types you could plausibly be
// scheduling: `◻️` unchecked, `📅` scheduled, `🔁` routine. The registry also
// carries `✅` completed and `❌` unimportant, which are STATES a note reaches
// rather than things you create by blocking out an hour next Tuesday; and `🚀`
// project and `🎯` goal, which name FOLDERS (`appliesTo: 'folder'`) — the create
// path makes a file, so offering them would produce a file with a folder's name.
// Every one of them is still reachable from a note's right-click menu.

import { EMOJI_REGISTRY, type EmojiSpec } from '../constants';

/** The plain planner line — the default, and what the drag always did. */
export const BLOCK_KIND_LINE = 'line';
/** An ordinary note with no emoji and no grammar. */
export const BLOCK_KIND_NOTE = 'note';

/** What the caller must actually do once the dialog closes. */
export type BlockKind =
	| { kind: 'line' }
	| { kind: 'note' }
	/** `emoji` is a registry emoji — the note's type. */
	| { kind: 'typed'; emoji: string };

export interface BlockKindOption {
	value: string;
	label: string;
	title: string;
	/** Set when `label` is a bare emoji, which is not an accessible name. */
	ariaLabel?: string;
}

/** The types offered for a new block, in registry order. See the note above. */
export function schedulableSpecs(): readonly EmojiSpec[] {
	return EMOJI_REGISTRY.filter(
		(s) => s.appliesTo === 'file' && (s.role === 'open' || s.role === 'scheduled'),
	);
}

/**
 * The choice row for the "new time block" dialog.
 *
 * Labels are the bare emoji, with the wording in the tooltip: the row sits in a
 * modal beside a text field, and five words per button would wrap it onto three
 * lines. `menuLabel` ("scheduled 📅") is reused for the tooltip so this dialog
 * and the right-click menu name a type identically.
 */
export function blockKindOptions(): BlockKindOption[] {
	return [
		{
			value: BLOCK_KIND_LINE,
			label: 'Line',
			title: 'Just a line in the day plan — no note is created',
		},
		{
			value: BLOCK_KIND_NOTE,
			label: 'Note',
			title: 'An ordinary note, named by what you typed, linked into this slot',
		},
		...schedulableSpecs().map((spec) => ({
			value: spec.emoji,
			label: spec.emoji,
			title: `A ${spec.menuLabel} note, linked into this slot`,
			// Bare-emoji labels need a real accessible name — `title` is not one.
			ariaLabel: `A ${spec.menuLabel} note, linked into this slot`,
		})),
	];
}

/**
 * Read a picked value back.
 *
 * Anything unrecognised — including `undefined`, which is what a dialog with no
 * choice row reports — is the LINE, because that is the outcome that creates no
 * file. A dispatch bug should fall back to writing less, never to writing more.
 */
export function blockKindFor(value: string | undefined): BlockKind {
	if (value === BLOCK_KIND_NOTE) return { kind: 'note' };
	const spec = schedulableSpecs().find((s) => s.emoji === value);
	return spec ? { kind: 'typed', emoji: spec.emoji } : { kind: 'line' };
}
