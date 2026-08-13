# Testing Task Notes

Two layers: **automated unit tests** for the pure logic, and a **manual walkthrough**
in the bundled `test-vault/`.

## 1. Automated tests (fast, no Obsidian needed)

```bash
npm install
npm test            # vitest — 1000+ tests over the frozen filename grammar, the emoji
                    # registry + 🅰️ marker, planner-line parsing/round-trips, section
                    # edits, reconcile decisions, event ranges, slots, placement
                    # lookup, template merge, colour contrast, overlap and date math
npm run check       # svelte-check + tsc (type safety across .ts and .svelte)
```

All of these must stay green. The golden tests in `tests/task-name.test.ts` pin the
**frozen** emoji-filename format — if you change parsing/formatting and they fail,
the change broke backward compatibility.

## 2. Build + load into the test vault

```bash
./docker-build.sh                 # builds and copies main.js/manifest.json/styles.css
                                  # into test-vault/.obsidian/plugins/task-notes/
# — or, without Docker —
npm run build
mkdir -p test-vault/.obsidian/plugins/task-notes
cp main.js manifest.json styles.css test-vault/.obsidian/plugins/task-notes/
```

Open `test-vault/` as a vault in Obsidian and enable **Task Notes** if needed
(Settings → Community plugins). The vault ships with the Daily Notes core plugin
configured (`Daily/` folder, `YYYY-MM-DD`, template `test/daily-template.md`).

> ⚠️ **The §3 walkthrough below is written against notes that no longer exist.**
> The vault has been used for real testing since it was written, and its seeded
> fixtures (2026-07-24 … 2026-07-27: "prepare deck", "call Acme", the unlinked
> "gym" event) were consumed. `test-vault/Daily/` now holds **2026-08-10 … 08-14**.
>
> Read §3 as a LIST OF THINGS TO CHECK, not as literal steps — substitute the
> dates and notes that are actually there. The numbered items from §4 onward
> (the per-round regression lists) were each written against the vault as it
> stood and are accurate.
>
> Re-seeding the vault to match §3 is worth doing before the next big round;
> until then the highest-risk write paths (drag-to-move, resize, cross-day move)
> are covered by §4+ and by the automated suite, not by §3.

## 3. Manual walkthrough

Open the command palette and run **"Task Notes: Open timeline"** (or click the
calendar-clock ribbon icon). Then work through:

### Core timeblocking

1. **Timeline renders.** In **Day** view navigate to 2026-07-24. You should see three
   blocks (09:00 prepare deck, 12:30 Lunch plain-text, 14:00 call Acme), plus an
   18:00 **"not in plan"** dashed block (the unlinked `gym` event). The red now-needle
   shows on today.
2. **Drag to move.** Drag the 14:00 block to 15:00. Open `Daily/2026-07-24.md` — the
   line now reads `15:00 - 16:00`, **and** the event file was renamed to
   `📅 By 2026-07-24 at 15.00h, call - 1 - Acme.md`. No duplicate writes.
3. **Resize.** Drag the bottom edge of a block; the line's end time updates.
4. **Edit the line by hand.** In the daily note change a linked line's time; the 📅
   file is renamed to match (line wins).
5. **Rename the file by hand.** Rename a `📅 … at HH.MMh …` file's time in the file
   explorer; the daily-note line's time updates to match (same-day only).
6. **Cross-day move.** Switch to **Week** view and drag a block to another day. The
   line moves to that day's note (created bare if missing) and the file's date syncs.
7. **Link an unlinked event.** Drag the 18:00 "not in plan" gym block onto the grid, or
   right-click it → **Link into day plan**.

### Navigation (right-click / double-click)

8. **Right-click a block** (time grid, month chip, or all-day chip) → a menu opens with
   **Open in daily note**, **Open event note**, **Link into day plan** (unlinked events
   only) and the status items (Mark as ✅ / ❌ / …).
   • *Open in daily note* opens the daily note with the cursor on that exact planner line.
   • Right-click must **never** create a block or open the "New time block" prompt.
9. **Double-click a block** → the event's own note opens. A plain-text block (no link,
   e.g. "Lunch") opens its daily note at that line instead.
