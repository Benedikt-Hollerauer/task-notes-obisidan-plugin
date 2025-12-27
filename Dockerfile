# Dockerfile for Obsidian Plugin Development
FROM node:18-alpine

# Set working directory
WORKDIR /workspace

# Copy package files if they exist (for future use)
# These files will be created when initializing a new plugin
COPY package*.json ./

# Install dependencies if package.json exists
RUN if [ -f package.json ]; then npm install; fi

# Expose port for hot reload (if needed in future)
EXPOSE 3000

# Default command - keeps container running for development
CMD ["sh"]
