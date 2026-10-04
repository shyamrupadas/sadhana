FROM node:24.16.0-bookworm-slim AS build

WORKDIR /workspace
RUN npm install --global pnpm@12.4.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
RUN pnpm install --filter @sadhana/api... --frozen-lockfile

COPY packages/api-contract packages/api-contract
COPY apps/api apps/api
RUN pnpm --filter @sadhana/api-contract build && pnpm --filter @sadhana/api build
RUN pnpm --filter @sadhana/api deploy --prod --legacy /production/api

FROM node:24.16.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /production/api ./

EXPOSE 8080
CMD ["node", "dist/server.js"]