10. **Single click does nothing destructive.** Click a block once and release without
    moving: nothing is written to the daily note (check the file's modified time).
11. **Keyboard.** Tab to a block or month chip and press Enter — the note opens. Focus
    rings are visible on every button, chip and day cell.

### Month / overview / calendar

12. **Month misclick safety.** Switch to **Month**. The conference event spans
    2026-07-25 → 26. Click its chip **on the 26th** — it must simply open the note, not
    reschedule. Now drag that chip two days forward: the event moves *and keeps its
    2-day span* (filename becomes `By 2026-07-27 … - 2026-07-28`).
13. **6-month / year.** Multi-day events show a density dot on **every** day they cover,
    not just their first day. Clicking a day or a month title navigates.
14. **Calendar sidebar.** Run **"Task Notes: Open calendar"**. Three visually distinct
    dot types: filled accent = events, hollow ring = unchecked tasks, faint = word count.
    Toggling each in settings changes only its own dots. Click a day to open (or create)
    its daily note; the currently open daily note is highlighted.

### Constitution behaviours

15. **🅰️ active marker.** `🅰️ 📅 By 2026-07-27 at 15.00h, focus - 1 - deepwork.md` is
    linked in `Daily/2026-07-27.md`. It shows on the timeline at 15:00 with an accent
    bar, and its file-explorer entry is bold. Drag it to another time → the filename
    updates **and still starts with `🅰️ `**. Mark it ✅ from the right-click menu → the
    marker still survives. Edit its properties in the task-properties sidebar → still survives.
16. **Untimed items are all-day items.** `Daily/2026-07-27.md` has `- [ ] Water the
    plants` with no time. It renders as a chip in the **all-day lane** above the grid
    (not dropped). Right-clicking it opens the menu; clicking opens the daily note.
17. **Defaults.** On a fresh vault (delete `data.json`), Settings shows **60 min**
    default event duration and **day start hour 8**.
18. **Completed blocks toggle.** Settings → Timeline → turn **Show completed blocks**
    off; checked lines disappear from the timeline, month view and the sidebar's event
    dots. Turn it back on and they return (dimmed, struck through).
19. **Templates are never treated as events.** `test/daily-template.md` never appears as
    a block, even though it contains a planner heading.

### Future planning + templates

20. **Future planning + template merge.** `Daily/2026-11-20.md` is **bare** (heading only,
    no template). Add an event to it by dragging in Week view, then run **"Apply daily
    note template now"** — the `test/daily-template.md` content is merged in and the
    planner lines are preserved under the heading.

### Remote calendars & notifications

21. **Remote calendar.** Settings → Task Notes → Remote calendars → Add calendar; paste
    a public ICS URL (e.g. a Google Calendar "secret address in iCal format"). Typing in
    the URL field must **not** fire a request per keystroke (it is debounced). Run
    **"Refresh remote calendars"**; coloured read-only blocks appear — light calendar
    colours get dark text (readable), dark ones white. Toggle airplane mode and refresh:
    the last-good cached copy is used. Disabling calendar #1 must not recolour #2.
22. **Recurring events.** A weekly recurring event (e.g. a Monday stand-up) must appear on
    the **correct weekday**, including for series that started years ago.
23. **Notifications.** Settings → enable notifications (grant permission). Create/drag an
    event a couple of minutes ahead; a system notification (or in-app notice) fires at
    the lead time and at start. Run *"Send a test notification"* from the palette: it
    delivers one immediately AND reports how many reminders are armed, so "delivery is
    broken" and "nothing was armed" are distinguishable. The reminders section shows the
    live OS permission state.
23b. **A notification the OS swallows is never silent.** With Do Not Disturb on (or no
    notification daemon), a reminder must still appear as an in-app notice. The old code
    returned as soon as `new Notification()` didn't throw — which on Linux it never does,
    even when nothing is drawn — so the reminder disappeared with nothing in the console.
23c. **A broken calendar says what to do.** Point a calendar at
    `https://calendar.google.com/calendar/ical/<you>/public/basic.ics` for a calendar that
    is not shared publicly. The settings row must turn red and read *"Not found (404).
    This Google calendar is not shared publicly … use the Secret address in iCal
    format"* — not `Request failed, status 404`.

### Vault safety (the "never touch my vault by itself" guarantees)

24. **No rename loop from a doubled link.** Copy the line
    `- [ ] 10:00 - 11:00 [[📅 By 2026-07-24 at 10.00h, prepare - 1 - deck]]` from
    `Daily/2026-07-24.md` into `Daily/2026-07-27.md`. Watch the file explorer for 30 s:
    the file must **not** rename at all (before this it renamed continuously).
25. **A ✅ note with an unchecked box survives a restart.** Add `- [ ] follow up` to a
    ✅ note, restart Obsidian → it stays ✅ (it used to be auto-reopened to ◻️).
26. **A stray date-named note is not a day plan.** Create `Meetings/2026-07-24.md` with
    a checkbox line → it must not appear on the timeline, and no 📅 file is renamed.
27. **User text is never mangled.** Rename an event to
    `📅 By 2026-07-24 at 14.00h, meet at - 1 - Bob (at home)` and drag it: the words
    "at" and the parentheses must survive.
28. **Late-evening blocks are clamped.** Drag-create a block starting 23:15 → the line
    reads `23:15 - 23:59`, never `24:15`.
29. **A midnight-crossing line refuses to drag.** Add `- [ ] 23:00 - 01:00 Sleep`; the
    block is drawn to the bottom of the day, has no resize handle, and dragging it does
    nothing (its end time stays `01:00`).
30. **Existing formats are untouched.** With the shipped `data.json`, Settings shows the
    goal format as `{action} - {amount} - {outcome}` — the identity version is offered
    by a button, never applied for you.

### One system

31. **Sidebar drives the timeline.** Open both. Click a day inside the visible week →
    the timeline does **not** jump (the ring moves). Click a day two months out → the
    timeline pages to it and the sidebar stays there — no ping-pong.
32. **Opening a note highlights but doesn't yank.** Open `Daily/2026-11-20.md` → the
    ring moves to it; the timeline keeps its position.
33. **The embedded calendar.** In Week range a compact month sits left of the grid;
    click a day → the grid zooms to it. Collapse it, reload Obsidian → still collapsed.
    Switch to Month → the rail and its toggle disappear (the body is already a calendar).
34. **Today scrolls to now.** Scroll to midnight, press Today at any afternoon hour →
    the grid scrolls so "now" is near the top. Works twice in a row.
35. **Day zoom.** Click a week-view day header → zooms to that day. Ctrl/Cmd-click →
    opens its daily note. Right-click → day menu.
36. **One ribbon icon.** Only the timeline icon is in the ribbon; the calendar opens
    from the timeline's ◧ button or the "Open calendar" command.
37. **Navigation commands.** Bind hotkeys to `Timeline: next period` / `previous` /
    `go to today` / `zoom out` / `toggle calendar` — all work; old `open-timeline-week`
    hotkeys still work too.
38. **ICS in the sidebar.** With a remote calendar configured, its events now produce
    dots in the sidebar (they used to be timeline-only).
39. **Year density.** In Year range, busy days show a visibly larger/darker dot than
    quiet ones.
40. **Overlap chip.** Put two blocks at 10:00–11:00 → the toolbar shows `⚠ 2` and both
    blocks carry a stripe. Clicking the chip jumps to the day.

### System vocabulary

41. **🔁 routines.** Right-click a note → Convert to routine 🔁 → the modal asks for
    Action / Amount / Outcome / **Cycle**, producing e.g.
    `🔁 Consume - 0mg - of caffeine after 14.00h - per day ☕`.
42. **Identity on goals.** Settings → "Use the recommended goal format" → converting a
    folder to 🎯 now asks for Identity first.
43. **Format-driven forms.** Open a 🔁 note → the properties sidebar shows four inputs
    including Cycle. Apply is disabled (with a red outline) until required fields are
    filled, and a no-op Apply does not touch the file.

### One tab, all-day drag, and creation

44. **One view, two homes.** Run **"Task Notes: Open Task Notes"** → it opens as a
    normal tab. Run **"Task Notes: Open Task Notes in the sidebar"** → the SAME view,
    docked right. There is no second view type and only one ribbon icon. A workspace
    saved with the old separate calendar view still restores (the old id is aliased).
45. **The calendar is inside it.** In Day/Week the month sits at the left (toggle with
    the calendar button or `Timeline: toggle calendar`); in a narrow pane it stacks on
    top instead of disappearing. It carries the event / task / word-count dots the old
    sidebar had — and it is a compact block of 26px rows, not a grid stretched down the
    whole rail.
46. **Drag an all-day item onto the grid.** `- [ ] Water the plants` (untimed) and the
    multi-day conference show as chips above the grid. Drag a chip down onto a column:
    a ghost follows the pointer, and dropping it writes a time (`08:00 - 09:00` at the
    drop point). Releasing outside the grid changes nothing. Remote (ICS) chips are not
    draggable.
47. **Creating a routine tells you what happened.** Command palette → **"Convert active
    note to routine 🔁"** (every entity now has a command, not just events). Leave a
    field blank and press Create → a Notice lists exactly which fields are missing and
    the empty ones get a red outline. Fill them → the note is renamed and a
    "Converted to task: …" notice appears.

### v2.3 fixes — drag, titles, and the whole-note scan

52. **The all-day drag actually works.** Drag `- [ ] Water the plants` onto a column.
    The note must **not** open (the old chip opened it on every drag, which is what made
    the drag "not work"), and the line gets a time. Drop it back on the same day → the
    time changes, the day does not.
53. **A multi-day chip moves relatively.** The conference spans two days and draws a chip
    under each. Grab the chip on its **second** day and drop it one column to the right:
    both its start and end move forward by exactly one day. (Before: the start teleported
    to the drop day, the line jumped notes, and the file was renamed. That bug is what
    renamed the fixture in `test-vault/`.)
54. **Click near a block's right edge.** Press and release on the right-hand few pixels of
    a block without moving. Nothing is written and the block does not change day — the day
    is hit-tested in the DOM now, not computed from a rect that drifts by the scrollbar's
    width. The day headers line up with their columns for the same reason.
55. **Chip → chip.** Drag an all-day chip sideways onto another day's all-day lane: it
    changes day and stays untimed.
56. **Titles are verbatim.** A block shows exactly the text after the time —
    `📅 By 2026-07-24 at 14.00h, prepare - 1 - deck`, emoji and all — not just
    `prepare - 1 - deck`. `[[Note|alias]]` shows the alias. All-day chips, month chips and
    the timeline agree.
57. **Timed lines anywhere in the note show up.** Add `- 16:00 Reviewed the deck` under
    `## Log` in today's daily note → it appears on the timeline at 16:00. Drag it → it is
    rewritten in place and **stays checkbox-free** (no `[ ]` is added). Prose bullets
    under `## Notes` with no time do NOT appear. A `tags:` list in frontmatter does not
    appear. A `## Log` line linking a 📅 note does not make that note "duplicate", and
    never renames it — only lines in the day-plan section can do that.
58. **Moving a line out of its section says so.** Drag that `## Log` block to another day
    → a Notice names the heading it landed under, because the line moved into the day-plan
    section of the destination.
59. **Remote calendars report themselves.** Settings → Remote calendars: each calendar
    shows its own status line (`12 events · updated 14:32`, or the error). Paste a bad
    URL → a red status and one Notice. Fix it → it goes green on the next refresh.
    A feed with `TZID=Europe/Berlin` now lands at the correct local hour (before, every
    event in a non-local-zone feed was offset — the feed's VTIMEZONE was never registered).
    Removing a calendar asks first.
60. **Settings say what the plugin does on its own.** The first section, "Automatic
    changes", names all three automatic writes and holds their switches. The seven name
    formats are collapsed behind a disclosure.
61. **Schedule today's events.** Command palette → **"Task Notes: Schedule today's
    events"**: it lists 📅 notes dated today that no planner line links yet, with one
    button each (and "Add all"). Closing it writes nothing.

### v2.4 — nested blocks, live checkboxes, structure-independent placement

Open `Daily/2026-08-08.md` in the test vault: it is shaped like a real, heavily
nested daily note (`## ⏰ Schedule` → `### 📅 Daily` + `### 🎯 Timeboxing`, hour
rows with tab-indented children, `==group labels==`, a `## Log` line). Then open
the timeline on that day.

62. **Indentation is the block's body.** The `07:00 - 08:00` row shows as ONE block
    listing its six children, each with its own checkbox, indented as in the note.
    Before this, those children were six separate all-day chips and the row itself
    was labelled `(untitled)`.
63. **The block is named by its time and its progress.** The head reads
    `07:00–08:00 … 1/6` — the counter counts checkbox rows in the whole subtree, so
    it does not change when "Show completed blocks" hides the ticked ones.
    `10:00 - 11:00 [[🔁 Do - 1 workout …]]` keeps its own text as the title.
64. **A label keeps its children.** Under `08:00 - 09:00`, `📅 Monthly - First Mon`
    renders as a muted label with the `📅 Attend …` line indented beneath it — and
    the label has no checkbox, because the line in the note has none.
65. **Click to expand.** Click the `07:00` block: it opens over its neighbour and
    shows every row; click again to collapse. Double-click still opens the note,
    Ctrl/Cmd-click still opens the daily note at that line, dragging still moves the
    block (and collapses it), right-click still opens the menu.
66. **Ticking writes exactly one character.** Tick a child → only that line changes
    in the note. Check the `13:00 - 14:00 ` row (it has a trailing space) and any
    loosely written time: neither is reformatted. Nothing is renamed by a tick.
67. **The right one of two identical rows.** `Drink min. - 750ml - of tap water 💧`
    appears under both `07:00` and `13:00`. Tick the one under `13:00` → the one
    under `07:00` stays unticked.
68. **A label cannot be ticked.** There is no checkbox on the `==📅 Monthly …==`
    row, and the plugin never adds one.
69. **Dragging a block takes its body.** Drag the `07:00` block to the next day → a
    notice says it moved the block and its 6 sub-items, all six arrive with it, and
    none are left behind.
70. **New events land in time order, with no heading.** Drag out a new block at
    12:00 → the line is written between the `10:00` row (after ALL its children) and
    the `13:00` row. No `## Day planner` heading is created, and no existing row
    loses a child.
71. **Untimed prose stays out.** The `## Notes` bullets never appear; the `## Log`
    line `- 16:00 Reviewed the deck` does, at 16:00, and stays checkbox-free when
    dragged.
72. **A freely-named 📅 note is never renamed.** `📅 Attend - 1h - monthly planning
    at Logisitsy - First mon at 08.00h ✍️` has the emoji but not the `By <date>`
    grammar. Whatever you set the planner heading to, its filename must never change
    — and your template's link to it must never be rewritten.
73. **Windows line endings.** Save a daily note with CRLF: it now parses at all.
    Before, `.` not matching `\r` meant every line of such a note was invisible.
74. **Plan ahead, template later.** Schedule an event on a future day → the new note
    holds only the heading and your line, with no template. When that day arrives (or
    you open the note), the template is merged around it and the line is still in
    time order. `{{yesterday}}` / `{{tomorrow}}` / `{{date+3d}}` in the template now
    resolve instead of surviving as literal text.

### v2.5 — heading, all-day, hours, ranges, calendars

75. **The timeline heading now does something.** Settings → Timeline → **Timeline heading**.
    Open `Daily/2026-08-08.md` in Day view, then set the heading to `## ⏰ Schedule`.
    The 13 `### 📅 Daily` routines appear as all-day chips **without touching a file**
    — settings that are read while indexing now trigger a re-read. Set it back to
    `## Day planner` and they go away again.
76. **All-day strip.** Three chips per day, then `+N more`; the `+N` control in the
    ruler corner opens the whole strip (max a third of the pane) and `−` closes it.
    Every chip has a working checkbox.
77. **A nested timed line is part of its block.** In a daily note write
    `- [ ] 09:00 - 11:00 Parent` with `	- [ ] 09:30 - 10:00 Child` under it. ONE block
    appears, with `09:30 Child` as a row inside it — not two blocks side by side, and
    no ⚠ overlap warning. A timed line nested under an *untimed* bullet still gets its
    own block.
78. **Visible hours.** Settings → Timeline → **Visible hours: from / to**. Set 07:00–22:00:
    the grid starts at 07 and ends at 22. Open 2026-08-08, which has a `04:00` row —
    that day stretches to 04:00 so nothing is hidden. Drag, resize, create and the
    now-needle all stay correct in the narrowed grid.
79. **Completed items are hidden by default.** Tick anything → it disappears from the
    block, the strip, the block body and the calendar. Settings → **Show completed
    items** brings them back.
80. **6 months and Year are reachable.** The toolbar's `⋯` button opens a menu with
    3 days · 6 months · Year, the current one check-marked. The title button now steps
    Month → 6 months → Year, and is disabled (not silently dead) at Year.
81. **Remote calendars, no account needed.** Settings → Remote calendars shows two:
    **Sample (local file)** pointing at `test/sample-calendar.ics` inside the vault, and
    **German holidays** over the network. The sample gives you all-day chips (including
    a three-day conference), timed blocks in Berlin time, a weekly series with one moved
    occurrence, an overnight event, and one declined meeting that must NOT appear.
    A calendar source with no `https://` / `webcal://` scheme is read from the vault.
82. **The template comes from core.** Settings → Template application states it, and
    lists every placeholder. There is no Task Notes setting for the daily template —
    it is the core Daily Notes (or Periodic Notes) one.
83. **Catching up a skipped day.** `Daily/2026-08-06.md` is bare and its day has passed.
    Run **"Apply daily template to bare past notes"** → it lists the dates and asks
    first; confirm, and the template is merged with `- 05:00 - 06:00` preserved. Nothing
    happens automatically, and nothing is written if you cancel.

### v2.6 — ranges, affordances, tickable remote events

84. **The ranges read in order.** The toolbar shows **Day · 3 days · Week · Month**
    and then a chevron pill. Open it → 6 months and Year, the current one ticked.
    Pick 6 months → the pill reads **6 months ⌄**: still hovers, still opens. The
    title button now steps Day → 3 days → Week → Month → 6 months → Year, and at
    Year it is plain text rather than a button that underlines and does nothing.
85. **The overviews look clickable.** In 6 months and Year, every month title is a
    bordered control (the month containing today is accent-outlined), and a day
    cell fills and rings on hover with its number darkening. The grid must stay
    compact — 26px rows, no sprawl.
86. **Show/hide completed from the toolbar.** The double-tick button next to the
    calendar toggle. Ticked items vanish or return instantly, including rows inside
    a block and calendar chips. There is also a command, "Show/hide completed items",
    which works with no timeline open.
87. **Remote events are marked.** Every event from a subscribed calendar carries a
    small cloud glyph — on the timed block, the all-day chip and the month chip —
    drawn in the same colour as its text, so it stays legible on any calendar colour.
    In the sidebar rail, remote days are **squares** in their calendar's colour;
    local ones stay round accent dots. Tooltips name the calendar everywhere.
88. **Ticking a remote event hides it — locally.** Tick the sample calendar's
    "Standup" → it disappears. The toolbar's completed button brings it back, struck
    through with a ticked box; untick it and it is normal again. **Nothing is ever
    written to the calendar** — check `test/sample-calendar.ics` is byte-identical.
    Right-click a remote block for the same thing plus "Refresh remote calendars".
89. **It survives a restart.** Hide one, reload Obsidian → still hidden. The state
    lives in `data.json` under `hiddenRemoteEvents`, keyed by calendar.
90. **Disabling ≠ deleting.** Disable the sample calendar in settings and re-enable
    it → the occurrence is still hidden. **Delete** the calendar and add it back →
    it is visible again, because its marks went with it.
91. **The tick does not fight the drag.** Pointer-down on a remote checkbox starts no
    drag and moves nothing; pointer-down on the remote block itself still does
    nothing (remote events are read-only). Tab to a checkbox inside a block and press
    Space → the box toggles, the block does not expand. (That last one was broken for
    local sub-items too.)
92. **A hidden occurrence does not notify.** With notifications on, hide an event due
    in the next few minutes → no notice.
93. **Narrow pane.** Dock the timeline into the sidebar: the toolbar reflows, title
    on its own line, ranges beneath. This never worked before — the rule was written
    against a container that does not contain the toolbar.

### v2.7 — correctness, verbatim labels, layout

94. **A move onto a day that already has that line is refused, not destructive.**
    Put `- [ ] 09:00 Standup` in two daily notes, give one of them sub-items, and
    drag that block onto the other day. A notice says the day already has that
    exact line, **and nothing is lost** — the block and every sub-item stay where
    they were. (Before: both were deleted from both notes.)
95. **A nested 📅 link is never renamed.** Write `- [ ] 08:00 - 09:00` with
    `\t- [ ] 10:00 [[📅 …]]` under it. The 📅 file's name must never change, however
    much you edit that day — it is a step inside a block, not the block's schedule.
96. **The toolbar date does nothing.** Clicking it used to zoom out to 3 days and
    the workspace remembered it forever, which is why the view kept opening in
    3-day. Ranges change only from the range buttons.
97. **Adding and removing calendars visibly works.** Settings → Remote calendars →
    **Add calendar**: one row appears, its name field focused, and the pane does
    NOT jump to the top. Remove one: that row goes. A calendar whose entry is
    missing fields no longer breaks the pane.
98. **Labels are literal.** A block linking `[[📅 By 2026-07-24, prepare - 1 - deck]]`
    shows the brackets. `[[note|alias]]` shows the pipe. Only `==text==` still
    draws as a highlight.
99. **The all-day lane.** It now sits UNDER the day headers, is labelled "All day"
    in the ruler column, has dividers matching the grid, roomier chips, and one
    honest counter — the ruler control offers the total hidden, and each column
    shows its own. A day hiding exactly one chip just shows it.
100. **Remote events are outlined, yours are filled.** A subscribed event is a
    bordered card in its calendar's colour with a cloud glyph; your own events stay
    solid. Ticking one still hides it locally and never touches the calendar.
101. **Checkboxes are visible everywhere** — 16px, drawn explicitly, with hover and
    focus states, legible on an accent block, a neutral card and an outlined remote
    event alike.
102. **A chip dropped at the bottom keeps its length.** Drop a chip near 23:50 with
    a 60-minute default → `23:00 - 24:00`, not a 15-minute event (and no rename to
    match a duration you never asked for).
103. **The grid does not jump.** With a narrowed window, add an early line to the
    note you are looking at → the blocks stay where they are on screen.
104. **Narrow pane.** Dock the timeline to the sidebar: the calendar rail stacks
    ABOVE the grid (this never worked — the rule targeted a container that cannot
    match itself), day headers ellipsise, and the range group scrolls rather than
    being clipped.
105. **Settings say what they do.** "Automatic changes" now lists **three**
    switchable behaviours and its prose is generated from the same list, so it
    cannot claim a different number. The third — reopening a ✅ note that gains an
    unchecked item — previously had no switch at all.
106. **Nothing fails silently.** Disable core Daily Notes and drag a block onto an
    empty day → a clear notice, and **no note in the vault root**. Point the daily
    template at a missing file → the error says so instead of "nothing to merge".
    A calendar URL returning an empty body says so instead of "0 events".

### Round 8 — native checkboxes, a finished grid, zoom

107. **The checkbox is Obsidian's.** Tick a box in a block, in an all-day chip and in
    a nested body row — all three look exactly like a checkbox in a note, and the
    active theme's own styling applies (the "Things" theme rounds them). Nothing is
    drawn by the plugin any more: our rules used to LOSE to Obsidian's on specificity
    and leave only their leftovers painted over the native tick, which rotated the
    checkmark 45° and drew a border fragment through it.
108. **Blocks are tinted cards.** Every block is the note surface tinted with its own
    colour, a solid bar of that colour down the left, and normal text. A block with
    children shows the tint as a header bar over a plain body. A remote event keeps a
    full ring in its calendar's colour plus the cloud glyph, so "mine" and
    "subscribed" are still distinguishable at a glance.
109. **The grid reaches the right edge.** The scrollbar is 8px with a visible thumb
    instead of a wide empty strip, and the all-day lane no longer reserves TWO
    gutters — its chips now line up with the day headers above them. Check the day
    header, the all-day chips and the blocks all end at the same x.
110. **Day headers are the note's name.** A header reads `2026-08-11` — the core
    Daily Notes format, so it matches the file Ctrl/Cmd-click opens. Change that
    format in Obsidian's settings and reopen the timeline: the headers follow.
111. **The all-day lane scrolls; nothing is hidden.** Put ~15 all-day items on one
    day. The lane grows to fit, caps at a third of the pane, then scrolls — no
    "+N more". The open/close control appears once it is capped and **stays present
    while open**, which is the bug it replaces: expanding used to drive the hidden
    count to zero, which unmounted the only button that could close it again.
112. **Zoom.** Ctrl/Cmd-scroll over the grid: hours grow and shrink and **the time
    under the pointer stays put**. The −/+ buttons in the ruler corner do the same
    from the middle of the view. Afterwards the settings tab's "Hour height" slider
    shows the same value — one setting, not two. Spin the wheel hard: `data.json`
    is written once, ~0.4s after you stop, not once per wheel tick.
113. **Nothing was rewritten.** After all of the above, `test-vault/Daily/2026-08-11.md`
    still contains its eight hand-written `- [ ] - [ ] [[…]]` lines byte for byte.
    The timeline shows them verbatim because that is what the note says; the plugin
    did not write them and does not correct them.

### Round 9 — the multi-day bug, quieter blocks, deep zoom, links

114. **THE BUG: a multi-day event keeps its time.** `📅 By 2026-07-28 at 20.00h -
    2026-07-29, attend - 1 - conference` now draws **at 20:00 on the 28th, running
    into the 29th** — not as an all-day chip. `dayBlocks` used to sort on "does it
    have an end date" *before* it ever looked at the start time, so any multi-day
    event lost its time however precisely it had been scheduled. A remote 3-day
    calendar event had the inverse bug and filled every middle day 00:00–24:00.
115. **No day of a span can be dragged.** Its geometry is the day, not the
    duration — dragging it would write the drawn shape back and destroy the span.
    Same rule as a line running past midnight.
116. **Blocks have no bar behind the main line.** The block's own line is bold at
    full strength and its children are **indented** and dimmed, like an indented
    list in a note. Until now a depth-1 child computed a 0px indent, which is why
    the tinted header had to carry the whole job.
117. **Every state has its own channel.** Left bar = whose event it is · border =
    local vs remote · outline = not in the day plan · inset ring = active 🅰️ ·
    right stripe = overlaps · opacity = done · elevation = happening now. Check a
    block that is unlinked AND duplicate: both still show. Expand the active
    block: it keeps its ring (it used to lose it).
118. **The block you are in is marked.** The event covering the current minute
    takes the needle's colour and lifts off the grid. Nothing marked it before.
119. **Zoom reaches 800px/hour** and reveals more as you go: half-hour rules from
    200px, quarter-hours from 400px, and a block's row cap now scales with the
    room it actually has (it was a flat 12 regardless of zoom).
120. **The all-day lane obeys the pane.** Drag the divider under it to any height;
    double-click to fit its items. Then split the pane horizontally — the lane
    shrinks on its own. Its cap used to be a share of the WINDOW, so a split pane
    could not shrink it and the grid got squeezed to nothing.
121. **New time block, with links.** Drag on empty grid → the dialog is a proper
    form, not a settings row with a field pinned to the right. Type `[[` → vault
    notes are suggested; pick one and `[[Name]]` is spliced **at the caret**, with
    the text either side kept. That is the future-event workflow: the line links
    the note, and the note's template still waits for its day.
122. **Calendar colours are a swatch.** Settings → Remote calendars: a real colour
    picker, pre-filled with the colour that calendar is actually drawn in (a blank
    text box used to hide it), plus a reset-to-automatic button. Drag the picker —
    the grid recolours and **no network request is made**.
123. **Notifications say what they can do.** Enabling asks the OS and reports a
    refusal instead of silently degrading to in-app notices. A desktop reminder is
    clickable and opens the event. All-day items finally notify, on the morning of
    (configurable, −1 for never). On mobile the settings copy states plainly that
    no plugin can post a system notification and that the timer stops in the
    background — rather than implying otherwise.
124. **Nothing mangles a line.** `tests/text-integrity.test.ts` pins it: parse →
    serialize is a fixpoint over the vault's oddest real lines, ticking a box
    changes exactly one character, and every whole-note operation leaves the lines
    it was not aimed at byte-identical.

### v3.0 — DST, the day header, settings by subject

125. **THE DST BUG.** Set the machine clock to **2026-10-25** (a 25-hour day in
    Europe). An ICS event at **23:30 appears at 23:30** — it used to not be drawn
    at all, because the day's end resolved to 23:00. A 09:00 ICS event draws at
    09:00, not 10:00. A reminder for a 09:00 event fires at 09:00, not 08:00.
    Repeat on **2026-03-29** (23 hours), where everything was wrong the other way.
    `timeOnDayTs` was `midnight + n×60000` under a comment claiming otherwise.
126. **A day header's note button opens a MENU.** Each header carries a page
    icon, the same height as the zoom buttons at the other end of the row: filled
    means the note exists, outlined with a `+` means there is none yet. **Left**-
    clicking it opens the day menu — *Open daily note* / *Open daily note in new
    tab*, and, only when the note already exists, *Apply daily note template now*
    below a separator. With no note yet the first two items read *Create and
    open…*, because creating is a write and is never disguised. Right-clicking
    anywhere in the cell opens the identical menu (one list, `core/day-menu.ts`).
    A chevron beside the icon says it opens a menu; it disappears below ~110px of
    column, and the button itself below ~72px, where right-click is the route.
    Clicking the header TEXT still zooms to that day; Ctrl/Cmd-click opens the
    note, Ctrl/Cmd+Shift opens it in a new tab (the shared `dayIntent` rule, which
    the header used to implement only half of). There is a command too: *"Open the
    focused day's daily note"*. Delete a day's note and the icon flips within a
    flush.
127. **Sub-foldered daily notes read correctly.** Set the core Daily Notes format
    to `YYYY/MM-MMMM/YYYY-MM-DD`. Headers show **`2026-08-11`**, not
    `2026/08-August/2026-08-11`. Narrow the pane until the columns are tiny — the
    label becomes `Tu 11` rather than an ellipsised `2026-0…`.
128. **No note is ever written to the vault root.** Disable core Daily Notes, then
    click a day's note icon: a notice **naming the plugin to enable**, and **no
    file created anywhere**. The guard used to pass, because the library it asked
    swallows its own error and returns defaults.
129. **The all-day lane's reset works, repeatedly.** Drag the divider down, then
    click the chevron (or double-click the divider) — it returns to fitting its
    items, every time. It used to be a ratchet: the lane measured its own height
    as its "content", so the reset did nothing and then the button hid itself.
130. **Two fingers cannot reschedule anything.** On a touchscreen, rest one finger
    on the lane divider and drag an all-day chip with another. Lifting either
    finger must not move the event. Each gesture now only answers to the pointer
    that started it.
131. **A fast Ctrl-scroll does not jitter.** Spin the wheel hard over the grid:
    the scale changes smoothly and the scroll position does not fight itself.
132. **Settings are grouped by what you're configuring.** *What Task Notes does on
    its own · The timeline · Daily notes & the planner · Calendar dots & creating
    notes · Remote calendars · Reminders · Advanced.* The planner heading now sits
    with the setting that inserts lines under it. **Toggling anything no longer
    scrolls the pane to the top** — in particular "Apply templates on conversion",
    which used to rebuild the disclosure closed and hide the row you just clicked.
    Add a calendar: the **new** row's name field is focused (it used to focus the
    previous calendar's email box), and typing a name updates its header live.
133. **The template explains itself.** Under "Daily notes & the planner": which
    template is in use, exactly when it is merged automatically, and two buttons —
    *Apply to today* (which refuses to create the note and says so) and *Find
    them* for past days that never got it. The same action is now in the file menu
    when you right-click a daily note.
134. **Narrow and touch.** In a ~350px sidebar: deeply nested block rows keep their
    text (indentation is capped at a third of the row), the "add to plan" badge
    stays on one line, the hour labels are not clipped, and "ALL DAY" does not
    push its own control out of the lane. With a touchscreen, the lane divider and
    the zoom buttons are big enough to hit.

135. **Today spans its whole column, without filling it.** In Day/3-day/Week the
    current day wears a 2px accent bar across the FULL width of its column, flush
    with the header's own divider rather than stacked on top of it, and its date is
    accent-coloured. The cell behind it is never filled — a filled cell put
    light-on-accent text and an accent checkbox on an accent background. Check the
    bar lines up exactly with the column below it, including with a visible
    scrollbar (that alignment is `--tn-sbw`) and at every ruler width. It has been
    wrong in both directions: once an ~800px filled slab, once a rule only as wide
    as the date's own text. The month grid keeps its round pill, deliberately.
136. **A shorter all-day lane shows FEWER chips.** Drag the divider up: the chips keep
    their size and the lane scrolls, instead of every chip squashing into a sliver.
137. **No "Zoom to this day" in the day menu.** A plain click on any day already does
    exactly that, everywhere.
151. **Drag a block INTO the all-day lane.** Grab a timed block and drag it up:
    the lane highlights, the time ghost disappears, and dropping makes it an
    all-day item that STAYS there after the index rebuilds. The snap-back is the
    failure mode — it happened because the index read the time from the FILENAME
    when the line had none, so an untimed line was undone on the next rebuild.
    Check the file explorer afterwards: the note's name is unchanged.
151b. **Untimed lines now sit in the lane.** A planner line with no time that
    links a 📅 note whose NAME carries one used to draw at the name's time; it now
    draws all-day. This is a display change only — nothing was written or renamed
    — and dragging it back down restores a time on the line.
152. **Drag a chip OUT of the lane.** Still works, and still lands at the time you
    dropped it. Try it on a day whose lane was empty before the drag started.
153. **The sidebar calendar is not a drop target.** Drag an all-day chip over the
    rail and release: nothing moves. It used to resolve a date from the MONTH grid
    and silently move the event to another month, because both emit `data-daykey`.
154. **A chip and a block look like one thing at two sizes.** Same background,
    same tinted hairline, same 4px left edge — only the shape differs. The chip
    used to be a 15% accent wash while the block was outlined, which is the
    difference you noticed between the lane and the grid.
155. **A block that is active AND happening now keeps both marks.** The "now"
    elevation used to replace the active ring outright. Same for a block that
    crosses midnight and continues into the next day — it keeps its dashed marker.
156. **A calendar event survives being converted.** Create a task note from a
    remote event: no dialog, and both the calendar event and the new note show
    side by side. Hiding the calendar copy is still one tick on its checkbox.
145. **`==highlight==` is actually visible.** In a block title, an indented
    sub-row, an all-day chip and a month chip. This failed three times while the
    rendering was working perfectly: Obsidian styles `b`/`strong` and `i`/`em` as
    BARE element selectors but scopes `mark` to `.markdown-rendered mark`, so our
    `<mark>` was in the DOM and unstyleable. The fix is that class on every
    surface we render into — `tests/styles-hygiene.test.ts` now fails if it is
    dropped, and also fails if any rule sets `background: none` on a `mark`.
146. **The ➕ asks first, and shows what it will do.** It appears on hover (always
    on touch). Clicking opens the create dialog headed *"Add to the day plan"*,
    prefilled with the note's date, time and name, plus a **Duration** field.
    Cancel writes nothing. Confirm writes the planner line and renames the note
    only to what you saw. Test an untimed `📅 By 2026-08-25, …` note specifically:
    a dialog line must say the time is a proposal. It used to invent 08:00, write
    it into the line, then rename the note to match — rewriting every wikilink to
    it in the vault, with no prompt at all.
147. **New notes land where Obsidian says.** Set *Default location for new notes*
    to a folder, then convert a remote calendar event. The note appears there, not
    in the vault root.
148. **The sidebar has surfaces again.** In the task-properties panel the input
    boxes are visibly distinct from the card, and the card from the panel. All
    three used to be `--background-secondary` — one flat wash with three invisible
    hairlines, which is what "the styling looks off" meant.
149. **A narrow column still shows titles.** Week view in a ~300px sidebar: blocks
    show their title, not just a clipped `07:0…`. The time now yields instead of
    the title.
150. **Range pills respond to a press,** and on touch the small controls (month
    chips, `+N more`, the ➕) have real tap targets — three of the four were
    clipped to nothing by an ancestor `overflow: hidden`.
139. **Unticking a remote event sticks.** Tick a calendar event, untick it, tick it
    again — the box must follow every click. With show-completed ON, the box and the
    strike-through must agree at every step (they disagreed before: the model
    flipped, the box did not). `preventDefault()` on a checkbox restores it at the
    end of dispatch, after Svelte's memoised setter has already recorded the new
    value; only the remote path published fast enough to lose that race.
140. **A 📅 note appears on the day its NAME says.** A note dated 2026-08-25 that is
    linked from a *different* day's planner (say 2026-07-24) must show on BOTH: a
    real block on the day it was planned into, and a dashed "not in the day plan"
    ghost on 2026-08-25. Suppression is date-scoped — a link on any other day used
    to hide the ghost entirely while the block sat on the wrong day.
141. **Buttons are the colours we set.** Apply in the properties panel is
    accent-filled; toolbar buttons keep their own backgrounds. Obsidian's
    `button:not(.clickable-icon)` is specificity (0,1,1) and beat every lone class,
    so ours silently rendered in Obsidian's grey. Primary buttons wear `mod-cta`;
    the rest are `button.`-qualified.
142. **The properties panel names the type.** The header reads `📅 By 2026-08-25 …`
    — emoji first — and the fields card no longer repeats it as a heading.
143. **A calendar event can become your own note.** Right-click a remote event →
    *Create a task note from this event*. The create dialog opens with the date and
    time filled in and the title as the action; amount and outcome are yours to
    write. Cancel writes nothing. After creating, it OFFERS to hide the calendar
    copy — never does it silently, and your calendar is untouched either way.
144. **Markdown renders in the grid.** A planner line
    `- [ ] 10:00 Review the ==investor== deck` draws with a real highlight; `**bold**`
    is bold. Headings, images and embeds are flattened so one line stays one line.
    Check a busy day at several zoom levels: text is rendered once per change, not
    once per redraw.
138. **The plugin adds no properties to your notes.** A bare note it creates is the
    planner heading and its lines — no frontmatter. Anything in `Properties` came from
    your own daily-note template.

### Regression: legacy features

48. **Legacy features still work.** Right-click a normal note → Convert to scheduled 📅
    (fill the modal) → it's created and linked. Pressing **Esc** in that modal (or the
    "New time block" prompt) cancels cleanly and nothing is written. File-explorer
    checkboxes appear, and **right-clicking a checkbox opens the menu** including
    "Use custom emoji". The task-properties sidebar edits the active task; completing a note
    with unchecked items is blocked; adding an unchecked item to a ✅ note reopens it
    to ◻️.
49. **Task properties live in the sidebar.** Run *Open task properties*, then open a
    task note — its fields appear, one per row, and change as you switch notes. Nothing
    overlaps Obsidian's status bar any more, and a task note gets its full height back.
    Press Apply and the file is renamed; open a non-task note and the panel says so.
50. **Startup is quiet.** Reload Obsidian with the plugin enabled: no mass renames happen
    on startup (check that no historical 📅 files changed).
51. **Mobile / narrow.** Shrink the window, and dock the timeline into the right sidebar:
    the mini-month grids reduce their column count based on the **pane** width, the month
    grid scrolls instead of clipping, and the time grid can still be scrolled by touch
    (drag only takes over the gesture once it starts on a block).

### v3.6 — the frozen grid, the blank labels, and creating a note from a drag

Everything in this round came from one session's screenshots: a header that said
`2026-08-10` under a title that said *Tuesday, August 11*, and blocks with no
text in them at all. Both were display bugs with vault-writing bugs beside them.

52. **The grid cannot freeze into disagreement.** Move Day → Next → Prev quickly,
    twenty times, in every range. The toolbar title and the column header ALWAYS
    name the same day, and the blocks under a header belong to it. (The header and
    its blocks are now one object rather than two arrays coupled by index, so
    "Aug-11 blocks under an Aug-10 label" is unrepresentable.)
53. **A failure is loud.** If the grid ever does throw, a Notice appears and the
    pane offers *Reload the grid* — instead of a silently frozen column with a
    clean console. Nothing in normal use should trigger it.
54. **No label is ever blank.** With your real template loaded, every all-day chip,
    every block title and every body row shows its text — immediately, before
    Obsidian's Markdown renderer has run, and still after it runs. `==highlight==`
    and `**bold**` render. A note whose render produces nothing keeps its plain
    text rather than going blank.
55. **A duplicate event id no longer freezes a column.** Two blocks that end up
    sharing an id (an index hiccup, or an ICS feed emitting one UID twice) both
    draw, and the day keeps updating.
56. **Clicking an all-day chip OPENS it.** It must not write anything: watch the
    file explorer and the note's modification time. (For three days it wrote a
    `00:00 - 01:00` planner line and renamed the note — from a plain left-click.)
