# =============================================================================
# Chhath Radio — Frontend Production Dockerfile
#
# Multi-stage build for a lean, production-grade Next.js image.
# Stage 1 (deps):    install node_modules
# Stage 2 (builder): build the Next.js app (standalone output)
# Stage 3 (runner):  minimal runtime image
#
# NEXT_PUBLIC_* vars are baked in at build time via ARGs.
# In production, these are injected by GitHub Actions from repository secrets.
# In local production-mimic mode, they are injected by docker-compose.yml.
#
# Build (GitHub Actions injects secrets as --build-arg):
#   docker build \
#     --build-arg NEXT_PUBLIC_API_URL=https://chhath-api.onrender.com \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://chhathradio.vercel.app \
#     --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-key \
#     -t chhath-frontend ./frontend
# =============================================================================

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars must be declared as ARGs and set as ENVs before `npm run build`
# so Next.js bakes them into the static bundle at build time.
# These are injected by GitHub Actions secrets — never hardcoded here.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY

# Disable Next.js telemetry in CI/production builds
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Run as non-root user for security
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copy only what Next.js standalone output needs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]