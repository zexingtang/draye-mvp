# 前端构建
FROM node:20-slim AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 后端构建
FROM node:20-slim AS server-build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# 运行时——用 Microsoft 官方 Playwright 镜像，浏览器/系统依赖都已经装好，
# npm 包版本必须跟镜像 tag 对上（见 package.json 里 playwright 的解析版本）。
FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=server-build /app/dist ./dist
COPY --from=web-build /app/web/dist ./web/dist
EXPOSE 8080
CMD ["node", "dist/server.js"]