57. **Dragging an unlinked ghost into the all-day lane is refused.** A Notice says
    to use its ➕. No line is written, no 08:00 appears, and the note is NOT
    renamed. Same for a line living outside the planner heading: a Notice, and the
    line is left exactly as it was.
58. **A lane drop survives the next rename.** Drag a block into the all-day lane,
    then press Apply in the properties panel (or change its status). The block
    stays in the lane — the filename no longer pushes its old time back onto a
    deliberately untimed line.
59. **A drag moves what you grabbed.** Start a move on a day with no all-day items:
    the lane appears as a drop target, and the block must NOT jump by half an hour.
    Check at several zoom levels — this was zoom-dependent.
60. **Two fingers cannot reschedule.** In the month grid, start dragging a chip and
    tap elsewhere with a second finger: the drop does not happen at the second
    finger's position.
61. **The convert button is visible.** Hover a remote calendar block, and an all-day
    remote chip: a file-plus button appears beside the cloud glyph. Click it and the
    prefilled create dialog opens; the remote occurrence stays on the timeline
    either way, and your calendar is never written to. On a phone both buttons are
    permanently visible. Right-click still offers the same thing.
62. **The ➕ badge reveals on hover.** It is hidden until you hover a block (or tab
    to it), permanently visible on touch. Before this round it was on every
    unlinked block at all times — the reveal rules were dead.
