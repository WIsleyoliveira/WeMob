# syntax=docker/dockerfile:1
FROM node:22.19-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22.19-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22.19-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
USER app
EXPOSE 3000
# A aplicação NÃO aplica migrações ao iniciar (réplicas não disputam o banco; nenhuma mudança de schema sem
# etapa controlada). Migração é um passo explícito do deploy, com a mesma imagem e uma única execução:
#   docker compose --profile migrate run --rm migrate
#   (ou: docker run --rm -e DATABASE_URL=… <imagem> node node_modules/prisma/build/index.js migrate deploy)
# Ver docs/runbook.md → "Deploy e migrações".
CMD ["node", "server.js"]
