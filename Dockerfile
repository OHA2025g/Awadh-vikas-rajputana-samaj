# Production image for EasyPanel (and any Docker host).
# Attach a Postgres service via DATABASE_URL. Mount a volume at /app/data for uploads
# and the WhatsApp session (not the database).

FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app

# Chromium renders the सहयोग रसीद PDF sent on WhatsApp; Noto supplies Devanagari glyphs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates chromium fonts-noto-core \
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
ENV CHROME_PATH=/usr/bin/chromium
EXPOSE 3000

# Run as root so an EasyPanel volume mounted on /app/data is writable.
CMD ["node", "server.js"]
