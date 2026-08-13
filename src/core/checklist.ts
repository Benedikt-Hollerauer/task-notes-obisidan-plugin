// Markdown checklist inspection. Pure (no Obsidian imports).

const ANY_TODO = /(^|\n)\s*[-*+]\s+\[[ xX]\]/;
const UNCHECKED_TODO = /(^|\n)\s*[-*+]\s+\[\s?\]/;

/** True if the content has any checklist item at all. */
function hasAnyTodo(content: string): boolean {
	return ANY_TODO.test(content);
}

/** True if the content has at least one unchecked `- [ ]` item. */
function hasUncheckedTodos(content: string): boolean {
	return UNCHECKED_TODO.test(content);
}

/**
 * True if any of Obsidian's parsed list items is an unchecked task.
 *
 * Takes the array rather than the CachedMetadata so it stays pure and testable:
 * this predicate decides whether the plugin renames a ✅ file back to ◻️ on its
 * own, and it was written out twice with no coverage on either copy.
 */
export function hasUncheckedItem(items: readonly { task?: string }[] | undefined): boolean {
	return (items ?? []).some((it) => typeof it.task === 'string' && it.task.trim() === '');
}

/** True if the note has no todos, or all of them are checked (the completion guard). */
export function areAllTodosChecked(content: string): boolean {
	if (!hasAnyTodo(content)) return true;
	return !hasUncheckedTodos(content);
}
