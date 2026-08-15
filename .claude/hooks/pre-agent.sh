#!/bin/sh
# PreToolUse(Agent) — fires before any Agent tool call, can block (exit 2)
INPUT=$(cat)
TMPFILE=$(mktemp /tmp/agora_hook_XXXXXX)
printf '%s' "$INPUT" > "$TMPFILE"

python3 - "$TMPFILE" << 'PYEOF'
import sys, json, os, time
from pathlib import Path

with open(sys.argv[1] if len(sys.argv) > 1 else "/dev/null") as f:
    try:
        hook = json.load(f)
    except Exception:
        sys.exit(0)

tool_input = hook.get('tool_input') or {}
subagent_type = tool_input.get('subagent_type', '')
model = tool_input.get('model', '')

# Explore bypasses agora-code hooks entirely (hooks don't fire inside
# subagents) — block unconditionally, unrelated to model/burst tracking.
if subagent_type == 'Explore':
    sys.stderr.write(
        'agora-code: BLOCKED — Explore subagent bypasses hooks (pre-read, on-read, etc.).\n'
        'Use Read/Grep/Glob directly in the main session.\n'
        'Rule: run `agora-code summarize <file>` before reading any file >50 lines.\n'
    )
    sys.exit(2)

# A project-level custom agent definition can pin its own model in
# frontmatter — that's an explicit choice made once at the type level, same
# as passing `model` per call. Only built-in generic types (general-purpose,
# Explore, Plan, ...) have no locally-inspectable default.
try:
    from agora_code.session import _find_project_root
    root = _find_project_root() or Path.cwd()
except Exception:
    root = Path.cwd()

agent_def = root / '.claude' / 'agents' / f'{subagent_type}.md'
has_pinned_model = False
if agent_def.exists():
    try:
        text = agent_def.read_text(encoding='utf-8', errors='ignore')
        for line in text.splitlines()[:20]:
            if line.strip().startswith('model:') and line.split(':', 1)[1].strip():
                has_pinned_model = True
                break
    except Exception:
        pass

# Deliberate, single-call model inheritance is the documented default and
# almost always correct — do NOT block on that alone (this used to be a
# harder rule; it fought the Agent tool's own guidance to omit `model` by
# default). What actually burns budget is an uncontrolled BURST of spawns
# that all silently inherit an expensive parent model. Only that pattern is
# worth interrupting for.
if model or has_pinned_model:
    # An explicit/pinned call resets the burst counter — it signals the
    # caller is already thinking about model cost.
    state_path = root / '.agora-code' / 'agent_burst.json'
    try:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text('[]', encoding='utf-8')
    except Exception:
        pass
    sys.exit(0)

WINDOW_SECONDS = 120
THRESHOLD = 4

state_path = root / '.agora-code' / 'agent_burst.json'
now = time.time()
try:
    timestamps = json.loads(state_path.read_text(encoding='utf-8'))
    if not isinstance(timestamps, list):
        timestamps = []
except Exception:
    timestamps = []

timestamps = [t for t in timestamps if isinstance(t, (int, float)) and now - t < WINDOW_SECONDS]
timestamps.append(now)

if len(timestamps) >= THRESHOLD:
    try:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text('[]', encoding='utf-8')  # reset so the retry isn't immediately re-blocked
    except Exception:
        pass
    sys.stderr.write(
        f'agora-code: BLOCKED — {len(timestamps)} subagents spawned in the last '
        f'{WINDOW_SECONDS}s with no explicit model and no pinned agent-definition model. '
        f'Each one inherits the parent model, which compounds fast on a burst.\n'
        f'If this fan-out is intentional, pass an explicit model= (e.g. "haiku" for pure '
        f'exploration/reading, "sonnet" for most work) — or confirm the parent tier is '
        f'actually needed for every one of these before re-issuing the call.\n'
    )
    sys.exit(2)

try:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(timestamps), encoding='utf-8')
except Exception:
    pass

sys.exit(0)
PYEOF
RC=$?
rm -f "$TMPFILE"
exit $RC
