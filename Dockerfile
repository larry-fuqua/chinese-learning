# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG BASE_PATH=/chinese
ENV BASE_PATH=${BASE_PATH}
ENV NEXT_TELEMETRY_DISABLED=1
# next/font downloads Google fonts during the build. Retry once if that fetch blips.
RUN mkdir -p public && npm run build || npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ARG BASE_PATH=/chinese
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3010
ENV HOSTNAME=0.0.0.0
ENV BASE_PATH=${BASE_PATH}
ENV DATA_DIR=/data

RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --home-dir /app --no-create-home --shell /usr/sbin/nologin nextjs \
  && mkdir -p /data \
  && chown nextjs:nodejs /data

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3010
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "const p=process.env.PORT||'3010'; const b=process.env.BASE_PATH||''; fetch('http://127.0.0.1:'+p+b+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