63. **One button style.** Day / 3 days / Week / Month look like every other button
    in the toolbar; only the selected one is filled with the accent colour.
64. **Right-click always answers.** Right-click a local block, an all-day chip, a
    remote block and a day cell. A menu appears every time, or a Notice explains
    why — never silence. (The build of the menu is what is now guarded; a throw
    while building it used to vanish into a DOM handler.)
65. **Create a note from a drag.** Drag out a slot on the grid. The prompt now has
    a **Create as** row:
    - **Line** (default) — exactly what it always did: a planner line, no file.
    - **Note** — creates an ordinary note named by what you typed, in Obsidian's
      own "Default location for new notes", and links it into that slot.
    - **◻️ / 📅 / 🔁** — opens the properties dialog prefilled with the dragged
      date, time and duration, then creates that typed note and links it in.
    Cancel at any point writes nothing. A name that already exists is refused with
    a Notice and NO planner line is written — never a line pointing at a note that
    does not exist.
66. **Plain text skips the async renderer.** Titles made only of letters, digits
    and ordinary punctuation (every task name in this vault) no longer trigger a
    full `MarkdownRenderer` pass per redraw. Verify by looking: they still render
    identically.

#### v3.6 follow-up — what the adversarial review found

An automated review of the round above confirmed eight further defects, two of
them able to write to the vault unasked. All eight are fixed; these verify them.

