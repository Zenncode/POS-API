FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY --from=build /app/config ./config
COPY --from=build /app/.env.example ./.env.example

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000
CMD ["node", "dist/app/server.js"]
