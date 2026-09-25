#!/usr/bin/env bash
# One command to generate the REAL judge-accuracy report.
#
# It loads .env (so ANTHROPIC_API_KEY and the rest of the schema are present),
# checks that a real Anthropic key is set, runs the judge over the gold set
# three times per case (K=3, for self-consistency), and writes eval/report.json.
# Then it prints the exact commit command. tsx does not auto-load .env, which is
# why this wrapper does it.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

key="${ANTHROPIC_API_KEY:-}"
case "$key" in
  "" | local* )
    echo "ANTHROPIC_API_KEY is not set to a real key (found: '${key:-unset}')."
    echo
    echo "Set a real key one of two ways, then re-run 'npm run eval:real':"
    echo "  1. export ANTHROPIC_API_KEY=sk-ant-...   (for this shell)"
    echo "  2. put ANTHROPIC_API_KEY=sk-ant-... in .env"
    exit 1
    ;;
esac

echo "Running the real judge over the gold set (K=3 samples per case)..."
echo "This makes real Anthropic calls and will take a couple of minutes."
echo
npx tsx scripts/run-eval.ts --samples 3

echo
echo "Real report written to eval/report.json (the /eval sample-data banner is now gone)."
echo "Review it, then commit:"
echo "  git add eval/report.json && git commit -m \"chore(eval): real judge-accuracy report\""