67. **THE ONE THAT MATTERED MOST: clicking a block near the top of the grid must
    not strip its time.** Pick a day with NO all-day items, so the lane is not
    drawn. Scroll so a block sits within ~30px of the top of the grid, and click
    it once. It expands (or opens) and its planner line KEEPS its time. Before
    this fix, starting the drag mounted the all-day lane, which pushed the grid
    ~30px down under a pointer that had not moved — so the click landed in the
    lane and rewrote `- [ ] 09:00 - 09:30 Standup` to `- [ ] Standup`.
    Then confirm the real gesture still works: drag the same block up into the
    lane and it becomes an all-day chip.
68. **A refused move must not rename anything.** Give two different days a
    byte-identical planner line for one `📅` note, then drag that block onto the
    second day. The Notice says nothing was moved — and the note's FILENAME is
    unchanged. (It used to be renamed, and every wikilink to it rewritten, in the
    same breath as being told nothing happened.)
69. **Two open views cannot cross-write.** Open the timeline in a tab (Month) and
    again in the sidebar (Week). Drag a month chip and release it over the
    sidebar's calendar or all-day lane: nothing is written. Releasing it inside
    its own grid still reschedules.
70. **A multi-day block shows the right number of body rows.** A conference note
    with many child lines, spanning two days: each day's block shows as many rows
    as ITS height allows, with a correct `+N more`. (One day's budget used to
    overwrite the other's.)
71. **Wikilinks resolve from the note the line lives in.** An all-day chip whose
    text is `[[Acme]]`, in a vault with two notes called `Acme`: clicking through
    lands on the one the daily note's own link would.
72. **Links still render.** A planner line containing `https://meet.google.com/xyz`
    or an email address draws as a clickable link — the new "skip the async
    renderer for plain text" optimisation must not swallow those.
73. **New notes honour your folder setting.** Set *Default location for new notes*
    to "Same folder as current file", open a note inside a folder, then drag a
    block and choose Note. It is created in that folder, not the vault root.
74. **A template failure is reported as itself.** If a task type's template path
    is broken, creating that note says the note WAS created and the template did
    not apply — and the planner line is still written. (It used to say the note
    failed to be created, leaving a real note stranded with no link to it.)
75. **The range pills show keyboard focus.** Tab to Day / 3 days / Week / Month:
    the focus ring is visible on each (they live in a horizontal scroller, which
    clips an outline drawn outside the button).

### v3.7 — calm the timeline

Reported as "a bit too cluttered and unübersichtlich… maybe a bit too much
colour". The cause was not the palette: `--interactive-accent` was being used
eighteen different ways, every ordinary block carried three colour channels
before any state applied, and states *added* marks instead of replacing them, so
one block could show nine or ten at once. Three hues are allowed now — the
calendar colour (which calendar), red (now), and the accent (you selected this).

76. **An ordinary block is neutral.** A local event you are not doing right now,
    that is in the plan and not a duplicate, has NO colour: a plain card with one
    neutral hairline, no left bar, no shadow. Count the hues on a normal day —
    there should be at most the calendar blue, the red needle, and the accent on
    today.
77. **Each state still reads, and only one at a time claims the left bar.** Check
    all six: from a calendar (bar in the calendar's colour + cloud glyph), a
    duplicate (orange bar), happening now (red bar), not in the plan (dashed
    neutral outline), the active 🅰️ task (accent inset ring), done (dimmed +
    struck through). A remote event happening now goes **red, not blue** — "the
    one you are in" outranks "this came from Google". That is deliberate.
78. **Overlaps have no per-block mark.** Two colliding blocks are drawn side by
    side, which is the signal; the toolbar's ⚠ chip still counts them and jumps
    you to the first. Nothing is orange in the grid unless it is a duplicate.
79. **Nothing floats except an expanded block.** No block has a drop shadow; the
    current one no longer glows. Click a block with sub-items — the expanded card
    lifts over its neighbours, and if it is also the active task it keeps its
    accent ring.
80. **The grid recedes.** Hour lines, column separators and the half-hour marks
    are lighter than a block's own edge, so events sit in front of the grid
    rather than in it. Check both themes: the lines must still be visible in dark.
81. **A short block gives its space to its title.** Below ~40px the `10:00–11:00`
    label is dropped (it is still in the tooltip, and the block's position says
    the same thing). Zoom in and it comes back. A block with no title of its own
    keeps its time either way.
82. **Today is marked once.** The accent bar under the column; the header text is
    normal-coloured and bold, not accent-coloured.
83. **A line past midnight, and multi-day halves, actually look different.** A
    `23:00 - 01:00` block shows its dashed bottom edge; the two days of a
    multi-day event lose their facing corners and read as one interrupted shape.
    (All of these were silently overridden before this round.)
84. **The toolbar toggles show whether they are on.** "Show completed items" and
    the calendar toggle turn accent-coloured when active — they emitted the state
    but painted nothing.
85. **Touch targets.** On a phone, the ➕/convert badge and the month "+N more"
    are still comfortably tappable.

### v3.7.1 — reminders in the same visual language

86. **A reminder is drawn like a block.** Let one fire (or use *Send a test
    reminder*): the notice shows the time quietly on the first line, what it is
    about on the second, and carries a coloured left edge. Clicking it still
    opens the event, and the title underlines on hover.
87. **The edge follows the same hue rule as the grid.** Red when the thing is
    starting this minute; the calendar's own colour for a subscribed event; the
    softened accent for a look-ahead. A "starts in 10 minutes" reminder must NOT
    be red — it has not started.
88. **The spoken text is unchanged.** With a screen reader (or by reading the
    console), the notice still announces `Title — Starts at 10:00`; only the
    element is restructured.

### v3.8 — the template bug, the missing reminder, one dialog

89. **THE ONE TO CHECK FIRST — the template no longer applies twice.** Convert a
    remote calendar event into a 📅 note, open it and note its length. The block
    draws dashed because it is not in the day plan yet. Press ➕ and confirm. The
    note body is **unchanged** — the template is in it once. (`convert` used to
    apply the template on every call, and the ➕ flow calls it to rename an
    already-📅 note, so the template was appended a second time.) The notice now
    says *Renamed to:* rather than *Converted to task:* on that path.
90. **A converted plain note still gets its template.** Right-click an ordinary
    note → Convert to scheduled 📅 → the template is applied once.
91. **Reminders are harder to lose.** Create an event two minutes out and leave
    Obsidian open. Previously a reminder whose event reached the index just after
    the tick that should have delivered it fell outside the window for ever.
92. **A failed reminder no longer eats the others.** If one reminder cannot be
    delivered, a Notice says which, and every other reminder in that minute still
    arrives — and the failed one is retried rather than marked delivered.
93. **Reloading does not replay reminders.** Reload Obsidian within a minute or two
    of a reminder that already arrived: it must not arrive again.
94. **"Send a test notification" now answers the question.** It says where
    reminders come from on this machine — system, or in-app and why — as well as
    what is armed.
95. **Not in the day plan is unmissable.** Those blocks and chips wear an orange
    dashed outline AND an orange dashed left bar, and their ➕ is always visible
    (not hover-only). One that is also happening now goes red — "now" still wins.
96. **Overlaps are marked again.** Two blocks at the same time each get a thin
    orange line along their top edge, and the toolbar's ⚠ N is orange again. On a
    day with eight collisions it should read as information, not as alarm.
97. **The other two warnings look like warnings.** Try to tick a note that still
    has unchecked items — the refusal names the note on two lines with an orange
    edge. Break a calendar URL in settings — the failure notice matches it.
98. **One dialog.** Drag a slot and pick ◻️ / 📅 / 🔁: the fields appear
    **underneath the picker**, seeded with the dragged date, time and duration.
    No second window. Switching type swaps the fields; Line and Note show none.
    Leaving a field empty keeps the dialog open and says which. Cancel writes
    nothing.
99. **`[[` closes itself.** Type `[[` in the Task field — `]]` appears with the
    caret between them. Typing a name and stopping leaves a valid link. Picking a
    suggestion still leaves exactly one pair, and `[[[` does not add a closer.
100. **The convert dialogs still behave.** Right-click convert and the remote
    "create a task note" dialog are unchanged — they now share their fields with
    the drag dialog, so check one of each still creates correctly.

### v3.9 — the faded arrow, honest dashes, colour only where it means something

101. **The `›` arrow is crisp.** No smudge on the chevron at any pane width. The
     fade at the right of the range pills now appears ONLY when they really
     overflow — shrink the pane until Month is cut off to see it. (The mask was
     unconditional, and `100%` of a non-overflowing element is its own width, so
     the last 14px were always faded — with the button sitting right there.)
102. **Not-in-plan is dashed on three sides.** Top, right, bottom dashed; the left
     edge is the orange dashed bar. No doubled line beside the bar any more.
103. **THE MISSING WARNING: overlapping blocks are marked again.** Two blocks at
     the same time each wear a thin orange line along the top. It never painted
     before: `.tn-block-overlap` was declared above `.tn-block`, whose `border`
     shorthand reset it. A hygiene test now fails for ANY state rule above the
     base that is not `.tn-block.`-qualified — the third time this trap was sprung.
104. **An unplanned block that is happening NOW is red, not orange.** All four
     bar states share one specificity now, so source order decides and "now" wins.
105. **The lane highlights for chip drags too.** Drag an all-day chip toward
     another day's lane — that column lights up before you release. Over its own
     day it does not (dropping there is a click, not a move).
106. **One field, not two.** Drag a slot, pick ◻️/📅/🔁: the Task box disappears
     and what you typed moves into Action. Switch back to Line and the box returns
     with the text intact.
107. **A 📅 note always carries its date.** Create one from a drag: the filename
     contains `By <date> at <time>`. (`📅 Rrwar - rwar - arw` in the vault is the
     old bug's artefact — the name was generated before the date fallback applied
     while the planner line used it. It is kept in the corpus as evidence; rename
     it whenever you like.)
108. **Colour means something now.** An ordinary local block has no hue at all —
     its bar is drawn in its own outline colour. Orange = unplanned, overlapping
     or duplicated; red = now; a calendar's own colour = remote. Count them on a
     busy day: three, and every one of them is telling you something.
109. **NOW is brighter in dark mode.** The needle, its dot and the current block's
     bar take a brightened red, derived from your theme's own red rather than a
     hardcoded colour.
110. **Change a note's type from the properties panel.** Open a task note, use the
     Type row: ◻️ → 📅 → 🔁 renames the file each time. Switching to ✅ with
     unchecked items is refused with the warning notice. Clicking the type it
     already is does nothing (it would otherwise rename a file to its own name).
111. **The 🅰️ active-task feature is gone.** No ring on any block, no highlight in
     the file explorer. A file already NAMED `🅰️ 📅 …` must still work: it parses,
     it shows on the timeline, and renaming it (drag it, or press Apply) must keep
     the `🅰️ ` prefix. That is the one part deliberately kept.

### v3.10 — lifted cards, the overlap mark on the right, touch sizing

112. **THE BIG ONE: blocks read as cards on a canvas.** The timed grid, the
     all-day lane wells and the month cells are now the theme's SECONDARY
     surface; blocks and chips keep the primary one, so each block visibly sits
     ON the grid rather than being a grey rectangle on an identical grey sheet.
     Check both themes. Toolbar, day headers and the calendar rail are primary
     too, so the pane reads chrome / canvas / cards with only two colours and no
     new hue anywhere.
113. **Overlap is marked on the right.** Two colliding blocks each get a thin
     orange line down their RIGHT edge — the side the collision is on. With the
     canvas showing between neighbours it reads as an edge, not as a gap.
114. **Blocks respond to the pointer.** Hovering any block lightens it (only
     remote ones did before, which read as "this one is special").
115. **Touch sizing reaches everything.** On a phone, the "Create as" row in the
     drag dialog and the Type row in the properties panel are 36px like every
     other control. They were stuck at the 26px desktop size, because the size
     tokens were only raised on the timeline root — the two newest things to tap
     were the two you could not.
116. **The type picker wraps on a narrow screen** instead of running off the edge.
117. **Today is unchanged, deliberately.** The accent bar under the column stays.
     A filled pill on the header was tried this round and reverted within the
     hour: `.tn-day-header` is `flex: 1 1 auto`, so in Day view the fill becomes
     an ~800px accent slab — the exact regression the hygiene suite has guarded
     since v2.7. Both failed extremes are now written down beside the rule.
118. **Outside-month days still recede.** They were marked by taking the
     secondary surface, which is now the canvas every cell wears; they dim
     instead. Check a month view where the first row starts mid-week.
119. **Nothing changed behaviourally.** This round is CSS only — no gesture,
     index, filename or write path was touched.

### v3.11 — a deep red, and nothing at weight 700

120. **THE RED. Your theme is the reason.** Tokyo Night's `--color-red` is
     `rgb(255, 117, 127)` — a salmon. So "just use the theme's red" produced
     exactly the washed-out colour it was meant to fix. It is now the theme's red
     mixed toward `red` (which drives green and blue DOWN — that is saturation)
     and then slightly toward `darkred`. On your theme that is **#e8383d**; on
     stock Obsidian dark **#e62225**. Check the needle and a block that is
     happening now: deep and saturated, no pink cast.
121. **Nothing is at weight 700 any more.** Nine declarations, 28% of every weight
     in the file, six of them on ~11.5px text. Day headers are 400 with today at
     600 — so the emphasis finally runs the right way round; it used to be that
     today was LESS bold than the other six days.
122. **Not-in-plan wears one mark, not five.** A dashed orange left bar and the
     always-visible ➕. The dashed orange perimeter is gone — and deleting it gave
     another state its mark back: that rule was overwriting the overlap edge on any
     block that was both unplanned and overlapping.
123. **Hover no longer moves anything.** The month day-number used to bold on
     hover, which re-laid-out the digit inside its fixed row. Blocks no longer
     take a fill on hover either (added in v3.10, removed here — on a card already
     lighter than the canvas it read as a slab under the cursor). Coming to the
     front is still what a hovered block does.
124. **Thinner state bars.** `--tn-edge` is 3px, not 4 — and a block with nothing
     to report draws its bar at the grid's own line weight, so the bars that DO
     mean something stand out more than they did at full width.
125. **The 6-month view is not a stack of accent slabs.** The current month is
     marked by an accent underline on its title, not by filling the whole
     full-width button.
126. **Two more things stopped shouting**: the midnight dash was drawn in
     `--text-normal` (roughly ten times the contrast of every other line in the
     grid) and is now a border colour; the ⚠ chip keeps its orange text but loses
     its orange ring.

### v3.12 — the properties panel only writes when you press Apply

127. **Changing the Type stages the change; Apply performs it.** Open a task note,
     pick a different type in the Type row: the file is NOT renamed yet. The form
     rebuilds for that type's own fields (a 🔁 gains its Cycle, a 📅 gains Date
     and Time), carrying across anything already typed. Press Apply and the rename
     happens once, with everything you changed. Switch tabs away without pressing
     Apply and nothing was written.
128. **The checkbox still writes immediately** — that is the deliberate exception:
     ticking a task IS the action, not a description of one.
129. **✅ is still refused while items are unchecked** — now from BOTH routes. Apply
     renames directly rather than going through `changeStatus`, so the guard moved
     into the service and both callers ask it. Stage ✅ on a note with unchecked
     items, press Apply: the warning notice appears and nothing is renamed.
130. **A dateless 📅 cannot be made from the panel any more.** Changing ◻️ → 📅 used
     to rename instantly and keep the old name, producing a 📅 note with nothing
     scheduled (`📅 Practise - 0s - of multitasking…` in the vault is one). Now the
     Date field appears first and Apply refuses without it.
     KNOWN GAP: the right-click "Mark as scheduled 📅" menu still calls
     `changeStatus` directly and can still produce one.

### v3.13 — a still preview, a one-entry registry, your own local colour

131. **THE PREVIEW HOLDS STILL.** Open a task note, change the Type, edit Amount:
     the heading at the top does NOT change — neither the emoji nor the name. It
     used to repaint the emoji the instant you touched the Type row while text
     edits changed nothing, which read as "it already renamed my file". Press
     Apply and the heading catches up in one step.
132. **Adding a future type is one registry entry.** `EMOJI_REGISTRY` in
     src/constants.ts now carries each type's `defaultFormat` and its validation
     rules, and the settings-key TYPES, the DEFAULT_SETTINGS entries, the settings
     rows and the format validator are all derived from it. To check: add a
     throwaway 8th entry, run `npx tsc` and open settings — its format row and
     menu entries appear with no other edit. Then delete it.
     Verified: every existing default value is byte-identical to the hand-written
     ones it replaced, and `migrateSettings` merges over DEFAULT_SETTINGS, so an
     old data.json gains new keys and loses nothing.
133. **Local event colour.** Settings → Timeline → *Local event colour*. Pick one:
     local blocks' left bars and the month grid's event dots take it. Press the
     reset arrow: back to the neutral default, byte-identical to before the
     setting existed. The picker uses the same swatch-and-reset as a remote
     calendar's colour. Reminder notices stay neutral — they are mounted outside
     the timeline and never see it, which is correct.
134. **Right-click "Mark as scheduled 📅" no longer mints a dateless note.** Try it
     on a ◻️ note whose name has no date: refused with the warning notice, telling
     you to use the properties panel. This closes the gap left open in v3.12; the
     rule reads the TYPE'S FORMAT, so any future dated type is covered.
135. **The properties panel is calmer.** The card around the fields lost its
     border (it was a frame around a stack of framed inputs) and Apply is
     full-width at the bottom. Check it in a narrow sidebar.

### v3.14 — adopting a type adopts its template

136. **THE FIX: change a type on an EMPTY note → its template appears.** Create a
     ◻️ note, leave it empty, open the properties panel, switch to 📅, give it a
     date, Apply. The note now contains the scheduled template. This never worked
     for an in-place type change — only converting a PLAIN note did — which is why
     it looked like a regression.
137. **A note you have written in is never touched.** Same switch on a note that
     already has content: renamed only, nothing inserted above or below your text.
138. **Switching back and forth stays clean.** ◻️ → 📅 → ◻️ → 📅 on an empty note
     leaves exactly ONE copy of the template. (The v3.8 double-template bug came
     from appending; this path only ever fills an empty note, which is what makes
     it safe.)
139. **Editing a property is not adopting a type.** Change only Amount and press
     Apply on an empty note: nothing is inserted. The template follows a TYPE
     CHANGE, not any Apply.
140. **The right-click "Mark as …" menu does the same thing** — one rule, four
     routes (panel Apply, the menu, "Use custom emoji", the panel checkbox).
141. **✅ and ❌ deliberately do NOT template.** Marking a note done must not fill
     it: this vault's completed template is three UNCHECKED boxes, and writing it
     into a note you just completed would trip `reopenCompletedOnUnchecked` and
     rename it straight back to ◻️. Verify a ✅ switch writes nothing.
142. **One toggle still governs all of it** — Settings → *Apply template on
     convert*, whose description now names every route it covers. Turn it off and
     no adoption templates anything.

### v3.15 — notifications say the message first

143. **The message leads, the note supports it.** Every notice the plugin sends is
     now the sentence at the larger type step, with the note it concerns quietly
     underneath. It was the other way round — the filename was the headline and
     the reason a grey subtitle — so a refusal to write read as "here is a
     filename" and you had to hunt for why.
     Check all three: a reminder ("Starts at 10:00" over the event), the
     checklist refusal, and a failing calendar.
144. **Desktop OS notifications match.** A system reminder now shows the message
     as its title and the note as its body, so a reminder reads identically
     whether your system drew it or Obsidian did. Run *Send a test notification*:
     the headline is "If you can see this, reminders are working."
145. **Mobile is covered by the same change.** Obsidian on mobile has no OS
     notification API at all — the plugin detects this and always uses the in-app
     notice there — so the in-app restyling IS the mobile improvement. Check a
     reminder on the phone: the message should be readable at a glance, and long
     note names wrap rather than truncating (a notice cannot be hovered).
146. **The spoken text still matches what you see.** A screen reader announces
     "Now: 09:00 — Standup", the same order as the two lines. Pinned by a test,
     because the element and the announced string are built separately and could
     silently disagree.

### v4.0 — the pre-production audit

Three parallel audits (data safety, UX/visual, code health + publishing) found
~90 issues before this was copied into a real vault. The four that mattered:

147. **THE DATA-LOSS ONE. The daily-note template merge could delete blocks.**
     The merge REPLACES the whole note, and it discarded the "did the insert
     actually happen?" flag — so when a preserved block's first line already
     existed in your template (`- [ ] 07:00 - 08:00` is the ordinary case), that
     block **and everything nested under it** vanished. It now refuses the entire
     merge and tells you which lines were in the way. Verify: put a line in your
     daily template that matches a planned block's first line, then open that day
     — the note must be UNCHANGED and a warning must name the clash.
148. **Old daily notes are no longer rewritten at all.** Opening a note from 2021
     used to merge your current template into it (restamping `{{time}}` and
     `{{timestamp}}` with today's clock). The merge now runs only for today and
     future days. Verify: open any past daily note — nothing happens.
149. **A merge that DOES run now says so**, naming the note. It used to be silent.
150. **Renaming several notes at once asks first.** Editing one line in a daily
     note reconciles every line in it; where that would rename 2+ files it now
     lists them and waits. A single rename stays automatic and silent.
151. **The fourth automatic write has a switch.** `updateLineFromFilename` (rename
     a 📅 note in the explorer → its planner line follows) was ungated, while the
     settings pane stated every automatic behaviour was switchable. It now obeys
     *Rename 📅 notes to match their planner line*.
152. **Converting no longer leaves a template behind on failure.** `convert` wrote
     the template BEFORE renaming, so a name collision left the template appended
     to your note while telling you it failed.
153. **The ✅ guard fails closed.** An unreadable note used to be treated as "all
     done" and could be marked ✅.
154. **The reopen notice tells the truth.** "Reopening task to ◻️" fired even when
     the rename was refused, and never named the file.

Visual and accessibility:

155. **"Add block" is the primary button.** It was missing `mod-cta`, so the main
     creation dialog's confirm button rendered greyer than Cancel.
156. **Buttons are actually flat on Linux/Windows.** Obsidian's own
     `button:not(.clickable-icon)` adds an inset ring plus a drop shadow, zeroed
     only on macOS — so every "flat" control here drew both, and bordered ones
     drew a doubled edge. A large part of "things look thick".
157. **Hovering the block that is happening now raises it.** A later rule was
     overriding the hover z-index.
158. **An expanded block respects a narrow pane again.** Its cap read a variable
     that is published on a descendant, so the 100vh fallback always won.
159. **The month grid shows chips below 480px.** It measured a scrolling grid with
     `clientHeight`, so the budget came out zero and every populated day showed
     only "+N more". Touch chips are also measured at their real (taller) height.
160. **The Type row and "Create as" row are keyboard-operable** — one tab stop,
     arrow keys inside, and every emoji button has a real accessible name.
     Invalid fields now set `aria-invalid` rather than relying on a red border.
161. **The file-explorer checkboxes have a switch** (Settings → Timeline). Turning
     it off removes them immediately.
162. **Three settings stopped lying**: word-count dots are not "sized by" word
     count; the event-dots toggle does not govern the 6-month/year density mark;
     the local-colour reset no longer rebuilds the whole settings pane.

### v4.1 — the all-day drop, and the dashed perimeter

163. **Dragging an all-day item onto the grid writes the time into its NAME.**
     The planner line always got the time; the filename follows too, gaining
     `at HH.MMh`. Verify: drag an all-day chip to 09:00 → the note is renamed to
     `📅 By <date> at 09.00h, …`.
164. **…unless several days link that note, and now it SAYS so.** A note that
     lives in your daily template is linked from every day, so no one filename
     can satisfy them all and the rename is deliberately withheld. That was
     silent — the line got its time and the name did not, with no explanation.
     A warning notice now names the note and the reason, once per note per
     session. (This is what "the time didn't reach the note" actually was: the
     `📅 …practiseee…` note in the test vault is linked from five days.)
165. **Not-in-plan blocks are dashed on three sides again**, with the solid
     colour bar keeping the left edge — the dashes say "provisional" all the way
     round without fighting the bar that says what the block IS.
166. **A block that is BOTH unplanned and overlapping keeps both marks.** The
     dashed perimeter is declared long after the overlap edge at equal
     specificity, so it used to erase it; the pair is now stated explicitly and
     pinned by a test. This is the collision that made the perimeter worth
     deleting the first time round.

### v4.2 — deleting the time from a filename now means something

167. **THE BUG: removing `at 08.00h` from a note's name used to undo itself.**
     The planner line kept its time, reconcile rebuilt the name from that line,
     and the time you had just deleted reappeared within a second — so there was
     no way to say "this has no time any more" by editing the name.
     Verify: rename a linked 📅 note to drop its `at HH.MMh`. The name stays as
     you typed it, and the block moves into the all-day lane — the same end state
     as dragging it there.
168. **The reverse guard still holds.** A note that NEVER had a time in its name,
     sitting on a line you deliberately dragged into the all-day lane, is
     unaffected by any rename — renaming it (a properties Apply, a status change)
     must not be read as an instruction about its time. `renameTimeIntent` in
     `core/event-filename.ts` is the whole rule, and it is unit-tested for all
     four combinations.
169. **Why a freshly created note is already linked.** Creating a note through the
     drag dialog's "Create as ◻️/📅/🔁" makes the note AND links it into that
     day's plan — that is the point of creating it from a time slot. If you want a
     note that is not in any day plan, create it from the file menu or the command
     palette instead.
