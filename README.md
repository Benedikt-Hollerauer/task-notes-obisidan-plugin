# Task Notes Obsidian Plugin

An Obsidian plugin that adds interactive task management capabilities to your notes by providing visual checkboxes and automatic emoji-based task status tracking. The plugin uses task emojis (◻️ for unchecked, 📅 for scheduled, ✅ for completed) in note filenames to enable quick task status management directly from the file explorer and note titles.

## Features

### Core Functionality

#### 1. **Interactive Checkboxes in Note Titles**
- Automatically adds clickable checkboxes next to note titles in the editor
- The checkbox appears only when the note filename contains a task emoji (◻️, 📅, or ✅)
- The checkbox state is visually synchronized with the task emoji in the filename
- Clicking the checkbox triggers an automatic file rename to update the task status

#### 2. **File Explorer Task Status Display**
- Displays checkboxes next to note names in the file explorer sidebar
- Checkboxes are disabled/read-only in the file explorer (display-only, no interaction)
- Shows visual representation of task status without allowing direct clicking in the explorer
- Automatically updates when files are renamed, created, or deleted

#### 3. **Automatic Task Status Management via File Renaming**
- When you check/uncheck a checkbox, the plugin automatically renames the file with the appropriate emoji
- **Unchecked → Checked**: ◻️ becomes ✅
- **Checked → Unchecked**: ✅ becomes ◻️
- **Scheduled → Checked**: 📅 becomes ✅
- All other filename content remains unchanged; only the emoji is swapped

#### 4. **Three Task States via Emojis**
- **◻️ (Unchecked)**: Regular task that needs to be completed
- **📅 (Scheduled)**: Task that is scheduled for future completion
- **✅ (Checked/Completed)**: Task that has been completed

#### 5. **Right-Click Context Menu**
- Convert regular notes to tasks by right-clicking in file explorer
- Options: Convert to Unchecked ◻️, Scheduled 📅, or Completed ✅
- Change task status between different states
- Remove task status to convert back to regular note

#### 6. **Template Integration**
- Automatically apply templates when converting files to tasks
- Uses Obsidian's core Templates plugin folder configuration
- Configure different templates for each task type
- Templates only apply to empty files (prevents overwriting content)
- Supports template variables: `{{title}}`, `{{date}}`, `{{time}}`, `{{datetime}}`, `{{timestamp}}`

#### 7. **Emoji Preservation in Note Titles**
- The task emoji is always preserved and visible in the note title
- When clicking into the note title to edit it and then clicking back to the note body, the emoji and checkbox remain intact
- Uses a MutationObserver to watch for DOM changes and restore the checkbox if Obsidian re-renders the title element
- Prevents accidental emoji deletion when switching focus between title and note content

#### 8. **Dynamic File Explorer Updates**
- Uses MutationObserver to detect new files, deletions, and renames in the file explorer
- Automatically applies/removes task checkboxes based on whether the filename contains a task emoji
- Monitors the `.nav-files-container` for changes and updates the display in real-time

#### 9. **Multi-Pane Support**
- Works correctly when switching between different panes/tabs
- Registers `active-leaf-change` event to update the checkbox when switching between open notes
- Handles `file-open` events to process newly opened notes

### Event Handling

The plugin registers the following Obsidian events to keep the UI synchronized:

- **vault.on('rename')**: Updates file explorer when a file is renamed
- **vault.on('create')**: Adds checkboxes to newly created task notes
- **vault.on('delete')**: Removes checkboxes when task notes are deleted
- **workspace.on('file-open')**: Adds checkbox to the title of newly opened task notes
- **workspace.on('active-leaf-change')**: Updates the checkbox when switching between panes
- **workspace.on('file-menu')**: Adds right-click context menu options

## Usage Guide

### Basic Usage

#### Creating Tasks

**Method 1: Manual Renaming**
1. Create or rename a file with a task emoji at the start: `◻️ My Task Name.md`
2. The plugin automatically adds checkboxes in the title and file explorer

