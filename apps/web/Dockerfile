FROM node:20-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
RUN npm ci

FROM deps AS build
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY apps/web apps/web
COPY packages/types packages/types
RUN npm run build -w @event-manager/web

FROM deps AS runtime
ENV NODE_ENV=production
ENV NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=http://localhost:4000
WORKDIR /app
COPY --from=build /app/apps/web apps/web
COPY --from=build /app/packages/types packages/types
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@event-manager/web"]
