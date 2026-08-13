// Pure reconciliation decisions: given a daily note's resolved planner lines,
// decide which 📅 files must be renamed so their filename date/start-time matches
// the daily note (the source of truth). No Obsidian imports — fully testable.

import {
	expectedEventBasename,
	parseEventBasename,
	isScheduledBasename,
	hasScheduledDatePart,
} from './event-filename';
import { activePrefixOf } from './emoji';
import { isBodyRow, type LineTree } from './line-tree';
import type { PlannerLine } from '../types';

export interface ResolvedPlannerLine {
	lineNo: number;
	startMinutes: number | null;
	/** Current basename (no extension) of the resolved 📅 file, or null if none/dangling. */
	targetBasename: string | null;
	/**
	 * True when more than one planner line — in ANY daily note — links this file.
	 * Such a file cannot satisfy every line's time, so renaming it would make each
	 * note compute a different fixpoint and fight the others forever.
	 */
	duplicate?: boolean;
}

export interface RenameDecision {
	lineNo: number;
	fromBasename: string;
	toBasename: string;
}

/**
 * The daily note wins: for each line linking a 📅 file, the expected basename is a
 * pure function of (file props, daily date, line start time). Only files whose
 * actual basename differs need renaming — which makes reconcile an idempotent
 * fixpoint and stops rename→link-rewrite→reparse feedback loops structurally.
 */
export function decideReconcile(
	dailyDate: string,
	lines: ResolvedPlannerLine[],
	scheduledFormat: string,
): RenameDecision[] {
	const decisions: RenameDecision[] = [];
	for (const line of lines) {
		const current = line.targetBasename;
		if (!current || !isScheduledBasename(current)) continue;
		// A 📅 note that doesn't already use the `By <date>` grammar keeps its name.
		// Reconcile makes a name TRUTHFUL; it does not convert a name into the
		// grammar, which would be a rename the user never asked for.
		if (!hasScheduledDatePart(current, scheduledFormat)) continue;
		// Claimed by several lines: no single filename satisfies them all, so leave
		// it alone. The UI flags it instead (LocalEvent.duplicate).
		if (line.duplicate) continue;

		const props = parseEventBasename(current, scheduledFormat);
		// Drop a multi-day range the new date would invert (end before start);
		// otherwise the event would parse to a backwards span and vanish from
		// every view. A real move keeps its span via SyncEngine.shiftMultiDaySpan.
		const normalized =
			props.endDate && props.endDate < dailyDate ? { ...props, endDate: undefined } : props;
		// Thread the active marker through: reconcile must never strip 🅰️.
		const expected = expectedEventBasename(
			normalized,
			dailyDate,
			line.startMinutes,
			scheduledFormat,
			activePrefixOf(current),
		);
		if (expected !== current) {
			decisions.push({ lineNo: line.lineNo, fromBasename: current, toBasename: expected });
		}
	}
	return decisions;
}

/**
 * The planner lines that may drive an automatic rename: exactly the ones the
 * timeline draws as a block of their own.
 *
 * A row nested under a timed line is a step INSIDE that block — its time belongs
 * to the step, not to the file — so it must not rename anything. If you cannot
 * see it as a block, the plugin does not rename because of it.
 *
 * Note this only ever REMOVES rename authority. Ownership (`claimCounts`, and
 * therefore the duplicate guard) still counts every claimant: a file claimed by
 * one visible and one nested line must stay flagged as duplicate, or the two
 * would rename it back and forth until the circuit breaker trips.
 */
export function renameableLines(plan: { lines: PlannerLine[]; tree: LineTree }): PlannerLine[] {
	return plan.lines.filter((line) => !isBodyRow(plan.tree, line.lineNo));
}

/**
 * May a block be made ALL-DAY — dragged into the lane, stripping its time?
 *
 * Pure, because getting it wrong writes to the vault without being asked. Two
 * silent-write bugs came through this path in v3.5:
 *
 *  - an UNLINKED ghost has no planner line, so "strip the time" fell through to
 *    the create path, which resolved a slot and invented `dayStartHour`. That
 *    wrote a line at 08:00 AND renamed the note to match, rewriting every
 *    wikilink to it — four writes, from a gesture that asked for no time at all.
 *  - a line OUTSIDE the planner section is indexed only BECAUSE it carries a
 *    time. Stripping it deletes the block from the timeline with no way back
 *    except editing the note by hand: the silent-vanish case.
 *
 * Both are refusals, not corrections. The ➕ dialog is the route that asks.
 */
export type LaneDropVerdict = 'ok' | 'not-in-plan' | 'outside-section';

export function laneDropVerdict(event: {
	linked: boolean;
	hasPlacement: boolean;
	/** False only when the line is known to sit outside the planner heading. */
	inDayPlan?: boolean;
}): LaneDropVerdict {
	if (!event.linked || !event.hasPlacement) return 'not-in-plan';
	if (event.inDayPlan === false) return 'outside-section';
	return 'ok';
}