**Method 2: Right-Click Context Menu**
1. Right-click any markdown file in the file explorer
2. Select "Convert to Unchecked Task ◻️" (or Scheduled/Completed)
3. File is automatically renamed with the emoji prefix
4. Template is applied if configured

#### Managing Task Status

**In Note Title:**
- Click the checkbox to toggle between ◻️ and ✅

**Via Context Menu:**
1. Right-click the file in file explorer
2. Select desired status (Unchecked, Scheduled, or Completed)

### Plugin Settings

Access settings via: **Settings → Community Plugins → Task Notes**

#### Available Settings

1. **Apply templates on conversion** - Enable/disable automatic template application
2. **Unchecked task template (◻️)** - Template for new unchecked tasks
3. **Scheduled task template (📅)** - Template for scheduled tasks
4. **Completed task template (✅)** - Template for completed tasks

### Template Setup

#### Step 1: Configure Templates Folder

1. Go to **Settings → Core plugins → Templates**
2. Enable the Templates plugin
3. Set your "Template folder location" (e.g., `Templates`)

#### Step 2: Create Template Files

Create template files in your templates folder. Example:

**File: `Templates/task-template.md`**
```markdown
# {{title}}

Created: {{date}} {{time}}
Status: Pending

## Description


## Tasks
- [ ] 

## Notes

```

#### Step 3: Configure Plugin

1. Go to **Settings → Community Plugins → Task Notes**
2. Enable "Apply templates on conversion"
3. Enter your template file paths in the text input fields (autocomplete available):
   - **Unchecked task template** → `Templates/task-template.md`
   - **Scheduled task template** → `Templates/scheduled-template.md`
   - **Completed task template** → `Templates/completed-template.md`

#### How Template Application Works

When you right-click a file and select "Convert to Unchecked Task ◻️" (or other task types):
1. The template content is **automatically inserted** into the file
2. Template variables (`{{title}}`, `{{date}}`, etc.) are replaced with actual values
3. The file is then renamed with the appropriate emoji prefix
4. The task is now created with the template structure ready to use

### Template Variables

Use these variables in your template files:

- `{{title}}` - File name without task emoji
- `{{date}}` - Current date (YYYY-MM-DD)
- `{{time}}` - Current time (HH:MM:SS)
- `{{datetime}}` - Date and time (ISO 8601)
- `{{timestamp}}` - Unix timestamp

### Example Templates

#### Basic Task Template
```markdown
# {{title}}

**Created:** {{date}}
**Status:** 🔴 Not Started

## Tasks
- [ ] 

## Notes

```

#### Scheduled Task Template
```markdown
# {{title}}

**Scheduled:** {{date}}
**Type:** 📅 Event

## Agenda


## Preparation
- [ ] 

## Notes

```

#### Completed Task Template
```markdown
# {{title}}

**Completed:** {{date}}

## Summary


## Outcomes

```

## File Naming Rules

Task emoji must be at the **start** of the filename:
- ✅ Correct: `◻️ Buy groceries.md`
- ✅ Correct: `📅 Team meeting.md`
- ✅ Correct: `✅ Finished task.md`
- ❌ Wrong: `Buy groceries ◻️.md` (emoji not at start)
- ❌ Wrong: `◻️Buy groceries.md` (no space after emoji)

## Tips & Best Practices

### Task Organization
- Use folders to categorize tasks (e.g., `Work/`, `Personal/`)
- Combine with tags for additional organization
- Use 📅 for calendar events or scheduled tasks

### Template Best Practices
- Keep templates simple and focused
- Use consistent structure across templates
- Include metadata (creation date, status)
- Test templates before applying to important files

### Workflow Examples

**Daily Task Planning:**
1. Create file: `2026-01-04 Daily Plan.md`
2. Right-click → Convert to Unchecked Task
3. Template auto-fills with structure
4. Check off tasks throughout the day

**Project Management:**
1. Create: `Project Analysis.md`
2. Right-click → Convert to Scheduled Task
3. Add to calendar
4. When complete → Click checkbox to mark as ✅

## Troubleshooting

