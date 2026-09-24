# mammoth-console 交付镜像：多阶段构建（前端构建 → Caddy 托管 + 反代）
#
# 注意：src/api/types.gen.ts 已提交入库，本构建不依赖引擎仓库；
# 引擎契约升级后先在仓库根执行 `npm run gen:api` 重新生成并提交，再构建镜像。
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
