# Task Notes Plugin - User Guide

## Overview

The Task Notes Plugin enhances your Obsidian workflow by adding interactive task management capabilities directly to your note filenames. By using task emojis in your note titles, you can visually track and manage tasks throughout your vault.

## Features

### 1. **Three Task States**

- **◻️ Unchecked** - Regular tasks that need to be completed
- **📅 Scheduled** - Tasks scheduled for future completion
- **✅ Completed** - Tasks that have been finished

### 2. **Interactive Checkboxes in Note Titles**

When you open a note with a task emoji in its filename, an interactive checkbox appears next to the note title:

- Click the checkbox to toggle between ◻️ (unchecked) and ✅ (completed)
- The file is automatically renamed with the new emoji
- All internal links are automatically updated by Obsidian

**Example:**
- File: `◻️ Finish project report.md`
- Click checkbox → File becomes: `✅ Finish project report.md`

### 3. **File Explorer Display**

The file explorer shows read-only checkboxes next to task notes:

- Visual indication of task status without opening the file
- Automatically updates when files are renamed
- Display-only (cannot be clicked in file explorer)

### 4. **Right-Click Context Menu**

Right-click any markdown file in the file explorer to access task management options:

#### For regular files (no task emoji):
- **Convert to Unchecked Task ◻️** - Add unchecked task status
- **Convert to Scheduled Task 📅** - Add scheduled status
- **Convert to Completed Task ✅** - Add completed status

#### For files with task emojis:
- **Remove Task Status** - Remove the emoji and convert back to a regular note
- **Mark as Unchecked ◻️** - Change to unchecked status
- **Mark as Scheduled 📅** - Change to scheduled status
- **Mark as Completed ✅** - Change to completed status

## Usage Examples

### Creating a New Task

**Method 1: Manual Renaming**
1. Create a new note or rename an existing one
2. Add a task emoji at the start: `◻️ My Task Name`
3. The plugin will automatically add checkboxes

**Method 2: Context Menu**
1. Right-click a markdown file in the file explorer
2. Select "Convert to Unchecked Task ◻️"
3. The file is automatically renamed with the emoji prefix

### Managing Task Status

**Method 1: Checkbox Click**
1. Open a task note
2. Click the checkbox next to the title
3. The file is automatically renamed

**Method 2: Context Menu**
1. Right-click the file in the file explorer
2. Select the desired status (e.g., "Mark as Completed ✅")
3. The file is automatically renamed

### Workflow Example

```
1. Create note: "Project Report"
2. Right-click → "Convert to Unchecked Task ◻️"
   Result: "◻️ Project Report"
   
3. When ready to work: Right-click → "Mark as Scheduled 📅"
   Result: "📅 Project Report"
   
4. When finished: Open note → Click checkbox
   Result: "✅ Project Report"
   
5. To archive: Right-click → "Remove Task Status"
   Result: "Project Report"
```

## File Naming Rules

- Task emoji must be at the **start** of the filename
- Format: `[EMOJI] [SPACE] [NAME].md`
- Examples:
  - ✅ `◻️ Buy groceries.md`
  - ✅ `📅 Team meeting notes.md`
  - ✅ `✅ Finished task.md`
  - ❌ `Buy groceries ◻️.md` (emoji not at start)
  - ❌ `◻️Buy groceries.md` (no space after emoji)

## Tips & Best Practices

### 1. **Organizing Tasks**

- Use folders to categorize tasks (e.g., `Work/`, `Personal/`)
- Combine with tags for additional organization
- Use the scheduled emoji 📅 for tasks in your calendar or planned for specific dates

### 2. **Workflow Integration**

- Create a "Tasks" folder for all task notes
- Use dataview or other plugins to query task files
- Periodically review and archive completed tasks

### 3. **Batch Operations**

- Select multiple files and use the context menu
- Each file will be processed individually
- Useful for converting multiple notes to tasks at once

### 4. **Link Preservation**

- The plugin uses Obsidian's built-in file renaming
- All links to the file are automatically updated
- Backlinks remain intact

### 5. **Emoji Display**

- The task emoji is always visible in the note title
- Switching focus between title and content preserves the emoji
- The plugin uses MutationObserver to maintain consistency

## Keyboard Shortcuts

Currently, the plugin doesn't register custom keyboard shortcuts, but you can:

1. Use Obsidian's command palette to rename files
2. Access context menu via keyboard (right-click key or Shift+F10)
3. Navigate with Tab to reach the checkbox and press Space to toggle

## Troubleshooting

### Checkbox doesn't appear

- Ensure the filename starts with a task emoji (◻️, 📅, or ✅)
- There must be a space after the emoji
- Try closing and reopening the file

### File explorer checkboxes not updating

- The plugin uses MutationObserver to detect changes
- If issues persist, try disabling and re-enabling the plugin
- Check the developer console for errors (Ctrl+Shift+I)

### Renaming fails

- Ensure the new filename doesn't conflict with existing files
- Check file permissions in your vault
- Verify the file isn't open in another application

## Technical Details

### Event Handling

The plugin registers the following Obsidian events:

- `vault.on('rename')` - Updates UI when files are renamed
- `vault.on('create')` - Adds checkboxes to newly created task files
- `vault.on('delete')` - Cleans up when task files are deleted
- `workspace.on('file-open')` - Adds checkbox to newly opened task files
- `workspace.on('active-leaf-change')` - Updates checkbox when switching panes
- `workspace.on('file-menu')` - Adds context menu items

### DOM Manipulation

- Uses MutationObserver for dynamic UI updates
- Observes `.nav-files-container` for file explorer changes
- Observes `.view-header-title-container` for title changes
- Automatically restores checkboxes if removed by Obsidian

### Performance

- Minimal overhead - only processes files with task emojis
- Efficient DOM queries using specific selectors
- Observers are properly cleaned up on plugin unload

## Compatibility

- **Minimum Obsidian Version:** 0.15.0
- **Desktop:** ✅ Fully supported
- **Mobile:** ✅ Fully supported
- **Tablet:** ✅ Fully supported

## Privacy & Data

- No external network requests
- All data stays in your vault
- No analytics or telemetry
- Files are renamed using Obsidian's built-in API

## Support & Feedback

For issues, feature requests, or questions:
- Check the GitHub repository
- Review existing issues before creating new ones
- Provide detailed information about your setup when reporting bugs

## Version History

### 1.0.0 (Current)
- ✅ Interactive checkboxes in note titles
- ✅ File explorer task status display
- ✅ Automatic task status management
- ✅ Three task states (unchecked, scheduled, completed)
- ✅ Emoji preservation in note titles
- ✅ Dynamic file explorer updates
- ✅ Multi-pane support
- ✅ Right-click context menu for task conversion
- ✅ Comprehensive event handling

## License

MIT License - See LICENSE file for details
