# Production image for EasyPanel (and any Docker host).
# Mount a volume at /app/data so the SQLite database, uploads and WhatsApp session survive rebuilds.

FROM node:20-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app

# better-sqlite3's compiled addon needs libstdc++
RUN apt-get update \
  && apt-get install -y --no-install-recommends libstdc++6 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js ./
COPY src ./src
COPY views ./views
COPY public ./public

RUN mkdir -p /app/data/uploads /app/data/private /app/data/wa-auth

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000

# Run as root so an EasyPanel volume mounted on /app/data is writable.
# Replicas must stay at 1 — SQLite is a single-writer database.
CMD ["node", "server.js"]
