# Stage 1: install deps (needs build tools for better-sqlite3 native addon)
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: build Next.js
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 3: production runtime
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy everything needed to run
COPY --from=builder /app/.next           ./.next
COPY --from=builder /app/node_modules    ./node_modules
COPY --from=builder /app/src/generated  ./src/generated
COPY --from=builder /app/package.json    ./package.json
COPY --from=builder /app/public          ./public
COPY --from=builder /app/prisma          ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/scripts         ./scripts
COPY --from=builder /app/tsconfig.json   ./tsconfig.json

EXPOSE 3000
CMD ["sh", "/app/scripts/start.sh"]
