#!/usr/bin/env python3
import json
import subprocess
import sys


def main() -> int:
    if len(sys.argv) < 2:
        return 0

    notification = json.loads(sys.argv[1])
    if notification.get("type") != "agent-turn-complete":
        return 0

    title = f"Codex: {notification.get('last-assistant-message', 'Turn Complete!')}"
    message = " ".join(notification.get("input-messages", []))
    subtitle = notification.get("thread-id", "")

    script = (
        "on run argv\n"
        "  set notificationMessage to item 1 of argv\n"
        "  set notificationTitle to item 2 of argv\n"
        "  set notificationSubtitle to item 3 of argv\n"
        "  if notificationSubtitle is \"\" then\n"
        "    display notification notificationMessage with title notificationTitle\n"
        "  else\n"
        "    display notification notificationMessage with title notificationTitle subtitle notificationSubtitle\n"
        "  end if\n"
        "end run"
    )

    subprocess.run(["osascript", "-e", script, message, title, subtitle], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
