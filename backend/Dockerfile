# ---- Build stage ----
FROM node:20-slim AS builder

# Install build tools for native modules (better-sqlite3 compiles in devDependencies)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend package files
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# ---- Production stage ----
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Copy built files, templates, and package files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/templates ./templates
COPY --from=builder /app/package*.json ./

# Install production dependencies directly in the target image
RUN npm install --production

# Install Playwright browsers (Chromium only to keep image smaller)
RUN npx playwright install chromium

# Create directories for receipts and temp files
RUN mkdir -p /data/receipts /tmp/kra-receipts

ENV NODE_ENV=production
ENV PORT=8080
ENV RECEIPTS_DIR=/data/receipts
ENV TEMP_DIR=/tmp
ENV KRA_BROWSER_PROFILE_DIR=/tmp/browser-profile
ENV PLAYWRIGHT_HEADLESS=true

# Default command
CMD ["node", "dist/server.js"]
