#!/bin/sh
# run1.sh <page dir> <out> <tag> <style|-> <keys> [extra env]
cd /tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/trees_review/js; U=/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/sharp/upload2
P=$1; O=$2; G=$3; ST=$4; K=$5; shift 5
env RANGES=$U/range_rows.json RFILES=$U DETAILS=$U/detail_rows.json DFILES=$U HOUSES=$U/house_rows.json HFILES=$U NODE_PATH=/opt/node-tools/node_modules JOBS=/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/rv_jobs.json W=1200 H=800 HEAP=1 TSTYLE=$( [ "$ST" = "-" ] || echo $ST ) "$@" node rv2.js $P $O $G trees $K
