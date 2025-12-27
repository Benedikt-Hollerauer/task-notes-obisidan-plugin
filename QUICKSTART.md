# Quick Start Guide

This guide shows you how to quickly get started with the Docker development environment for Obsidian plugins.

## Prerequisites

Make sure you have Docker and Docker Compose installed on your system.

## Step-by-Step Guide

### 1. Clone or Navigate to This Repository

```bash
cd task-notes-obsidian-plugin
```

### 2. Start the Development Environment

```bash
./docker-dev.sh
```

This will:
- Build the Docker image (first time only)
- Start the container in the background
- Mount your project directory into the container

### 3. Initialize Your Plugin (First Time Only)

```bash
./docker-init.sh
```

This will:
- Create a sample plugin structure
- Generate `package.json`, `tsconfig.json`, `manifest.json`
- Create a sample `main.ts` file
- Install all dependencies

### 4. Develop Your Plugin

Edit the files on your host machine using your favorite editor:
- `main.ts` - Your plugin code
- `manifest.json` - Plugin metadata
- `styles.css` - Custom styles (optional)

### 5. Build Your Plugin

```bash
./docker-build.sh
```

Or for watch mode (auto-rebuild on changes):

```bash
docker compose exec obsidian-plugin-dev npm run dev
```

### 6. Test in Obsidian

1. Copy the built files to your Obsidian vault:
   ```bash
   cp main.js manifest.json ~/.obsidian/plugins/your-plugin-name/
   ```

2. Enable the plugin in Obsidian: Settings → Community Plugins

## Common Commands

### Access Container Shell

```bash
docker compose exec obsidian-plugin-dev sh
```

### Run npm Commands

```bash
# Install a package
docker compose exec obsidian-plugin-dev npm install package-name

# Run build
docker compose exec obsidian-plugin-dev npm run build

# Run in development/watch mode
docker compose exec obsidian-plugin-dev npm run dev
```

### Stop the Container

```bash
docker compose down
```

### View Container Logs

```bash
docker compose logs -f
```

## File Structure After Initialization

```
.
├── Dockerfile              # Docker image definition
├── docker-compose.yml      # Container orchestration
├── .dockerignore          # Excluded from Docker build
├── .gitignore             # Excluded from git
├── docker-dev.sh          # Start development container
├── docker-build.sh        # Build plugin
├── docker-init.sh         # Initialize plugin structure
├── package.json           # Node.js dependencies
├── tsconfig.json          # TypeScript configuration
├── manifest.json          # Obsidian plugin manifest
├── main.ts               # Plugin source code
├── main.js               # Built plugin (generated)
└── node_modules/         # Dependencies (in Docker volume)
```

## Tips

- Your source files are on your host machine, so you can use any editor
- Node modules are stored in a Docker volume for better performance
- The container stays running in the background
- All npm commands run inside the container, keeping your host clean

## Troubleshooting

See the main README.md for troubleshooting tips.
