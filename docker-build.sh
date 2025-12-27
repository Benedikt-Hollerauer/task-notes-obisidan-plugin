#!/bin/bash
# Helper script to build the plugin inside Docker

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Building Obsidian plugin inside Docker container...${NC}"

# Check if package.json exists
if [ ! -f package.json ]; then
    echo -e "${RED}Error: package.json not found!${NC}"
    echo -e "${BLUE}Please initialize your plugin first using the init script.${NC}"
    exit 1
fi

# Run build inside container
docker compose exec obsidian-plugin-dev npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Build completed successfully!${NC}"
else
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi
