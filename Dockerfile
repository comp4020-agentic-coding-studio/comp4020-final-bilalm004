# syntax = docker/dockerfile:1

# Two stages: Vite builds the client, then a slim Node image runs the server
# (Node 24 runs the .ts files directly) and serves dist/client. The app listens
# on 0.0.0.0:$PORT and renders README.md at /readme/ (spec/README.md).

FROM docker.io/library/node:24-slim AS build
RUN npm install -g pnpm@11.9.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM docker.io/library/node:24-slim
RUN npm install -g pnpm@11.9.0
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY server ./server
COPY docs ./docs
COPY README.md ./
CMD ["node", "server/index.ts"]
