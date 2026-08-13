// Merge a daily-note template into a bare note while preserving its planner lines.
// Pure except for the bundled moment instance (aliased in tests).

import { moment } from '../lib/moment';
import { getPlannerSection, insertTimedBlockResult } from './planner-section';
import { buildBareDailyNote } from './bare-note';

/** One planner line already in the note, plus whatever is nested under it. */
export interface PreservedBlock {
	/** Start minutes of the block's own line, or null when it has no time. */
	startMinutes: number | null;
	/** The line and its body, verbatim and in order. */
	lines: string[];
}

export interface MergeOptions {
	templateRaw: string;
	heading: string;
	/** Blocks to carry over from the note being merged into. */
	preservedBlocks: PreservedBlock[];
	/** The note's date, YYYY-MM-DD. */
	date: string;
	/** Title used for {{title}} (usually the note's base name). */
	title: string;
}

/**
 * Interpolate template variables: `{{title}}`, `{{date[:FORMAT]}}`,
 * `{{time[:FORMAT]}}`, `{{datetime}}`, `{{timestamp}}`.
 *
 * `date` defaults to today when omitted (used for task templates, which have no
 * note date). Every substitution goes through a replacer FUNCTION so `$&`/`$'`
 * inside user text is inserted literally rather than treated as a pattern.
 */
export function interpolateTemplate(template: string, date: string | null, title: string): string {
	const noteDate = date ? moment(date, 'YYYY-MM-DD') : moment();
	const now = moment();
	// A DATE offset means calendar units, so `m` is months. Moment reads a bare
	// 'm' as minutes, which would silently turn `{{date-1m}}` into "a minute ago"
	// and, at midnight, print the previous DAY.
	const UNITS: Record<string, moment.unitOfTime.DurationConstructor> = {
		d: 'days',
		w: 'weeks',
		m: 'months',
		y: 'years',
	};
	const shifted = (amount: number, unit: string, fmt?: string) =>
		noteDate
			.clone()
			.add(amount, UNITS[(unit || 'd').toLowerCase()] ?? 'days')
			.format(fmt ? fmt.trim() : 'YYYY-MM-DD');
	return template
		.replace(/\{\{\s*title\s*\}\}/gi, () => title)
		// `{{yesterday}}` / `{{tomorrow}}` and `{{date+3d:FMT}}` are what a daily
		// template uses for its prev/next links. Unsupported, they survived into the
		// note as literal `{{yesterday}}` text.
		.replace(/\{\{\s*yesterday\s*(?::([^}]+))?\s*\}\}/gi, (_f, fmt?: string) => shifted(-1, 'd', fmt))
		.replace(/\{\{\s*tomorrow\s*(?::([^}]+))?\s*\}\}/gi, (_f, fmt?: string) => shifted(1, 'd', fmt))
		.replace(
			/\{\{\s*date\s*([+-]\d+)\s*([dwmy])?\s*(?::([^}]+))?\s*\}\}/gi,
			(_full, delta: string, unit?: string, fmt?: string) => shifted(Number(delta), unit ?? 'd', fmt),
		)
		.replace(/\{\{\s*date\s*(?::([^}]+))?\s*\}\}/gi, (_full, fmt?: string) =>
			noteDate.format(fmt ? fmt.trim() : 'YYYY-MM-DD'),
		)
		.replace(/\{\{\s*time\s*(?::([^}]+))?\s*\}\}/gi, (_full, fmt?: string) =>
			now.format(fmt ? fmt.trim() : 'HH:mm'),
		)
		.replace(/\{\{\s*datetime\s*\}\}/gi, () => now.format('YYYY-MM-DDTHH:mm:ss'))
		.replace(/\{\{\s*timestamp\s*\}\}/gi, () => String(now.valueOf()));
}

/**
 * Collapse preserved blocks that share a first line.
 *
 * Keyed on `lines[0]` only, so two blocks with the same first line but DIFFERENT
 * children would collapse to one and the second block's children would be lost.
 * That is reported rather than hidden — see MergeResult.dropped.
 *
 * BYTE-IDENTICAL TWINS ARE REPORTED TOO, and that is deliberate. They read as
 * "genuinely redundant", which is why they used to be collapsed silently — but
 * the merge REPLACES the whole note, so collapsing one is deleting a line the
 * user typed. Two identical `- [ ] 09:00 - 10:00 standup` rows in a hand-kept
 * plan is an ordinary thing to have, and the note coming back with one of them
 * gone is exactly the kind of edit nobody asked for. Reporting means the merge
 * refuses and says so; the note is left alone.
 */
function dedupe(blocks: PreservedBlock[]): { kept: PreservedBlock[]; dropped: string[] } {
	const seen = new Set<string>();
	const kept: PreservedBlock[] = [];
	const dropped: string[] = [];
	for (const block of blocks) {
		const key = block.lines[0];
		if (key == null) continue;
		if (seen.has(key)) {
			dropped.push(key);
			continue;
		}
		seen.add(key);
		kept.push(block);
	}
	return { kept, dropped };
}

/** What a merge produced, and what it could NOT place. */
export interface MergeResult {
	text: string;
	/**
	 * First lines of blocks that would not survive the merge. NON-EMPTY MEANS DO
	 * NOT WRITE — the merge replaces the whole note, so a block that could not be
	 * placed is a block deleted along with everything nested under it.
	 */
	dropped: string[];
}

/**
 * Merge `templateRaw` into a bare note, keeping every line already planned there.
 *
 * Each preserved block is placed by the same rule the timeline uses: in time
 * order among whatever timed lines the template itself has, wherever they live —
 * so a template built out of hour rows receives a planned event between the
 * right two rows, with no heading needed. A block always arrives whole; its own
 * sub-items never end up somewhere else in the note.
 */
export function mergeTemplateIntoBareNote(opts: MergeOptions): MergeResult {
	const interpolated = interpolateTemplate(opts.templateRaw, opts.date, opts.title);
	const { kept, dropped } = dedupe(opts.preservedBlocks);
	if (kept.length === 0) return { text: interpolated, dropped };

	const hasSection = getPlannerSection(interpolated, opts.heading).found;
	const hasTimes = kept.some((b) => b.startMinutes != null);
	if (hasSection || hasTimes) {
		let result = interpolated;
		for (const block of kept) {
			// THE RESULT, not just the text. `insertTimedBlock` refuses when the
			// block's own first line already exists — and because this merge
			// REPLACES the whole note, a refusal that goes unnoticed deletes that
			// block and every line nested under it. A template built from hour rows
			// (`- [ ] 07:00 - 08:00`) collides with a planned block of the same
			// name, which is the ordinary case, not an exotic one.
			const outcome = insertTimedBlockResult(result, opts.heading, block.lines, block.startMinutes);
			if (!outcome.inserted) {
				dropped.push(block.lines[0] ?? '');
				continue;
			}
			result = outcome.text;
		}
		return { text: result, dropped };
	}

	const block = buildBareDailyNote(
		opts.heading,
		kept.flatMap((b) => b.lines),
	);
	if (interpolated.length === 0) return { text: block, dropped };
	const sep = interpolated.endsWith('\n') ? '\n' : '\n\n';
	return { text: interpolated + sep + block, dropped };
}
