#!/bin/bash
# Hook: Notification - 当 Claude 需要权限或用户交互时触发

input=$(cat)

# 提取关键字段
hook_event=$(echo "$input" | jq -r '.hook_event_name // "Notification"')
message=$(echo "$input" | jq -r '.message // ""')
title=$(echo "$input" | jq -r '.title // ""')
cwd=$(echo "$input" | jq -r '.cwd // ""')

# 构建通知标题和内容
notif_title="Claude Code 需要你的注意"
notif_body=""

if [ -n "$message" ]; then
  notif_body="$message"
elif [ -n "$title" ]; then
  notif_body="$title"
else
  notif_body="Claude 正在等待你的响应"
fi

# 添加工作目录信息（取最后一段路径）
if [ -n "$cwd" ]; then
  project=$(basename "$cwd")
  notif_body="${notif_body} [${project}]"
fi

# 发送 macOS 通知
osascript -e "display notification \"${notif_body}\" with title \"${notif_title}\" sound name \"Glass\""
