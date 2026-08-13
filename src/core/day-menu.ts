// What the day menu offers, as data. Pure (no Obsidian imports).
//
// The list used to be built inline against Obsidian's `Menu`, which made every
// claim about it unverifiable — and it is now reached two ways (left-clicking a
// day's note button, right-clicking the day cell), so "both routes offer the
// same three things" is exactly the kind of claim worth pinning.

import { APPLY_TEMPLATE_LABEL } from '../constants';

export type DayMenuAction = 'open' | 'open-new-tab' | 'apply-template';

export interface DayMenuItem {
	action: DayMenuAction;
	label: string;
	/** Obsidian icon id. */
	icon: string;
	/** Draw a separator above this item. */
	separatorBefore?: boolean;
}

/**
 * The actions offered for one day.
 *
 * Two when the daily note does not exist yet, three when it does — a template
 * can only be merged into a file that is already there.
 *
 * The wording follows the same rule as the button's own icon: creating a note
 * is a write, so an item that would create one says so rather than hiding it
 * behind the word "open".
 */
export function dayMenuItems(hasNote: boolean): DayMenuItem[] {
	const items: DayMenuItem[] = [
		{
			action: 'open',
			label: hasNote ? 'Open daily note' : 'Create and open daily note',
			icon: 'file-text',
		},
		{
			action: 'open-new-tab',
			label: hasNote ? 'Open daily note in new tab' : 'Create and open in a new tab',
			icon: 'file-plus',
		},
	];
	if (hasNote) {
		items.push({
			action: 'apply-template',
			label: APPLY_TEMPLATE_LABEL,
			icon: 'copy',
			separatorBefore: true,
		});
	}
	return items;
}
