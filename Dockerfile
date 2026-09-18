FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl && corepack enable

# pnpm is the standard for POS-API (packageManager pin in package.json).
# package-lock.json is ignored (see .dockerignore) — pnpm-lock.yaml is source of truth.
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY config ./config/
RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate

COPY . .

RUN pnpm run build

EXPOSE 3000

CMD ["node", "dist/app/server.js"]