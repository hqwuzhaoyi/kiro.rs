#!/bin/bash

cd "$(dirname "$0")"

# 检查是否已经运行
if pgrep -f "kiro-rs" > /dev/null; then
    echo "kiro-rs 已在运行中"
    exit 1
fi

# 启动服务
./target/release/kiro-rs >> kiro.log 2>&1 &
PID=$!

sleep 1

if ps -p $PID > /dev/null; then
    echo "kiro-rs 启动成功 (PID: $PID)"
    echo "日志文件: kiro.log"
    echo "API 地址: http://0.0.0.0:8990"
else
    echo "kiro-rs 启动失败，请检查日志"
    tail -10 kiro.log
    exit 1
fi
