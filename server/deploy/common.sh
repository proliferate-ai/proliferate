#!/usr/bin/env bash
#
# Shared helpers for the self-hosted deploy scripts (install.sh, preflight.sh,
# doctor.sh, bootstrap.sh, update.sh). Sourced, never executed. Everything here
# is intentionally dependency-light: an operator host has bash, coreutils, and
# curl, nothing more.
#
# This file is part of the deploy bundle (server/deploy/**) so it ships next to
# the scripts that source it in the released proliferate-deploy.tar.gz, on a
# monorepo checkout, and on the AWS host, which all keep these files in one
# directory.

# --- env-file reading --------------------------------------------------------

# proliferate_read_env <file> <key>: print the raw value of KEY= from an env
# file (empty when the file or key is absent). Reads the first match only, so a
# generated override that appends KEY= later would need a dedicated reader; the
# deploy scripts never do that.
proliferate_read_env() {
  local file="$1"
  local key="$2"
  local line

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  line="$(grep -m1 "^${key}=" "$file" || true)"
  if [[ -z "$line" ]]; then
    return 0
  fi

  printf '%s' "${line#*=}"
}

# proliferate_is_truthy <value>: 0 when the value reads as an enabled flag.
proliferate_is_truthy() {
  local value="${1:-}"
  case "$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" in
    true | 1 | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

# --- release resolution ------------------------------------------------------
#
# ONE implementation of "which server release" shared by install.sh and
# doctor.sh. It resolves the newest server-v* release specifically and
# deliberately ignores GitHub's generic "latest" release: the newest release
# overall is usually a desktop-v*/runtime-v*/proliferate-v* tag that carries no
# self-hosted assets, so /releases/latest would hand an operator a bundle-less
# release. Overridable for tests / forks via the env vars below.

PROLIFERATE_REPO="${PROLIFERATE_REPO:-proliferate-ai/proliferate}"
PROLIFERATE_RELEASE_API="${PROLIFERATE_RELEASE_API:-https://api.github.com/repos/${PROLIFERATE_REPO}/releases}"
PROLIFERATE_RELEASE_DOWNLOAD_BASE="${PROLIFERATE_RELEASE_DOWNLOAD_BASE:-https://github.com/${PROLIFERATE_REPO}/releases/download}"

# proliferate_max_version: read newline-separated X.Y.Z(.suffix) versions on
# stdin and print the highest by numeric major/minor/patch. Portable (awk only,
# no GNU `sort -V`), so it behaves the same on a macOS dev box and a Linux host.
proliferate_max_version() {
  awk '
    {
      split($0, a, ".")
      maj = a[1] + 0
      min = a[2] + 0
      pat = a[3]
      sub(/[^0-9].*/, "", pat)
      pat = pat + 0
      key = maj * 1000000 + min * 1000 + pat
      if (best == "" || key > best) { best = key; bestline = $0 }
    }
    END { if (bestline != "") print bestline }
  '
}

# proliferate_latest_server_version: print the newest server-v* release version
# (unprefixed, e.g. 0.3.18). Returns 1 (prints nothing) when the release list
# cannot be fetched or contains no server-v* release.
proliferate_latest_server_version() {
  local json version
  json="$(curl -fsSL -H 'Accept: application/vnd.github+json' \
    "${PROLIFERATE_RELEASE_API}?per_page=100" 2>/dev/null)" || return 1
  version="$(printf '%s\n' "$json" \
    | grep -oE '"tag_name":[[:space:]]*"server-v[0-9][0-9A-Za-z.-]*"' \
    | sed -E 's/.*"server-v([0-9][0-9A-Za-z.-]*)".*/\1/' \
    | proliferate_max_version)"
  if [[ -z "$version" ]]; then
    return 1
  fi
  printf '%s' "$version"
}

# --- compose profiles --------------------------------------------------------
#
# The one documented mechanism for optional services: a capability flag in the
# resolved env turns on a compose profile, and every lifecycle command
# (bootstrap, update, health, doctor) computes the same profile set from that
# flag. bootstrap.sh/update.sh pass the resulting --profile args to every
# `docker compose` call so pull/up/down stay consistent. Add a capability here
# and it is covered everywhere at once.
#
# agent-gateway:    the bundled LiteLLM proxy (services litellm + litellm-db).
# cloud-workspaces: the durable Redis used for the cloud-materialization lock
#                    (service redis). Mirrors the E2B_API_KEY +
#                    E2B_TEMPLATE_NAME "complete pair" gate preflight.sh
#                    already enforces, so Redis comes up automatically exactly
#                    when cloud workspaces are actually usable — never as an
#                    ad-hoc container an operator has to remember to add.

# proliferate_enabled_profiles <runtime_env_file>: print the space-separated
# compose profile names enabled by the resolved config.
proliferate_enabled_profiles() {
  local env_file="$1"
  local profiles=()

  if proliferate_is_truthy "$(proliferate_read_env "$env_file" AGENT_GATEWAY_ENABLED)"; then
    profiles+=("agent-gateway")
  fi

  if [[ -n "$(proliferate_read_env "$env_file" E2B_API_KEY)" && \
        -n "$(proliferate_read_env "$env_file" E2B_TEMPLATE_NAME)" ]]; then
    profiles+=("cloud-workspaces")
  fi

  if ((${#profiles[@]})); then
    printf '%s' "${profiles[*]}"
  fi
}

# proliferate_profile_args <runtime_env_file>: print newline-separated
# `--profile` / `<name>` tokens, one per line. Callers read this into a bash
# array with a while-read loop (bash 3.2-safe, no namerefs) so an empty profile
# set yields an empty array that expands cleanly under `set -u`:
#
#   PROFILE_ARGS=()
#   while IFS= read -r tok; do [[ -n "$tok" ]] && PROFILE_ARGS+=("$tok"); done \
#     < <(proliferate_profile_args "$RUNTIME_ENV_FILE")
#   docker compose ... ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} pull
proliferate_profile_args() {
  local env_file="$1"
  local profiles
  local name

  profiles="$(proliferate_enabled_profiles "$env_file")"
  for name in $profiles; do
    printf -- '--profile\n%s\n' "$name"
  done
}

# proliferate_profile_services <runtime_env_file>: print newline-separated
# compose SERVICE names (not profile names) for every enabled profile. Callers
# pass this list explicitly to `docker compose ... up -d --wait <services>` so
# the reconciliation touches ONLY the profiled services. Without an explicit
# service list, `up` reconciles every service the active --profile flags make
# visible, including base services like `migrate` — a restart:"no" one-shot
# job that always exits after running, which `--wait` would then report as a
# failure. Scoping to just the profiled services avoids that entirely.
proliferate_profile_services() {
  local env_file="$1"
  local profiles
  local name

  profiles="$(proliferate_enabled_profiles "$env_file")"
  for name in $profiles; do
    case "$name" in
      agent-gateway) printf 'litellm-db\nlitellm\n' ;;
      cloud-workspaces) printf 'redis\n' ;;
    esac
  done
}
