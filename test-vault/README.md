# Test Vault for Task Notes Plugin

This is a test vault for the Task Notes Obsidian plugin.

## How to Use

1. Copy the contents of this `test-vault` folder to your Obsidian vault
2. Enable the Task Notes plugin in Obsidian Settings > Community Plugins
3. Open any of the test files to see checkboxes appear

## Test Files

- **◻️ Buy groceries.md** - Unchecked task
- **📅 Doctor appointment.md** - Scheduled task  
- **✅ Finish project report.md** - Completed task
- **Regular Note.md** - Regular note (no checkbox)

## Features to Test

✅ Checkboxes appear in the file explorer next to filenames with task emojis
✅ Checkboxes appear in the note content next to the title
✅ Clicking a checkbox renames the file (changes the emoji)
✅ Checkbox inherits your current Obsidian theme's styling
✅ Completed tasks (✅) show checked boxes
✅ Can uncheck a completed task to revert to ◻️

## Installation

To install this plugin in your actual Obsidian vault:

1. Navigate to your vault's `.obsidian/plugins/` folder
2. Create a folder called `task-notes`
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder
4. Restart Obsidian or reload plugins
5. Enable "Task Notes" in Settings > Community Plugins
