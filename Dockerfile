# Dockerfile for Obsidian Plugin Development
FROM node:18-alpine

# Set working directory
WORKDIR /workspace

# Expose port for hot reload (if needed in future)
EXPOSE 3000

# Default command - keeps container running for development
CMD ["sh"]
