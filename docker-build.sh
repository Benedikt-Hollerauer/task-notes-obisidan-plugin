#!/bin/bash
# Helper script to build the plugin inside Docker

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Building Obsidian plugin inside Docker container...${NC}"

# Install deps (cached in named volume after first run) then build
docker compose run --rm obsidian-plugin-dev sh -c "npm install && npm run build"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Build completed successfully!${NC}"
    
    # Copy compiled files to test vault plugin directory
    echo -e "${BLUE}Copying built files to test vault...${NC}"
    mkdir -p test-vault/.obsidian/plugins/task-notes
    cp main.js manifest.json styles.css test-vault/.obsidian/plugins/task-notes/
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Files copied successfully!${NC}"
    else
        echo -e "${RED}Failed to copy files!${NC}"
        [ -t 0 ] && read -p "Press Enter to close..."
        exit 1
    fi
else
    echo -e "${RED}Build failed!${NC}"
    [ -t 0 ] && read -p "Press Enter to close..."
    exit 1
fi

# Pause before closing (only when run interactively)
echo ""
[ -t 0 ] && read -p "Press Enter to close..."
exit 0
