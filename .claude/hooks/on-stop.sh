#!/bin/sh
INPUT=$(cat)

# Always checkpoint first
agora-code checkpoint --quiet 2>/dev/null || true

# Use last_assistant_message from hook input directly — no JSONL parsing needed
LAST_MSG=$(printf '%s' "$INPUT" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('last_assistant_message', ''))
except Exception:
    print('')
" 2>/dev/null)

PROMPT=$(printf '%s' "$INPUT" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('prompt', ''))
except Exception:
    print('')
" 2>/dev/null)

TRANSCRIPT_PATH=$(printf '%s' "$INPUT" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('transcript_path', ''))
except Exception:
    print('')
" 2>/dev/null)

if [ -z "$LAST_MSG" ]; then exit 0; fi

python3 - "$LAST_MSG" "$PROMPT" "$TRANSCRIPT_PATH" << 'EOF'
import sys, subprocess, os, re

last_msg = sys.argv[1].strip()
prompt = sys.argv[2].strip() if len(sys.argv) > 2 else ''
transcript_path = sys.argv[3].strip() if len(sys.argv) > 3 else ''

FILLER = re.compile(
    r'^(hi|hey|hello|ok|okay|yes|no|sure|thanks|bye|lol|cool|great|nice|yep|nope|got it)\b',
    re.I
)

def is_substantive(text):
    t = text.strip()
    if len(t) < 30:
        return False
    if FILLER.match(t):
        return False
    if t.startswith("agora-code "):
        return False
    return True

if not is_substantive(last_msg):
    sys.exit(0)

agora_bin = "agora-code"

# Context-threshold-aware handoff depth: a checkpoint written when the
# session is nearly out of room is worth more than one written mid-task,
# since it's what a fresh session (post-/clear or post-compact) will
# actually re-orient from. Below the threshold, keep the existing thin
# one-liner; above it, capture more of the transcript and tag it distinctly.
usage_pct = 0.0
if transcript_path:
    try:
        from agora_code.session import estimate_transcript_usage
        usage_pct = estimate_transcript_usage(transcript_path).get('usage_pct', 0.0)
    except Exception:
        usage_pct = 0.0

threshold = float(os.environ.get('AGORA_HANDOFF_THRESHOLD', '0.6'))
high_usage = usage_pct >= threshold

if high_usage:
    excerpt = ' '.join(last_msg.split('\n'))[:1200].strip()
else:
    excerpt = last_msg.split('\n')[0][:150].strip()

summary_parts = []
if prompt and is_substantive(prompt):
    summary_parts.append(f"Session goal: {prompt[:120]}")
if excerpt:
    summary_parts.append(f"Claude found: {excerpt}")

if not summary_parts:
    sys.exit(0)

summary = " — ".join(summary_parts)
tag = "handoff-checkpoint" if high_usage else "conversation-summary"

subprocess.run(
    [agora_bin, "learn", summary, "--confidence", "confirmed", "--tags", tag],
    capture_output=True
)

if high_usage:
    subprocess.run(
        [agora_bin, "checkpoint", "--context", excerpt, "--quiet"],
        capture_output=True
    )
EOF

exit 0
