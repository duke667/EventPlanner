FROM node:20-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/types/package.json packages/types/package.json
RUN npm ci

FROM deps AS build
COPY apps/api apps/api
COPY packages/types packages/types
RUN npm run prisma:generate -w @event-manager/api
RUN npm run build -w @event-manager/api

FROM deps AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/tsconfig.json apps/api/tsconfig.json
COPY --from=build /app/packages/types packages/types
EXPOSE 4000
CMD ["sh", "-c", "npx prisma generate --schema apps/api/prisma/schema.prisma && npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && node apps/api/dist/main"]
