# Task Notes

An Obsidian plugin that turns notes into **scheduled events** and plans them with
day-planner-style timeblocking — while keeping everything as **plain markdown** that
works even if the plugin is uninstalled.

A note becomes an event by giving it a `📅` filename (e.g.
`📅 By 2026-07-24 at 14.00h, prepare - 1 - deck.md`). You schedule it by linking it
in a daily note under a planner heading, exactly like the Day Planner plugin:

```markdown
## Day planner
- [ ] 14:00 - 15:00 [[📅 By 2026-07-24 at 14.00h, prepare - 1 - deck]]
- [ ] 12:30 - 13:00 Lunch
```

The **daily note is the source of truth.** Drag or resize a block in the timeline and
the plugin rewrites that line *and* renames the event file so its date/time stay
truthful. Nothing lives in a hidden database.

## Table of Contents
- [Features](#features)
- [The name formats](#the-name-formats)
- [The emoji vocabulary](#the-emoji-vocabulary)
- [How it works](#how-it-works)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Development](#development)
- [Credits](#credits)
- [License](#license)

## Features

### One system
- **Everything shares a focused day.** Click a day in the sidebar, the embedded
  calendar, a day header or a month cell and every view follows. Opening a daily note
  highlights that day but never yanks the timeline out from under you. Today wears an
  accent bar across its whole column.
- **Every day's note is one click away.** The page icon in a day header opens a menu:
  open the daily note, open it in a new tab, or apply the daily template to it. The
  same menu is on right-click anywhere in the day cell.
- **An embedded calendar** sits beside the day/3-day/week grid for navigation
  (collapsible, remembered per view). It hides itself in the month and overview
  ranges, where the body already *is* a calendar.

### Timeblocking & calendar
- **Six timeline ranges** — Day, 3-day, Week (vertical hour grid with drag / move /
  resize / create-by-drag, overlap layout, now-needle, snap-to-minutes), plus
  Month (event chips, drag-to-reschedule), 6-month and Year overviews. The toolbar
  shows Day / 3 days / Week / Month; 6 months and Year live in its `›` menu.
- **Zoom the time scale** — Ctrl/Cmd-scroll over the grid, or the `−` / `+` buttons in
  the ruler corner, from 30 up to 800px per hour. The time under the pointer stays where
  it is, half- and quarter-hour rules appear as you zoom in, and the zoom is the same
  "Hour height" setting the settings tab shows, so the two can never disagree.
- **Multi-day events keep their time** — an event running across days starts at its own
  time on the first day and runs continuously, rather than collapsing into an all-day chip.
- **Colour only where it means something** — an ordinary block is a neutral card. A
  coloured left edge appears for exactly three reasons: which calendar a subscribed
  event came from, that something is happening now (red, which wins), or that two
  days claim the same note. Everything else — not in the plan, the active 🅰️ task,
  done, overlapping — is carried by a dash, a ring, dimming, or the layout itself.
- **The event you are in is marked** — the needle crosses it and its edge turns red.
- **A resizable all-day lane** — drag the divider under it, double-click to fit its items.
  It caps against the pane, so a split pane gets a shorter lane automatically.
- **Link a note while planning** — type `[[` in the new-time-block dialog and pick a note.
  The line links it; the note's own daily template still waits until its day arrives.
- **Or create the note from the drag** — the same dialog has a **Create as** row:
  *Line* (the default — a planner line, no file), *Note* (an ordinary note named by what
  you typed), or a task type (`◻️` `📅` `🔁`), which opens the properties dialog
  prefilled with the dragged date, time and duration. Notes land in Obsidian's own
  "Default location for new notes", and an existing name is refused rather than
  overwritten.
- **A colour per remote calendar** — a real colour picker, showing the colour that calendar
  is actually drawn in, with a reset to automatic.
- **Day headers are your daily note's name** — a header reads `2026-08-11`, formatted
  with your core Daily Notes format, so it matches the file it opens. Each header carries
  a page icon that opens the day menu: **filled** when the note exists, **outlined with
  a +** when the menu would create it, so a write is never disguised as a navigation.
  Right-clicking anywhere in the day cell opens the identical menu. Clicking the header
  *text* zooms to that day; Ctrl/Cmd-click opens its note, Ctrl/Cmd+Shift in a new tab.
- **Checkboxes are Obsidian's own** — the plugin draws no checkbox of its own, so the
  boxes in the timeline look and theme exactly like the ones in your notes.
- **An all-day lane that scrolls** — it grows to fit its items, caps at a third of the
  pane and scrolls. Nothing is ever hidden behind a "+N more".
- **Month calendar sidebar** — activity dots for events (accent), unchecked tasks
  (ring) and word count (faint), click a day to open or create its daily note.
- **Overlap warning** — the toolbar counts blocks that overlap another block and marks
  them. Detection only; nothing is ever rearranged for you.
- **Plain-markdown scheduling** — events are `- [ ] HH:MM - HH:MM [[note]]` lines under
  a configurable planner heading; plain-text time blocks (`- [ ] 13:00 Lunch`) work too.
- **Every timed bullet shows** — a line with a time anywhere in the daily note
  (`- 16:00 Reviewed the deck` under `## Log`) appears on the timeline and can be
  dragged. Only lines in the planner section are ever renamed or claimed by a `📅` file,
  and a bullet without a checkbox never gains one.
- **Indentation is structure** — the lines nested under a timed row are that block's
  body, listed inside it with their own checkboxes rather than scattered across the
  all-day strip. Click a block to open it over its neighbours; tick anything from the
  timeline and exactly that line changes in the note. Dragging a block to another day
  takes its sub-items with it.
- **No layout is assumed** — a time is all a line needs. New events are written as
  their own row in time order among whatever timed lines a note already has, wherever
  they live, so a hand-built daily template needs no particular heading to work.
- **Blocks read verbatim** — a block is labelled with exactly the text that follows
  the time, character for character: `[[…]]` brackets, aliases and emoji all stay as
  you typed them. The only thing rendered is a `==highlight==`.
- **Two-way sync** — editing a block rewrites the daily-note line and renames the `📅`
  file (the line always wins); renaming a file's time updates the line.
- **Plan ahead without touching templates** — schedule an event on a future day and the
  plugin creates a *bare* daily note (heading + lines only). The daily-note template is
  merged in later, automatically when the day arrives, preserving your planner lines.
- **Unlinked events** — `📅` notes with a filename date but no daily-note line show on
  the timeline marked "not in plan"; one drag links them, or the **"Schedule today's
  events"** command lists all of today's in one dialog.
- **Remote calendars** — subscribe to ICS URLs (Google / iCloud / Outlook) with per-
  calendar colour and optional declined-event filtering; read-only, cached, auto-
  refreshed every few minutes and on reconnect. Each calendar reports its own status
  (event count, last sync, or the error) in settings, and feeds carrying their own
  time zones are expanded against them rather than guessed. A failure says what to do
  about it — a 404 on a Google `/public/` address explains that the calendar is not
  shared publicly and names the *Secret address in iCal format* to use instead.

  > **Google Calendar:** use the **Secret address in iCal format** (Settings → your
  > calendar → *Integrate calendar*). The `/public/basic.ics` form only exists for a
  > calendar shared "make available to public", which Workspace policy usually forbids —
  > it returns 404 even though the URL looks right.
- **Tick a calendar event without touching the calendar** — a subscribed event can
  be ticked off in Obsidian to get it out of the way. The mark is stored locally, in
  the plugin's own data file; the source calendar is never written to. The
  show/hide-completed button in the toolbar brings hidden ones back. If the event is
  later *moved* in the source calendar it reappears at its new time, because it is a
  different occurrence.
- **Turn a calendar event into your own note** — hover a remote block or all-day chip
  and a file-plus button appears beside its cloud glyph (always visible on touch, and
  also in the right-click menu). It opens the create dialog prefilled from the event —
  nothing is written until you confirm, the occurrence stays on the timeline, and your
  calendar is never touched.
- **Notifications** — optional system (or in-app) notifications at event start and a
  configurable lead time, for local and remote events. If the OS accepts a notification
  but never displays it — no notification daemon, Do Not Disturb — the reminder also
  appears in-app rather than vanishing. *Send a test notification* in the command palette
  reports both whether delivery works and how many reminders are currently armed.

### Task-note management (unchanged from v1)
- **Interactive checkboxes** in the task-properties sidebar and the file explorer, synced to the emoji.
- **Task creation modal** with date/time pickers and dynamic field labels.
- **Task properties sidebar** — the dates and the fields the note's format declares, grouped
  into cards, with an Apply button that renames the file. Apply stays disabled until every
  required field is filled. Open it with *Open task properties*.
- **Customisable formats** — `{action}`, `{amount}`, `{outcome}`, `{date}`, `{time}`, `{range}`.
- **Five task types** — ◻️ Unchecked, 📅 Scheduled, 🔁 Routine, ✅ Completed, ❌ Unimportant —
  and two folder types — 🚀 Project, 🎯 Goal.
- **Context-menu conversion**, **template application**, **checklist guard**,
  **auto-reopen**, and **auto file renaming**.
- **Responsive UI** for tablet and mobile.

### Your vault is yours
The plugin **never sweeps your vault**. Exactly three things happen automatically, all
narrow and all interruptible:

| What | When | Guard |
|---|---|---|
| Rename a `📅` file to match its planner line | you moved that line | skipped when a file is linked from two days; a circuit breaker stops repeated renames |
| Merge the daily template into a *bare* future note | that day arrives | only when the note contains nothing but the planner heading and its lines |
| Reopen a `✅` note that gained an unchecked box | you added the box | never acts on a file whose metadata hasn't been read yet |

Nothing else writes without you asking. Adding a field to a name format changes what
*new* names look like — existing files keep their names until you press **Apply** on
them.

## The name formats

Each emoji has a format template; the fields a name carries — and their order — come
from it. Available placeholders:

| Placeholder | Meaning |
|---|---|
| `{action}` `{amount}` `{outcome}` | the three classic fields |
| `{identity}` | who you are when doing this (goals/areas/resources) |
| `{cycle}` | the repetition or condition (routines) |
| `{name}` | the subject itself (areas/resources) |
| `{date}` `{time}` `{range}` | filled from the event's date, not typed |

```
🎯  {identity} - {action} - {amount} - {outcome}
🔁  {action} - {amount} - {outcome} - {cycle}
📅  By {date} (at {time} - {range}), {action} - {amount} - {outcome}
◻️  {action} - {amount} - {outcome}
```

Any placeholder name works — `{task} - {qty} - {result}` just relabels the three
fields. A format that uses none of the named fields parses with the original grammar,
byte for byte, which is what keeps every existing filename safe.

## The emoji vocabulary

| Emoji | Means | Applies to |
|---|---|---|
| ◻️ | unchecked task | file |
| 📅 | scheduled event | file |
| 🔁 | routine | file |
| ✅ | completed | file or folder |
| ❌ | unimportant | file or folder |
| 🚀 | project | folder |
| 🎯 | goal | folder |
| 🅰️ | *active* marker, written before the emoji | either |

All of it lives in one registry at the top of `src/constants.ts` — the single place to
edit if your system uses different symbols.

## How it works

The codebase is organised in three layers:

- `src/core/` — pure TypeScript with **no Obsidian imports** (the frozen filename
  grammar, planner-line parsing, section editing, reconcile decisions, template merge,
  overlap layout, date math). Covered by Vitest, along with the stylesheet's own
  invariants and a few component tests.
- `src/services/` — Obsidian-coupled state: the event index (joins `📅` files with
  daily-note planner sections into a reactive store), the sync engine (line ↔ filename),
  the daily-note service, the ICS service, and notifications.
- `src/ui/` — Svelte 5 views (timeline + calendar), the task-properties sidebar, and the explorer /
  modals / menus.

## Installation

### Build from source

Not in the community plugin directory yet, so this is the way in.

```bash
git clone https://github.com/Benedikt-Hollerauer/task-notes-obisidan-plugin.git
cd task-notes-obisidan-plugin
npm install
npm run build
```

Then copy the three built files into your vault and enable the plugin:

```bash
mkdir -p /path/to/your-vault/.obsidian/plugins/task-notes
cp main.js manifest.json styles.css /path/to/your-vault/.obsidian/plugins/task-notes/
```

Restart Obsidian (or reload with **Ctrl/Cmd-P → Reload app without saving**),
then enable **Task Notes** under *Settings → Community plugins*.

Or with Docker:
```bash
./docker-build.sh
```

Copy the output to your vault:
```bash
mkdir -p /path/to/vault/.obsidian/plugins/task-notes
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/task-notes/
```

Enable under **Settings → Community plugins → Task Notes**.

## Usage

### Creating Tasks

**Context menu (recommended):**
1. Right-click any Markdown file in the file explorer
2. Choose _Convert to unchecked task ◻️_, _Convert to scheduled task 📅_, etc.
3. Fill in the form and press **Enter** or click **Create**

**Task properties panel:**
1. Run *Open task properties* from the command palette (it opens in the right sidebar)
2. Open any task file — a file whose name starts with a task emoji
3. Edit its fields, or pick a different **Type**, then click **Apply**

Nothing is written until you press Apply: the heading at the top of the panel keeps
showing the file as it is on disk until then.

**Checkbox right-click:**  
Right-click the checkbox in the file explorer or the task-properties sidebar to change the task type or use a custom emoji.

### Managing Status

Click the checkbox to toggle between ◻️ and ✅. Use the right-click context menu for all status options:

| From | To (click) | To (menu) |
|------|-----------|-----------|
| ◻️ Unchecked | ✅ Completed | 📅 Scheduled, ❌ Unimportant |
| 📅 Scheduled | ✅ Completed | ◻️ Unchecked, ❌ Unimportant |
| ✅ Completed | ◻️ Unchecked | 📅 Scheduled, ❌ Unimportant |
| ❌ Unimportant | ◻️ Unchecked | ✅ Completed, 📅 Scheduled |

> **Note:** Marking a task ✅ is blocked while any `- [ ]` checklist items remain unchecked in the note body.

### Example Filenames

```
◻️ Buy - 3 - grocery items.md
📅 By 2026-01-17, meeting - 2 hours - team sync.md
📅 By 2026-01-17 at 14.30h, send - 1 invoice - to Acme.md
📅 By 2026-01-17 (at 14.30h - 2026-01-18), prepare - 1 deck - for investors.md
✅ Finish - 1 - project report.md
❌ Cancel - 1 - old task.md
```

## Configuration

### Format Templates

Edit under **Settings → Task Notes → Task name formats**.

| Task type | Default format |
|-----------|---------------|
| ◻️ Unchecked | `{action} - {amount} - {outcome}` |
| 📅 Scheduled | `By {date} (at {time} - {range}), {action} - {amount} - {outcome}` |
| ✅ Completed | `{action} - {amount} - {outcome}` |
| ❌ Unimportant | `{action} - {amount} - {outcome}` |

### Placeholders

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{action}` | What to do | `Buy`, `send`, `Finish` |
| `{amount}` | Quantity / duration | `3`, `2 hours`, `1 invoice` |
| `{outcome}` | Object / result | `groceries`, `report` |
| `{date}` | Start date (YYYY-MM-DD) — scheduled only | `2026-06-13` |
| `{time}` | Time (HH.MMh) — scheduled only, optional | `14.30h` |
| `{range}` | End date (YYYY-MM-DD) — scheduled only, optional | `2026-06-14` |

> The plugin strips orphaned `at` text and trailing dashes when `{time}` or `{range}` are left empty in the scheduled format, so filenames are always clean.

### Capitalisation

- **Regular tasks** — the first letter of `{action}` is automatically capitalised (`buy` → `Buy`).
- **Scheduled events** — the first letter of `{action}` is automatically lowercased (`Send` → `send`), since the sentence already starts with `By {date}`.

### Template Application

Your daily-note template comes from the core **Daily Notes** (or Periodic Notes) plugin.
It is merged in **only** when a note holds nothing but its planner lines — checked when
Obsidian starts, when the day rolls over while it is running, and when you open such a
note. A note with anything else in it is never touched, and a day you planned ahead stays
bare until its date arrives.

To apply it by hand: the **Apply to today** button in Settings → *Daily notes & the
planner*, the *"Apply daily note template now"* command, or right-clicking a daily note in
the file explorer or a day in the calendar. **Find them** lists past days that never got
it — days that came and went while Obsidian was closed — and confirms before writing.

> Templater tags (`<% tp.… %>`) are **not** evaluated: this merge writes into an existing
> file, which Templater does not hook. Use the `{{…}}` placeholders below instead.

Set a Markdown template file per task type under **Settings → Task Notes → Template
configuration** — ◻️ unchecked, 📅 scheduled, 🔁 routine and ✅ completed each have one.
A routine template is applied when you convert a note to 🔁, exactly like the others;
🔁 carries no schedule of its own and the plugin never creates a routine note for you.

- If the target file is **empty**, the template replaces its content.
- If the target file already has **content**, the template is **appended** below a blank line.

Template variables available inside template files:

| Variable | Value |
|----------|-------|
| `{{title}}` | Filename without task emoji |
| `{{date}}` | Current date (YYYY-MM-DD) |
| `{{time}}` | Current time (HH:MM:SS) |
| `{{datetime}}` | ISO 8601 datetime |
| `{{timestamp}}` | Unix timestamp |

## Development

```bash
npm install
npm run dev      # esbuild watch → main.js
npm run build    # svelte-check + tsc + eslint + production esbuild
npm test         # vitest — pure logic, stylesheet invariants, DOM component tests
npm run lint     # eslint, including the Obsidian plugin-review rules
```

The plugin is written in TypeScript + Svelte 5 (runes), bundled with esbuild. See
[TESTING.md](TESTING.md) for the automated + manual test workflow.

Development uses a scratch vault at `test-vault/`, which is **not** part of the
repository — create your own and point Obsidian at it.

## Credits

- Timeblocking, remote-calendar and planner-line concepts are adapted from
  [obsidian-day-planner](https://github.com/ivan-lednev/obsidian-day-planner) by
  James Lynch and Ivan Lednev (MIT). The planner-line grammar and overlap-layout
  algorithm are re-implementations inspired by that project.
- The month-calendar and daily-note integration follow the patterns of
  [obsidian-calendar-plugin](https://github.com/liamcain/obsidian-calendar-plugin) by
  Liam Cain (MIT), and use
  [obsidian-daily-notes-interface](https://github.com/liamcain/obsidian-daily-notes-interface) (MIT).
- ICS parsing uses [ical.js](https://github.com/kewisch/ical.js) (MPL-2.0).

## License

MIT

