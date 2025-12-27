#!/bin/bash
# Helper script to initialize a new Obsidian plugin inside Docker

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}Initializing Obsidian plugin development environment...${NC}"

# Start container if not running
docker compose up -d

echo -e "${YELLOW}This will install the Obsidian plugin sample as a starting point.${NC}"
echo -e "${YELLOW}You can modify these files to create your own plugin.${NC}"
echo -e ""

# Install dependencies and setup
docker compose exec obsidian-plugin-dev sh -c "
    # Install TypeScript and esbuild globally for convenience
    npm install -g typescript esbuild

    # Create package.json if it doesn't exist
    if [ ! -f package.json ]; then
        cat > package.json << 'EOF'
{
  \"name\": \"obsidian-sample-plugin\",
  \"version\": \"1.0.0\",
  \"description\": \"Sample Obsidian plugin\",
  \"main\": \"main.js\",
  \"scripts\": {
    \"dev\": \"esbuild main.ts --bundle --external:obsidian --outfile=main.js --watch\",
    \"build\": \"esbuild main.ts --bundle --external:obsidian --outfile=main.js\"
  },
  \"keywords\": [],
  \"author\": \"\",
  \"license\": \"MIT\",
  \"devDependencies\": {
    \"@types/node\": \"^20.10.0\",
    \"@typescript-eslint/eslint-plugin\": \"^6.13.0\",
    \"@typescript-eslint/parser\": \"^6.13.0\",
    \"builtin-modules\": \"^3.3.0\",
    \"esbuild\": \"^0.19.8\",
    \"obsidian\": \"latest\",
    \"tslib\": \"^2.6.2\",
    \"typescript\": \"^5.3.2\"
  }
}
EOF
    fi

    # Create tsconfig.json if it doesn't exist
    if [ ! -f tsconfig.json ]; then
        cat > tsconfig.json << 'EOF'
{
  \"compilerOptions\": {
    \"baseUrl\": \".\",
    \"inlineSourceMap\": true,
    \"inlineSources\": true,
    \"module\": \"ESNext\",
    \"target\": \"ES6\",
    \"allowJs\": true,
    \"noImplicitAny\": true,
    \"moduleResolution\": \"node\",
    \"importHelpers\": true,
    \"isolatedModules\": true,
    \"strictNullChecks\": true,
    \"lib\": [
      \"DOM\",
      \"ES5\",
      \"ES6\",
      \"ES7\"
    ]
  },
  \"include\": [
    \"**/*.ts\"
  ]
}
EOF
    fi

    # Create manifest.json if it doesn't exist
    if [ ! -f manifest.json ]; then
        cat > manifest.json << 'EOF'
{
  \"id\": \"sample-plugin\",
  \"name\": \"Sample Plugin\",
  \"version\": \"1.0.0\",
  \"minAppVersion\": \"0.15.0\",
  \"description\": \"This is a sample plugin for Obsidian.\",
  \"author\": \"Your Name\",
  \"authorUrl\": \"https://your-website.com\",
  \"isDesktopOnly\": false
}
EOF
    fi

    # Create a sample main.ts if it doesn't exist
    if [ ! -f main.ts ]; then
        cat > main.ts << 'EOF'
import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		console.log('Loading Sample Plugin');

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			console.log('Ribbon icon clicked');
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {
		console.log('Unloading Sample Plugin');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
EOF
    fi

    # Install dependencies
    npm install

    echo ''
    echo '${GREEN}Plugin initialized successfully!${NC}'
    echo ''
    echo '${BLUE}Next steps:${NC}'
    echo '  1. Edit main.ts to develop your plugin'
    echo '  2. Run: docker-compose exec obsidian-plugin-dev npm run build'
    echo '  3. Or use: ./docker-build.sh'
    echo ''
"

echo -e "${GREEN}Setup complete!${NC}"
