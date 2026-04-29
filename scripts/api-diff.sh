#!/usr/bin/env bash
# api-diff.sh — Compare endpoint surface between OLD Go server (3839) and NEW TS server (3840).
#
# Usage:
#   bash scripts/api-diff.sh                # diff OLD vs NEW
#   OLD=http://127.0.0.1:3839 NEW=http://127.0.0.1:3840 bash scripts/api-diff.sh
#   bash scripts/api-diff.sh --new-only     # probe NEW only (when OLD isn't running)
#
# For each endpoint, prints status code + brief diff. Mismatches are highlighted.
set -u

OLD="${OLD:-http://127.0.0.1:3839}"
NEW="${NEW:-http://127.0.0.1:3840}"
MODE="${1:-both}"

# GET endpoints worth probing without side effects.
ENDPOINTS=(
  "/api/health"
  "/api/server/models"

  "/api/copilot/status"
  "/api/copilot/config"
  "/api/copilot/autostart"
  "/api/copilot/proxy"
  "/api/copilot/source"
  "/api/copilot/usage"
  "/api/copilot/logs"
  "/api/copilot/config/sync-status"

  "/api/copilot/accounts"
  "/api/copilot/accounts/oauth/status"

  "/api/mcp/xiaohongshu/status"
  "/api/mcp/xiaohongshu/autostart"
  "/api/mcp/xiaohongshu/logs"

  "/api/claude/settings"
  "/api/claude/settings/template"
  "/api/claude/onboarding"
  "/api/claude/powerline"
  "/api/claude/mcp/list"
  "/api/claude/skills/list"
  "/api/claude/rules/list"
  "/api/claude/instructions"
  "/api/claude/instructions/sync-status"
  "/api/claude/providers"
  "/api/claude/version"
  "/api/claude/plugins"

  "/api/codex/version"
  "/api/codex/settings"
  "/api/codex/settings/template"
  "/api/codex/agents"
  "/api/codex/agents/sync-status"
  "/api/codex/mcp/list"
  "/api/codex/skills/list"
  "/api/codex/accounts"
  "/api/codex/accounts/oauth/status"

  "/api/assets/list"

  "/api/scheduler/tasks/list"

  "/api/clash/config"
  "/api/clash/upstream"

  "/api/cloudreve/config"
  "/api/cloudreve/tasks/list"

  "/api/immich/accounts"
  "/api/immich/sync/plans"
  "/api/immich/sync/progress"
)

probe() {
  local base="$1" path="$2"
  curl -s -o /tmp/api-diff-body.$$ -w "%{http_code}" --max-time 5 "$base$path" 2>/dev/null || echo "ERR"
}

red()   { printf "\033[31m%s\033[0m" "$*"; }
green() { printf "\033[32m%s\033[0m" "$*"; }
gray()  { printf "\033[90m%s\033[0m" "$*"; }

printf "%-46s  %-10s  %-10s  %s\n" "ENDPOINT" "OLD" "NEW" "STATUS"
printf -- "------------------------------------------------------------------------------\n"

for ep in "${ENDPOINTS[@]}"; do
  if [[ "$MODE" == "--new-only" ]]; then
    new_code=$(probe "$NEW" "$ep")
    line=""
    if [[ "$new_code" == "200" ]]; then
      line=$(green OK)
    else
      line=$(red "NEW=$new_code")
    fi
    printf "%-46s  %-10s  %-10s  %s\n" "$ep" "-" "$new_code" "$line"
    continue
  fi

  old_code=$(probe "$OLD" "$ep")
  new_code=$(probe "$NEW" "$ep")
  status=""
  if [[ "$old_code" == "$new_code" ]]; then
    status=$(green MATCH)
  elif [[ "$old_code" == "ERR" || "$old_code" == "000" ]]; then
    status=$(gray "old-down")
  elif [[ "$new_code" == "ERR" || "$new_code" == "000" ]]; then
    status=$(red "NEW DOWN")
  else
    status=$(red "MISMATCH")
  fi
  printf "%-46s  %-10s  %-10s  %s\n" "$ep" "$old_code" "$new_code" "$status"
done

rm -f /tmp/api-diff-body.$$
