#########################
# 1) Dependencies layer #
#########################
FROM node:20-alpine AS deps
WORKDIR /app

# Install only what package-lock.json describes (reproducible)
COPY package*.json ./
RUN npm ci

########################
# 2) Builder (Next.js) #
########################
FROM node:20-alpine AS builder
WORKDIR /app

# Optional cache-buster / metadata (wired from compose if you like)
ARG BUILD_ID
ENV BUILD_ID=${BUILD_ID}

# Make builds deterministic, skip any telemetry
ENV NEXT_TELEMETRY_DISABLED=1 \
    BUILDING=1 \
    CI=1

# Bring node_modules from deps and copy full source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ---- Sanity checks: fail early if critical files missing ----
# (adjust these to any routes/pages you require at build time)
RUN set -eux; \
  echo "Repo root:"; ls -la; \
  test -d app -o -d pages || (echo "Missing app/ or pages/ directory" && exit 1); \
  if [ -f public/fonts/NotoSans-Regular.ttf ]; then echo "Have NotoSans-Regular.ttf"; else echo "No NotoSans-Regular.ttf (using system DejaVu)"; fi

# Build Next.js (produces .next)
RUN npm run build

########################
# 3) Runtime (minimal) #
########################
FROM node:20-alpine AS runner
WORKDIR /app

# tz + system DejaVu fonts (has ₹ glyphs)
RUN apk add --no-cache tzdata ttf-dejavu && \
    ln -snf /usr/share/zoneinfo/Asia/Kolkata /etc/localtime && echo "Asia/Kolkata" > /etc/timezone && \
    addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs && \
    chown nextjs:nodejs /app

# Runtime env
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    TZ=Asia/Kolkata \
    NEXT_TELEMETRY_DISABLED=1

# Copy minimal runtime files
COPY --chown=nextjs:nodejs package*.json ./
# Install only production deps
USER nextjs
RUN npm ci --omit=dev && npm cache clean --force

# Bring compiled output and public assets from builder
COPY --chown=nextjs:nodejs --from=builder /app/.next ./.next
COPY --chown=nextjs:nodejs --from=builder /app/public ./public

# (Optional) If your server code reads files from /app at runtime, uncomment:
# COPY --from=builder /app/app ./app
# COPY --from=builder /app/next.config.* ./   # only if you need it at runtime

EXPOSE 3000

# Healthcheck so compose shows "healthy" when serving
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ > /dev/null || exit 1

# Start Next.js
CMD ["node", "./node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
