# syntax=docker/dockerfile:1
FROM node:22.19-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Migração (etapa explícita do deploy, nunca no start da aplicação): CLI completo do Prisma com as dependências
# instaladas. A imagem final não serve para isso — só contém o servidor web (sem @prisma/engines/@prisma/config).
#   docker build --target migrate -t <app>-migrate:<versão> .
#   docker run --rm -e DATABASE_URL=… <app>-migrate:<versão>        (migrate deploy)
#   docker run --rm -e DATABASE_URL=… <app>-migrate:<versão> node node_modules/prisma/build/index.js migrate status
FROM deps AS migrate
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

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
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
USER app
EXPOSE 3000
# A aplicação NÃO aplica migrações ao iniciar (réplicas não disputam o banco; nenhuma mudança de schema sem
# etapa controlada). Migração é um passo explícito do deploy, com o alvo "migrate" do MESMO commit e uma única execução:
#   docker compose --profile migrate run --rm migrate
#   (ou: docker build --target migrate … e um job único — ver o estágio "migrate" acima)
# Ver docs/runbook.md → "Deploy e migrações".
CMD ["node", "server.js"]
