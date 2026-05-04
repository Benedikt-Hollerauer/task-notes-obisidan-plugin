# Task Notes

An Obsidian plugin for emoji-based task management directly through file names. Tasks are tracked by the emoji prefix in the filename, with an interactive bottom bar and file-explorer checkboxes for quick edits.

## Table of Contents
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [License](#license)

## Features

- **Interactive Checkboxes** — Clickable checkboxes in note titles and the file explorer that sync with the task emoji
- **Task Creation Modal** — Dialog with date/time pickers and custom field inputs; press **Enter** to confirm, **Esc** to cancel
- **Fixed Task Bar** — Bottom editor bar for quick property editing with an Apply button
- **Smart Capitalisation** — Action words are auto-capitalised for regular tasks (`Buy - 3 - groceries`) and lowercased for events (`By 2026-06-13, send - 1 invoice`)
- **Clean Scheduled Names** — Partial date/time inputs produce clean filenames (no stray `at` or trailing `-`)
- **Customisable Format Templates** — Define task naming with placeholders: `{action}`, `{amount}`, `{outcome}`, `{date}`, `{time}`, `{range}`
- **Four Task Types** — ◻️ Unchecked, 📅 Scheduled, ✅ Completed, ❌ Cancelled
- **Context Menu Integration** — Right-click any file to convert it to a task
- **Template Application** — Applies a Markdown template on conversion; appended below existing content if the file already has content
- **Checklist Guard** — Prevents marking a task complete while unchecked `- [ ]` items remain in the note body
- **Auto-Reopen** — Switches a completed task back to ◻️ when new unchecked items are added
- **Auto File Renaming** — Tasks rename automatically when status or properties change
- **Responsive UI** — Compact bottom bar that adapts to tablet and mobile screen sizes

## Installation

### Method 1: Community Plugins (recommended)

1. In Obsidian, go to **Settings → Community plugins → Browse**
2. Search for **Task Notes**
3. Click **Install**, then **Enable**

### Method 2: Build from Source

```bash
git clone https://github.com/bhollerauer/task-notes-obsidian-plugin.git
cd task-notes-obsidian-plugin
npm install
npm run build
```

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

**Bottom task bar:**
1. Open an existing task file (any file whose name starts with a task emoji)
2. Edit the fields in the bottom bar
3. Click **Apply**

**Checkbox right-click:**  
Right-click the checkbox in the file explorer or note footer to change the task type or use a custom emoji.

### Managing Status

Click the checkbox to toggle between ◻️ and ✅. Use the right-click context menu for all status options:

| From | To (click) | To (menu) |
|------|-----------|-----------|
| ◻️ Unchecked | ✅ Completed | 📅 Scheduled, ❌ Cancelled |
| 📅 Scheduled | ✅ Completed | ◻️ Unchecked, ❌ Cancelled |
| ✅ Completed | ◻️ Unchecked | 📅 Scheduled, ❌ Cancelled |
| ❌ Cancelled | ◻️ Unchecked | ✅ Completed, 📅 Scheduled |

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
| ❌ Cancelled | `{action} - {amount} - {outcome}` |

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

Set a Markdown template file per task type under **Settings → Task Notes → Template configuration**.

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

## License

MIT
