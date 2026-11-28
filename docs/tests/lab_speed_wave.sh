#!/bin/bash
# Runs each trip's drafts one at a time: A (tick pace), B (chained), A2 (tick pace again)
S=$(dirname $0); TAG=$1; AT=$2
for T in 7e57bed0-0000-4000-8000-000000000004 7e57bed0-0000-4000-8000-000000000003 7e57bed0-0000-4000-8000-000000000002 5e247891-d800-4d07-b5e0-8ad748ae2754 e04fbc9d-86b1-42b2-bf08-fc65a18e665d; do
  for V in A B A2; do
    id=$($S/q.sh "select lab_speed_make('$T','$V','$TAG','$AT') id" | jq '.[0].id')
    t0=$(date +%s)
    while true; do
      st=$($S/q.sh "select status from replay_runs where id=$id" | jq -r '.[0].status')
      [ "$st" = done ] || [ "$st" = error ] || [ "$st" = stopped ] && break
      [ $(( $(date +%s) - t0 )) -gt 1800 ] && st=timeout && break
      sleep 5
    done
    echo "$(date -u +%H:%M:%S) $TAG ${T: -4} $V run=$id $st $(( $(date +%s) - t0 ))s"
  done
done
echo WAVE_DONE
