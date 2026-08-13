// Circuit breaker for automatic renames. Pure (no Obsidian imports).
//
// Reconcile is designed to be an idempotent fixpoint, so a healthy vault renames
// a file at most once per user edit. If the same path is renamed repeatedly in a
// short window, something is fighting itself — and since renames are the ONE
// automatic write this plugin makes to the vault, the safe response is to stop
// and tell the user rather than keep churning their files.

export const LOOP_WINDOW_MS = 10_000;
export const LOOP_MAX = 5;

export interface RenameLog {
	/** key → timestamps of recent renames. */
	attempts: Map<string, number[]>;
	/** Keys that tripped the breaker. Latched until the plugin reloads. */
	stopped: Set<string>;
}

export function createRenameLog(): RenameLog {
	return { attempts: new Map(), stopped: new Set() };
}

/**
 * Record a rename attempt and report whether it may proceed.
 *
 * `key` must be STABLE across the rename (the file's identity, not its path) —
 * a loop renames the same file back and forth, so a path key would count each
 * name separately and never trip.
 *
 * Once tripped it LATCHES: a loop that keeps producing new names would otherwise
 * slip through the sliding window forever. Latching also makes the warning
 * accurate — the situation needs the user to fix it, not to wait it out.
 */
export function allowRename(log: RenameLog, key: string, now: number): boolean {
	if (log.stopped.has(key)) return false;
	const recent = (log.attempts.get(key) ?? []).filter((ts) => now - ts < LOOP_WINDOW_MS);
	if (recent.length >= LOOP_MAX) {
		log.stopped.add(key);
		log.attempts.delete(key);
		return false;
	}
	recent.push(now);
	log.attempts.set(key, recent);
	return true;
}

