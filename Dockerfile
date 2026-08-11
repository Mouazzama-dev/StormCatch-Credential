FROM node:22-slim
WORKDIR /app

# pnpm matches your local 11.x
RUN npm install -g pnpm@11

# Install deps first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# App source (env comes from docker-compose, not baked into the image)
COPY src ./src

# Default command; each service overrides this in docker-compose.yml
CMD ["pnpm", "exec", "tsx", "src/services/facility/server.ts"]