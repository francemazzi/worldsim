# Stage 1 – build
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ src/
COPY examples/ examples/
COPY tsconfig.json tsup.config.ts ./
RUN npm run build

# Stage 2 – run
FROM node:22-slim AS runner
WORKDIR /app
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/examples/ examples/
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
EXPOSE 4400
CMD ["node", "examples/community-demo/index.ts"]
