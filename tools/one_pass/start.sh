#!/bin/bash
# One-pass Re-plan tests (15 Nov 2026): serve solver-replay copies locally, one per port.
#   start.sh <name> <path to solver-replay index.ts> <port...>
# Then: identity.py <old port> <new port> out.json (deployed copy vs this branch, switch off)
#       sim.py BAm56r teton.jsonl --ports 8101,8102,8103   /  sim.py foV_B faroes.jsonl --every 3 --ports 8114
#       analyze.py BAm56r teton.jsonl                        (practice rounds: --runs <app_T run ids>)
#       chain_test.py <port> BAm56r 10 out.json (a server started with SOLVER_REPLAY_URL=http://127.0.0.1:<port>/)
# Keep the clients to about 6 at once: more runs the API connection pool dry (and slows the live app).
# Bench rows are written under run config names op_sim / op_id_* / op_chain_* with status 'sim' (the tick ignores them).
D=$(cd "$(dirname "$0")" && pwd)
name=$1; file=$2; shift 2
for p in "$@"; do
  SR_PORT=$p SR_FILE=$file SUPABASE_URL=https://ohshrzlvvxyovcjmdajc.supabase.co SUPABASE_SERVICE_ROLE_KEY=placeholder \
    nohup deno run -A --no-lock --node-modules-dir=none "$D/serve.ts" > "${TMPDIR:-/tmp}/${name}_$p.log" 2>&1 &
done
