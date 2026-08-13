// Horizontal placement for overlapping time blocks (interval lane-packing).
// Pure. Adapted in spirit from obsidian-day-planner's overlap algorithm (MIT).

export interface Interval {
	id: string;
	start: number; // minutes since midnight
	end: number;
}

export interface Placement {
	/** 0-based column within the overlap cluster. */
	column: number;
	/** Total columns in the cluster. */
	columns: number;
	/** Left offset as a fraction of the day-column width (0–1). */
	left: number;
	/** Width as a fraction of the day-column width (0–1). */
	width: number;
}

/** Group intervals into clusters of mutually-reachable overlaps, in start order. */
function clusters(items: Interval[]): Interval[][] {
	const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
	const out: Interval[][] = [];
	let i = 0;
	while (i < sorted.length) {
		const cluster: Interval[] = [sorted[i]];
		let clusterEnd = sorted[i].end;
		let j = i + 1;
		while (j < sorted.length && sorted[j].start < clusterEnd) {
			cluster.push(sorted[j]);
			clusterEnd = Math.max(clusterEnd, sorted[j].end);
			j++;
		}
		out.push(cluster);
		i = j;
	}
	return out;
}

/** Placement for every interval, plus the ids that overlap something. */
export interface OverlapLayout {
	placement: Map<string, Placement>;
	/** Ids of intervals that overlap at least one other interval. */
	overlapping: Set<string>;
}

/**
 * Column placement and overlap flags in ONE clustering pass.
 *
 * These were two exported functions, called on the same array on the same line,
 * each clustering it independently — the same loop written twice in one file, so
 * the two could disagree about what overlaps what.
 *
 * A cluster is built by admitting an interval only while it starts before the
 * running cluster end, so every member after the first overlaps the member that
 * set that end — meaning a cluster of two or more is exactly a set of
 * overlapping intervals.
 */
export function overlapLayout(items: Interval[]): OverlapLayout {
	const placement = new Map<string, Placement>();
	const overlapping = new Set<string>();

	for (const cluster of clusters(items)) {
		// Lane-pack: the first column whose last block has already ended.
		const colEnds: number[] = [];
		const cols: number[] = [];
		for (const item of cluster) {
			let col = colEnds.findIndex((end) => end <= item.start);
			if (col === -1) col = colEnds.length;
			colEnds[col] = item.end;
			cols.push(col);
		}

		const columns = colEnds.length;
		cluster.forEach((item, k) => {
			placement.set(item.id, {
				column: cols[k],
				columns,
				left: cols[k] / columns,
				width: 1 / columns,
			});
			if (cluster.length > 1) overlapping.add(item.id);
		});
	}

	return { placement, overlapping };
}

