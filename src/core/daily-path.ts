// Deciding whether a file really is a daily note. Pure (no Obsidian imports).
//
// The daily-notes interface identifies notes by BASENAME alone, so any
// date-named file anywhere in the vault (`Meetings/2026-07-24.md`, an archived
// copy) would otherwise be treated as a day plan — its checkboxes rendered as
// events, and worse, its lines driving automatic renames of the 📅 files they
// link to. A daily note must live where daily notes live.

/** The folder part of a vault path ('' for a root-level file). */
export function parentFolder(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? '' : path.slice(0, slash);
}

/**
 * True when `path` is an acceptable location for the daily note of its date.
 *
 * Accepts an exact match with the configured path, and also any file in the same
 * folder — so a custom `format` that renders differently (or a note the user
 * renamed slightly) still counts, while notes filed elsewhere never do.
 */
export function isDailyNotePath(path: string, expectedPath: string): boolean {
	if (path === expectedPath) return true;
	return parentFolder(path) === parentFolder(expectedPath);
}
