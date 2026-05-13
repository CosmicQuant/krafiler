# ---- Build stage ----
FROM node:20-slim AS builder

WORKDIR /app

# Copy backend package files
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ---- Production stage ----
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Copy built files and dependencies from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Install Playwright browsers (Chromium only to keep image smaller)
RUN npx playwright install chromium

# Create directories for SQLite, receipts, and temp files
RUN mkdir -p /data/db /data/receipts /tmp/kra-receipts

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/data/db/krafiler.sqlite
ENV RECEIPTS_DIR=/data/receipts
ENV TEMP_DIR=/tmp
ENV KRA_BROWSER_PROFILE_DIR=/tmp/browser-profile
ENV PLAYWRIGHT_HEADLESS=true

# Default command — override per service
CMD ["node", "dist/server.js"]
