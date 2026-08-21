#!/bin/bash
# Report whether a local Postgres and Redis are already listening.
#
# Prints two words, "<postgres> <redis>", each 1 or 0, for the Makefile to read
# when the caller has not set USE_EXISTING_POSTGRES / USE_EXISTING_REDIS. The
# point is that `make dev PROFILE=x` should use a native service that is already
# bound to the port rather than bringing up a Docker one on top of it, without
# every invocation needing a shell wrapper to say so.
#
# /dev/tcp is a bash builtin and has no connect timeout, so probing is limited
# to loopback hosts, where a connect either succeeds or is refused immediately
# and can never hang a make parse. Any other host reports 0, which selects the
# Docker path: the same answer make gave before this script existed.
#
# Usage: probe-local-services.sh <pg-host> <pg-port> <redis-host> <redis-port>

set -u

# The Postgres half additionally requires a client. `make`'s existing-Postgres
# path does not just open a socket: scripts/dev.mjs `ensureDatabase` shells out
# to `psql -h <host> -p <port>` when USE_EXISTING_POSTGRES is 1, and without
# psql on PATH spawnSync fails ENOENT and surfaces as a bare
# "psql ... failed" with no stdout or stderr to explain it. The repo's own
# docker-compose publishes its db on the same 5432 by default, so a plain socket
# probe would flip a working Docker setup onto a psql path that is not there.
# Report 0 instead: Docker keeps talking to Docker.
probe_postgres() {
  command -v psql >/dev/null 2>&1 || { printf '0'; return; }
  probe "$1" "$2"
}

probe() {
  local host="$1" port="$2"
  case "$host" in
    127.0.0.1 | ::1 | localhost) ;;
    *)
      printf '0'
      return
      ;;
  esac
  if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
    printf '1'
  else
    printf '0'
  fi
}

printf '%s %s\n' "$(probe_postgres "${1:-}" "${2:-}")" "$(probe "${3:-}" "${4:-}")"
