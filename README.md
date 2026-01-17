# Task Notes

A comprehensive Obsidian plugin that adds interactive task management with emoji-based status tracking, customizable format templates, and an intuitive modal dialog for task creation.

## Table of Contents
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [License](#license)

## Features
- **Interactive Checkboxes** - Clickable checkboxes in note titles and file explorer that sync with task emoji status
- **Task Creation Modal** - User-friendly dialog with date/time pickers and custom field inputs
- **Fixed Task Bar** - Bottom editor bar for quick task property editing with Apply button
- **Customizable Format Templates** - Define task naming using placeholders: `{action}`, `{amount}`, `{outcome}`, `{date}`, `{time}`, `{range}`
- **Four Task Types** - Support for ◻️ Unchecked, 📅 Scheduled, ✅ Completed, and ❌ Cancelled tasks
- **Context Menu Integration** - Right-click any file to convert it to a task
- **Dynamic Field Labels** - Form fields automatically adapt based on your format templates
- **Format Validation** - Prevents duplicate placeholders and validates template syntax
- **Auto File Renaming** - Tasks automatically rename when status changes or properties are updated
- **Responsive Design** - Compact, modern UI that adapts to different screen sizes

## Installation

### Method 1: Build from Source

1. Clone the repository:
```bash
git clone https://github.com/yourusername/task-notes-obsidian-plugin.git
cd task-notes-obsidian-plugin
```

2. Build the plugin:
```bash
npm install
npm run build
```

Or using Docker:
```bash
./docker-build.sh
```

3. Copy built files to your vault:
```bash
mkdir -p /path/to/your/vault/.obsidian/plugins/task-notes
cp main.js manifest.json styles.css /path/to/your/vault/.obsidian/plugins/task-notes/
```

4. Enable in Obsidian:
   - Settings → Community Plugins
   - Disable Restricted Mode if needed
   - Enable "Task Notes"

### Method 2: Manual Installation

1. Download the latest release
2. Extract to `.obsidian/plugins/task-notes/` in your vault
3. Enable the plugin in Obsidian settings

## Usage

### Creating Tasks

**Command Palette:**
1. Press `Ctrl/Cmd + P`
2. Search for "Create Task" or "Create Event"
3. Fill in the form and click "Create"

**Bottom Task Bar:**
1. Open any existing task file (filename with task emoji)
2. Edit properties in the bottom bar
3. Click "Apply"

**Context Menu:**
1. Right-click any markdown file in file explorer
2. Select "Convert to Unchecked Task", "Convert to Scheduled Task", etc.

### Managing Task Status

Click the checkbox in the note title or file explorer to cycle through states:
- ◻️ Unchecked → ✅ Completed
- 📅 Scheduled → ✅ Completed  
- ✅ Completed → ◻️ Unchecked
- ❌ Cancelled → ◻️ Unchecked

### Example Task Names

```
◻️ Buy - 3 - grocery items.md
📅 By 2026-01-17 (at 14.30h - 2026-01-18), Meeting - 2 hours - project review.md
✅ Finish - 1 - project report.md
❌ Cancel - 1 - old task.md
```

## Configuration

### Customizing Format Templates

Edit format templates in Settings → Task Notes:

- **Unchecked Task Format** - Default: `{action} - {amount} - {outcome}`
- **Scheduled Task Format** - Default: `By {date} (at {time} - {range}), {action} - {amount} - {outcome}`
- **Completed Task Format** - Default: `{action} - {amount} - {outcome}`
- **Cancelled Task Format** - Default: `{action} - {amount} - {outcome}`

### Available Placeholders

- `{action}` - What to do (e.g., Buy, Finish, Complete)
- `{amount}` - Quantity/duration (e.g., 3, 2 hours)
- `{outcome}` - Object/result (e.g., groceries, report)
- `{date}` - Start date (YYYY-MM-DD)
- `{time}` - Time (HH.MMh)
- `{range}` - End date (YYYY-MM-DD)

### Template Examples

**Simple Task:**
```
{action} {outcome}
→ ◻️ Buy groceries.md
```

**Detailed Task:**
```
{action} - {amount} - {outcome}
→ ◻️ Buy - 3 items - groceries.md
```

**Event with Date:**
```
By {date} (at {time} - {range}), {action} - {amount} - {outcome}
→ 📅 By 2026-01-20 (at 14.30h - 2026-01-21), Meeting - 1 hour - team sync.md
```

## License

This project is licensed under the MIT license.
