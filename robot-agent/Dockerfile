FROM node:22-slim
WORKDIR /app

RUN npm install -g pnpm@11

# Deps + postinstall (askar native download + the ESM/CJS patch) run here.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml patch-askar.mjs ./
RUN pnpm install --frozen-lockfile

COPY src ./src

EXPOSE 4004
# Run tsx directly (not via `pnpm <script>`) so pnpm's pre-run deps check is skipped.
CMD ["pnpm", "exec", "tsx", "src/robot-service.ts"]
