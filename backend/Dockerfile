# ---- Build stage ----
FROM node:20-slim AS builder

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

# Copy built files, templates, package files, and VAT template
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/templates ./templates
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/VAT3_Return_XLSM.xlsm ./VAT3_Return_XLSM.xlsm

# Install production dependencies directly in the target image
RUN npm install --production

# Install Playwright browsers (Chromium only to keep image smaller)
RUN npx playwright install chromium

# Create directories for receipts and temp files
RUN mkdir -p /data/receipts /tmp/kra-receipts

# Install xvfb for headful browser support in headless containers
RUN apt-get update && apt-get install -y xvfb

ENV NODE_ENV=production
ENV PORT=8080
ENV RECEIPTS_DIR=/data/receipts
ENV TEMP_DIR=/tmp
ENV KRA_BROWSER_PROFILE_DIR=/tmp/browser-profile
ENV PLAYWRIGHT_HEADLESS=false

# Default command
CMD ["node", "dist/server.worker.js"]
