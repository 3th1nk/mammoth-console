#!/bin/bash
# console E2E 专用引擎实例:独立 PG 库 + 独立端口(8081),与日常 dev(8080/mammoth_dev)完全隔离。
# 库不存在时自动创建(数据可随时 DROP 重建);media/work 目录放 /tmp。
set -euo pipefail

DB=mammoth_e2e_console
PG_CONTAINER=itest-timescaledb

docker exec "$PG_CONTAINER" psql -U system -d postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 || \
  docker exec "$PG_CONTAINER" psql -U system -d postgres -c "CREATE DATABASE $DB"

cd "$(dirname "$0")/../../mammoth"

export MAMMOTH_DATABASE_URL="postgres://system:E2E_PG_PASSWORD@127.0.0.1:15432/${DB}?sslmode=disable"
export MAMMOTH_API_TOKEN="e2e-console-token"
# 独立 MASTER_KEY(32 字节原文的 base64):与 dev 库互不解密(两边凭证各自独立)
export MAMMOTH_MASTER_KEY="ZTJlLWNvbnNvbGUtbWFzdGVyLWtleS0zMi1ieXRlcyE="
export MAMMOTH_HTTP_ADDR="127.0.0.1:8081"
export MAMMOTH_MEDIA_DIR=/tmp/mammoth-e2e-media
mkdir -p "$MAMMOTH_MEDIA_DIR"

# 先编译再跑:go run 的冷编译(数十秒)会让首个测试的请求撞超时,出现
# "注册后不跳转"这类假失败;二进制启动是亚秒级。日志落盘供测试失败时诊断。
go build -o /tmp/mammoth-e2e-bin ./cmd/mammoth
exec /tmp/mammoth-e2e-bin serve --mode=all >> /tmp/mammoth-e2e-engine.log 2>&1
