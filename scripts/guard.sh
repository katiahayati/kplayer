#!/usr/bin/env bash
# Runs a command and stops it if the machine's used memory passes a limit
# (WSL here has ~5.8 GB; a runaway job once crashed the whole computer).
# Usage: guard.sh COMMAND [ARGS...]      LIMIT_MB=4800 by default
limit=${LIMIT_MB:-4800}
"$@" &
pid=$!
peak=0
while kill -0 "$pid" 2>/dev/null; do
  used=$(free -m | awk '/Mem:/{print $3}')
  [ "$used" -gt "$peak" ] && peak=$used
  if [ "$used" -gt "$limit" ]; then
    echo "guard: stopping the job, ${used} MB used (limit ${limit} MB)" >&2
    kill "$pid"
  fi
  sleep 1
done
wait "$pid"
status=$?
echo "guard: exit ${status}, peak memory used ${peak} MB" >&2
exit $status
