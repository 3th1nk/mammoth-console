#!/bin/bash
# console E2E 专用引擎实例:独立 PG 库 + 独立端口(8081),与日常 dev 完全隔离。
# 库不存在时自动创建(数据可随时 DROP 重建);media/work 目录放 /tmp。
#
# 需要本地有一个可 docker exec 的 PostgreSQL 容器,凭据经环境变量注入:
#   E2E_PG_CONTAINER  容器名(默认 itest-timescaledb,按你的环境改)
#   E2E_PG_USER       容器内超级用户(默认 postgres)
#   E2E_PG_PASSWORD   其密码(必填——本脚本不内置任何真实凭据)
#   E2E_PG_HOST:PORT  宿主机映射地址(默认 127.0.0.1:15432)
set -euo pipefail

# 本地便捷:存在 e2e/env.local(gitignore,不随仓库分发)时先加载;
# CI 直接用环境变量注入,两态二选一。
ENV_LOCAL="$(dirname "$0")/env.local"
[ -f "$ENV_LOCAL" ] && set -a && . "$ENV_LOCAL" && set +a

DB=mammoth_e2e_console
PG_CONTAINER="${E2E_PG_CONTAINER:?set E2E_PG_CONTAINER (your disposable postgres container name)}"
PG_USER="${E2E_PG_USER:?set E2E_PG_USER (superuser inside that container)}"
PG_PASSWORD="${E2E_PG_PASSWORD:?set E2E_PG_PASSWORD}"
PG_HOST="${E2E_PG_HOST:-127.0.0.1}"
PG_PORT="${E2E_PG_PORT:-15432}"

docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 || \
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -c "CREATE DATABASE $DB"

cd "$(dirname "$0")/../../mammoth"

export MAMMOTH_DATABASE_URL="postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${DB}?sslmode=disable"
export MAMMOTH_API_TOKEN="e2e-console-token"
# 独立 MASTER_KEY(32 字节原文的 base64):与任何其他环境的库互不解密
export MAMMOTH_MASTER_KEY="ZTJlLWNvbnNvbGUtbWFzdGVyLWtleS0zMi1ieXRlcyE="
export MAMMOTH_HTTP_ADDR="127.0.0.1:8081"
export MAMMOTH_MEDIA_DIR=/tmp/mammoth-e2e-media
mkdir -p "$MAMMOTH_MEDIA_DIR"

# 先编译再跑:go run 的冷编译(数十秒)会让首个测试的请求撞超时,出现
# "注册后不跳转"这类假失败;二进制启动是亚秒级。日志落盘供测试失败时诊断。
go build -o /tmp/mammoth-e2e-bin ./cmd/mammoth
exec /tmp/mammoth-e2e-bin serve --mode=all >> /tmp/mammoth-e2e-engine.log 2>&1
