# ── Frontend Dockerfile ─────────────────────────────────────────────────────
# Multi-stage build for a lean Next.js production image.
# Stage 1 (deps):   install node_modules
# Stage 2 (builder): build the Next.js app
# Stage 3 (runner):  minimal runtime image
# ────────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_API_URL is baked in at build time.
# Override via docker-compose environment if needed.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Only copy what Next.js standalone output needs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]