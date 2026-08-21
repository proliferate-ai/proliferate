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

printf '%s %s\n' "$(probe "${1:-}" "${2:-}")" "$(probe "${3:-}" "${4:-}")"