### Checkbox doesn't appear
- Ensure filename starts with task emoji (◻️, 📅, or ✅)
- Must have space after emoji
- Try closing and reopening the file

### Template not applying
- Check that Templates plugin is enabled
- Verify template folder is configured in Settings → Templates
- Ensure "Apply templates on conversion" is enabled
- Templates only apply to empty files
- Check that template file exists in templates folder

### File explorer checkboxes not updating
- Plugin uses MutationObserver to detect changes
- If issues persist, try disabling and re-enabling the plugin
- Check developer console for errors (Ctrl+Shift+I)

### Renaming fails
- Ensure new filename doesn't conflict with existing files
- Check file permissions
- Verify file isn't open in another application

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

No Node.js, npm, or TypeScript installation required on your host machine!

## Quick Start

### 1. Start the Development Environment

```bash
./docker-dev.sh
```

This script will:
- Build the Docker image with Node.js 18
- Start the development container
- Mount your project directory into the container

### 2. Initialize Your Plugin

```bash
./docker-init.sh
```

This script will:
- Create a sample plugin structure (main.ts, manifest.json, package.json, tsconfig.json)
- Install all necessary dependencies inside the container
- Set up the development environment

### 3. Build Your Plugin

```bash
./docker-build.sh
```

Or manually inside the container:

```bash
docker compose exec obsidian-plugin-dev npm run build
```

## Manual Usage

### Access the Development Container

```bash
docker compose exec obsidian-plugin-dev sh
```

Once inside the container, you can run any npm commands:

```bash
npm run build      # Build the plugin
npm run dev        # Build with watch mode
npm install <pkg>  # Install additional packages
```

### Start Development Container

```bash
docker compose up -d
```

### Stop Development Container

```bash
docker compose down
```

### Rebuild Container (after changing Dockerfile)

```bash
docker compose build
docker compose up -d
```

## Development Workflow

1. **Start the container**: `./docker-dev.sh`
2. **Initialize the plugin** (first time only): `./docker-init.sh`
3. **Make changes** to `main.ts` or other files on your host machine using your favorite editor
4. **Build the plugin**: `./docker-build.sh` or use watch mode inside container with `npm run dev`
5. **Copy built files** (`main.js`, `manifest.json`, `styles.css` if exists) to your Obsidian vault's `.obsidian/plugins/your-plugin-name/` directory
6. **Reload Obsidian** to see your changes

## Project Structure

After initialization, your project will have:

```
.
├── Dockerfile              # Docker image definition
├── docker-compose.yml      # Container orchestration
├── .dockerignore          # Files to exclude from Docker build
├── .gitignore             # Files to exclude from git
├── docker-dev.sh          # Start development container
├── docker-build.sh        # Build plugin inside container
├── docker-init.sh         # Initialize plugin structure
├── package.json           # Node.js dependencies
├── tsconfig.json          # TypeScript configuration
├── manifest.json          # Obsidian plugin manifest
├── main.ts               # Plugin source code
└── main.js               # Built plugin (generated)
```

## Testing Your Plugin in Obsidian

1. Build the plugin using `./docker-build.sh`
2. Copy the following files to your Obsidian vault:
   - `main.js`
   - `manifest.json`
   - `styles.css` (if you create one)
   
   Destination: `.obsidian/plugins/<your-plugin-id>/`

3. Enable the plugin in Obsidian Settings → Community Plugins

## Customizing Your Plugin

Edit the following files to customize your plugin:

- **main.ts**: Your plugin's source code
- **manifest.json**: Plugin metadata (name, version, description, etc.)
- **package.json**: Dependencies and build scripts
- **styles.css**: (Optional) Custom styles for your plugin

## Troubleshooting

### Permission Issues

If you encounter permission issues with node_modules:

```bash
docker compose down
docker volume rm task-notes-obsidian-plugin_node_modules
docker compose up -d
```

### Container Won't Start

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Check Container Logs

```bash
docker compose logs -f
```

## Resources

- [Obsidian Plugin Developer Docs](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Obsidian API](https://github.com/obsidianmd/obsidian-api)
- [Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)

## License

MIT