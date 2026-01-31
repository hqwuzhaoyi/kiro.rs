#!/bin/bash

cd "$(dirname "$0")"

# 查找并停止进程
PID=$(pgrep -f "kiro-rs")

if [ -z "$PID" ]; then
    echo "kiro-rs 未在运行"
    exit 0
fi

kill $PID 2>/dev/null

sleep 1

if pgrep -f "kiro-rs" > /dev/null; then
    echo "正在强制终止..."
    pkill -9 -f "kiro-rs"
fi

echo "kiro-rs 已停止"
