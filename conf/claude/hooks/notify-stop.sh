#!/bin/bash
# Hook: Stop - 当 Claude 完成任务时触发

input=$(cat)

# 提取关键字段
cwd=$(echo "$input" | jq -r '.cwd // ""')
session_id=$(echo "$input" | jq -r '.session_id // ""')

# 获取项目名称
project=""
if [ -n "$cwd" ]; then
  project=$(basename "$cwd")
fi

# 尝试从 transcript 获取最后一条 assistant 消息摘要
transcript_path=$(echo "$input" | jq -r '.transcript_path // ""')
last_message=""
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  last_message=$(tail -c 2000 "$transcript_path" 2>/dev/null | grep -o '"text":"[^"]*"' | tail -1 | sed 's/"text":"//;s/"//' | cut -c1-80)
fi

# 构建通知内容
notif_title="Claude Code 任务完成"
if [ -n "$project" ]; then
  notif_title="Claude Code 任务完成 · ${project}"
fi

notif_body="任务已完成，等待下一步指令"
if [ -n "$last_message" ]; then
  notif_body="${last_message}"
fi

# 发送 macOS 通知
osascript -e "display notification \"${notif_body}\" with title \"${notif_title}\" sound name \"Hero\""
