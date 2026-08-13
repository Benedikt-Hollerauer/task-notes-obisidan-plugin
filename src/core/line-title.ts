// What a planner line is *called* on the timeline. Pure (no Obsidian imports).
//
// The rule is deliberately dumb: show the exact thing that stands after the
// time. No reformatting, no field extraction, no emoji stripping, and no link
// rendering — `[[📅 By 2026-07-24 at 14.00h, prepare - 1 - deck]]` shows up with
// its brackets, because that is what is written in the daily note.

/**
 * What a planner line is called on the timeline: the exact text after the time.
 *
 * Nothing is rewritten here — this returns the SOURCE text. The timeline then
 * renders that source as Markdown (TimelineActions.renderMarkdown), so `==x==`
 * arrives as a highlight and `**x**` as bold, exactly as in the note. This
 * function's job is only to decide WHICH text that is.
 */
export function lineTitle(text: string): string {
	return text.trim();
}
