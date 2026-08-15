#!/bin/sh
STAMP="/tmp/agora_last_hook_$(basename "$0")"
NOW=$(date +%s)
LAST=$(cat "$STAMP" 2>/dev/null || echo 0)
if [ $((NOW - LAST)) -lt 2 ]; then exit 0; fi
echo "$NOW" > "$STAMP"
INPUT=$(cat)
TMPFILE=$(mktemp /tmp/agora_hook_XXXXXX)
printf '%s' "$INPUT" > "$TMPFILE"

python3 - "$TMPFILE" << 'PYEOF'
import sys, json, re

with open(sys.argv[1] if len(sys.argv) > 1 else "/dev/null") as f:
    try:
        hook = json.load(f)
    except Exception:
        sys.exit(0)

command = (hook.get('tool_input') or {}).get('command', '')
if not command:
    sys.exit(0)

VERBOSE_PATTERNS = [
    r'\bpytest\b', r'\bpython -m pytest\b',
    r'\bnpm (run )?(test|build)\b', r'\byarn (test|build)\b', r'\bpnpm (test|build)\b',
    r'\bgo test\b', r'\bcargo (test|build)\b',
    r'\bdocker (logs|build)\b', r'\bdocker-compose (logs|build)\b',
    r'\bmvn (test|install|package)\b', r'\bgradle (test|build)\b',
    r'\bmake\b.*\btest\b',
]

if not any(re.search(p, command) for p in VERBOSE_PATTERNS):
    sys.exit(0)

if 'agora-code sandbox-run' in command:
    sys.exit(0)

escaped = command.replace('"', '\\"')
print('[Bash blocked: this command tends to produce verbose output that would flood context. Re-run it as:]')
print('  agora-code sandbox-run "' + escaped + '"')
print('[This keeps the full output on disk and returns a compressed summary. If you specifically need the raw output, add --json-output and inspect the log_path.]')
sys.exit(2)
PYEOF
RC=$?
rm -f "$TMPFILE"
exit $RC
