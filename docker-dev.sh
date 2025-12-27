#!/bin/bash
# Helper script to run commands inside the Docker container

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting Docker container for Obsidian plugin development...${NC}"

# Start the container
docker compose up -d

echo -e "${GREEN}Container started successfully!${NC}"
echo -e "${BLUE}To access the development environment, run:${NC}"
echo -e "  docker compose exec obsidian-plugin-dev sh"
echo -e ""
echo -e "${BLUE}To stop the container, run:${NC}"
echo -e "  docker compose down"
