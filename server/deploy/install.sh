#!/usr/bin/env bash
#
# Guided installer for the self-hosted Proliferate control plane.
#
# Fetches the versioned deploy bundle from a real server-v* GitHub release,
# verifies its checksum, installs it to a durable location, generates or
# preserves operator configuration, and brings the stack up to the claim page.
# No monorepo clone required.
#
# INSPECT FIRST (recommended):
#   curl -fsSLO https://raw.githubusercontent.com/proliferate-ai/proliferate/main/server/deploy/install.sh
#   less install.sh
#   sudo bash install.sh --domain api.company.com
#
# CONVENIENCE (pipe to shell):
#   curl -fsSL https://raw.githubusercontent.com/proliferate-ai/proliferate/main/server/deploy/install.sh \
#     | sudo bash -s -- --domain api.company.com
#
# EVALUATION (no domain; uses an sslip.io hostname derived from the public IP,
# real Let's Encrypt TLS):
#   sudo bash install.sh --eval
#
# The installer is idempotent: rerunning refreshes the bundle scripts without
# overwriting your .env.static, generated secrets, or data.

set -euo pipefail

# Re-exec under bash if launched with a POSIX shell from a file (arrays, [[ ]]).
# When piped as `... | sudo bash`, BASH_VERSION is already set so this is a no-op.
if [ -z "${BASH_VERSION:-}" ]; then
  if command -v bash >/dev/null 2>&1 && [ -f "$0" ]; then
    exec bash "$0" "$@"
  fi
  echo "This installer requires bash. Run: sudo bash install.sh ..." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Defaults and flags
# ---------------------------------------------------------------------------

INSTALL_ROOT="${PROLIFERATE_INSTALL_ROOT:-/opt/proliferate}"
DEPLOY_DIR=""            # resolved after flag parse: $INSTALL_ROOT/server/deploy
DOMAIN=""
VERSION=""               # explicit pin, e.g. 0.3.18 (no server-v prefix)
VERSION_EXPLICIT=0
EVAL_MODE=0
TELEMETRY_MODE="self_managed"
IMAGE_REPO="ghcr.io/proliferate-ai/proliferate-server"
ASSUME_YES=0
DRY_RUN=0
NO_START=0

# Overridable download endpoints (also honored by common.sh) for tests/forks.
REPO_SLUG="${PROLIFERATE_REPO:-proliferate-ai/proliferate}"

usage() {
  cat <<'USAGE'
Proliferate self-hosted installer

Usage: install.sh [options]

Options:
  -d, --domain HOST        Public hostname for the control plane (Caddy issues
                           TLS for it). Point DNS at this host first.
      --eval               Evaluation mode: no domain; derive an sslip.io
                           hostname from the public IP with real TLS.
  -v, --version X.Y.Z      Install a specific server release (default: newest
                           server-v* release). Also re-pins the image tag on
                           rerun.
      --telemetry-mode M   PROLIFERATE_TELEMETRY_MODE (default: self_managed).
      --image-repo REPO    Server image repository (default GHCR).
      --install-root DIR   Durable install root (default: /opt/proliferate).
      --no-start           Fetch and configure only; do not bootstrap the stack.
      --dry-run            Print the resolved plan and exit without changing
                           anything.
  -y, --yes                Do not prompt for confirmation.
  -h, --help               Show this help.

Environment overrides (advanced/testing):
  PROLIFERATE_INSTALL_ROOT, PROLIFERATE_REPO, PROLIFERATE_RELEASE_API,
  PROLIFERATE_RELEASE_DOWNLOAD_BASE.

Examples:
  sudo bash install.sh --domain api.company.com
  sudo bash install.sh --eval
  sudo bash install.sh --version 0.3.18 --domain api.company.com --yes
USAGE
}

die() {
  echo "install: $*" >&2
  exit 1
}

log() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d | --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --eval | --evaluation)
      EVAL_MODE=1
      shift
      ;;
    -v | --version)
      VERSION="${2:-}"
      VERSION_EXPLICIT=1
      shift 2
      ;;
    --telemetry-mode)
      TELEMETRY_MODE="${2:-}"
      shift 2
      ;;
    --image-repo)
      IMAGE_REPO="${2:-}"
      shift 2
      ;;
    --install-root)
      INSTALL_ROOT="${2:-}"
      shift 2
      ;;
    --no-start)
      NO_START=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -y | --yes)
      ASSUME_YES=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (use --help)"
      ;;
  esac
done

DEPLOY_DIR="$INSTALL_ROOT/server/deploy"
# Strip any scheme the operator pasted into --domain; SITE_ADDRESS is a host.
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%/}"

if [[ "$EVAL_MODE" -eq 1 && -n "$DOMAIN" ]]; then
  die "--eval and --domain are mutually exclusive."
fi
if [[ "$EVAL_MODE" -eq 0 && -z "$DOMAIN" ]]; then
  # First-install with neither is a hard stop; a rerun that preserves an
  # existing .env.static is fine (handled after we know the install state).
  NEEDS_DOMAIN=1
else
  NEEDS_DOMAIN=0
fi

export PROLIFERATE_REPO="$REPO_SLUG"

# ---------------------------------------------------------------------------
# Self-contained helpers
#
# install.sh is fetched standalone (curl | bash) before the bundle exists, so
# it cannot source common.sh. It carries its own minimal copies of the release
# resolution and env-read logic; common.sh is the shared copy the *other*
# bundle scripts use. Keep the two in sync.
# ---------------------------------------------------------------------------

RELEASE_API="${PROLIFERATE_RELEASE_API:-https://api.github.com/repos/${REPO_SLUG}/releases}"
DOWNLOAD_BASE="${PROLIFERATE_RELEASE_DOWNLOAD_BASE:-https://github.com/${REPO_SLUG}/releases/download}"

read_env() {
  local file="$1" key="$2" line
  [[ -f "$file" ]] || return 0
  line="$(grep -m1 "^${key}=" "$file" || true)"
  [[ -n "$line" ]] || return 0
  printf '%s' "${line#*=}"
}

# max_version: newline-separated X.Y.Z(.suffix) on stdin -> highest by numeric
# major/minor/patch. awk-only; matches common.sh::proliferate_max_version.
max_version() {
  awk '
    {
      split($0, a, ".")
      maj = a[1] + 0; min = a[2] + 0
      pat = a[3]; sub(/[^0-9].*/, "", pat); pat = pat + 0
      key = maj * 1000000 + min * 1000 + pat
      if (best == "" || key > best) { best = key; bestline = $0 }
    }
    END { if (bestline != "") print bestline }
  '
}

# latest_server_version: newest server-v* release version (unprefixed), NOT
# GitHub's generic /releases/latest (which is usually a bundle-less tag).
latest_server_version() {
  local json version
  json="$(curl -fsSL -H 'Accept: application/vnd.github+json' \
    "${RELEASE_API}?per_page=100" 2>/dev/null)" || return 1
  version="$(printf '%s\n' "$json" \
    | grep -oE '"tag_name":[[:space:]]*"server-v[0-9][0-9A-Za-z.-]*"' \
    | sed -E 's/.*"server-v([0-9][0-9A-Za-z.-]*)".*/\1/' \
    | max_version)"
  [[ -n "$version" ]] || return 1
  printf '%s' "$version"
}

# ---------------------------------------------------------------------------
# Host checks
# ---------------------------------------------------------------------------

check_host() {
  log "Checking host"

  local os arch
  os="$(uname -s)"
  if [[ "$os" != "Linux" ]]; then
    die "unsupported OS '$os'. The self-hosted control plane runs on Linux with Docker. (On macOS/Windows, run the official desktop app and point it at a Linux-hosted control plane.)"
  fi
  info "OS: Linux"

  arch="$(uname -m)"
  case "$arch" in
    x86_64 | amd64) info "Architecture: x86_64" ;;
    aarch64 | arm64) info "Architecture: aarch64" ;;
    *) die "unsupported architecture '$arch'. Supported: x86_64, aarch64." ;;
  esac

  local tool
  for tool in curl tar sha256sum; do
    command -v "$tool" >/dev/null 2>&1 || die "'$tool' is required but not found. Install it and rerun."
  done

  command -v docker >/dev/null 2>&1 || die "Docker is required. Install Docker Engine and rerun: https://docs.docker.com/engine/install/"
  if ! docker info >/dev/null 2>&1; then
    die "Docker is installed but the daemon is not reachable. Start Docker (systemctl start docker) or rerun with sudo."
  fi
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (the 'docker compose' plugin). Install docker-compose-plugin and rerun."
  info "Docker + Compose v2: OK"

  # Writable install root (needs root for the default /opt).
  local parent="$INSTALL_ROOT"
  while [[ ! -d "$parent" && "$parent" != "/" ]]; do
    parent="$(dirname "$parent")"
  done
  if [[ ! -w "$parent" ]]; then
    die "cannot write under '$parent' (needed for $INSTALL_ROOT). Rerun with sudo, or pass --install-root to a writable path."
  fi
  info "Install root writable: $INSTALL_ROOT"

  # Disk: warn under ~5 GB free (images total a few GB).
  local free_kb
  free_kb="$(df -Pk "$parent" 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ -n "$free_kb" && "$free_kb" -lt 5242880 ]]; then
    info "WARNING: only $((free_kb / 1024)) MB free under $parent; ~5 GB recommended for images + data."
  fi

  # Ports 80/443: warn if a non-Docker listener already holds them on a fresh
  # install (Caddy needs them for HTTP-01 TLS). Skipped when ss is unavailable.
  if command -v ss >/dev/null 2>&1 && [[ ! -d "$DEPLOY_DIR" ]]; then
    local port
    for port in 80 443; do
      if ss -ltn "sport = :$port" 2>/dev/null | awk 'NR>1{f=1} END{exit !f}'; then
        info "WARNING: port $port already has a listener. Caddy needs 80 and 443; free them or stop the conflicting service."
      fi
    done
  fi
}

# ---------------------------------------------------------------------------
# Release resolution
# ---------------------------------------------------------------------------

resolve_version() {
  if [[ -n "$VERSION" ]]; then
    VERSION="${VERSION#server-v}"
    VERSION="${VERSION#v}"
    info "Using pinned server release: server-v$VERSION"
    return 0
  fi

  log "Resolving newest server-v* release (ignoring GitHub's generic 'latest')"
  VERSION="$(latest_server_version || true)"
  if [[ -z "$VERSION" ]]; then
    die "could not resolve a server-v* release from ${RELEASE_API}. Check network access, or pass --version X.Y.Z to pin one."
  fi
  info "Resolved: server-v$VERSION"
}

# ---------------------------------------------------------------------------
# Download + verify + extract
# ---------------------------------------------------------------------------

FETCH_TMP=""
cleanup_fetch() { [[ -n "$FETCH_TMP" && -d "$FETCH_TMP" ]] && rm -rf "$FETCH_TMP"; }
trap cleanup_fetch EXIT

download_and_verify_bundle() {
  local base="${DOWNLOAD_BASE}/server-v${VERSION}"
  local bundle_url="$base/proliferate-deploy.tar.gz"
  local sums_url="$base/self-hosted-assets.SHA256SUMS"

  FETCH_TMP="$(mktemp -d "${TMPDIR:-/tmp}/proliferate-install.XXXXXX")"

  log "Downloading deploy bundle for server-v$VERSION"
  info "$bundle_url"
  curl -fsSL "$bundle_url" -o "$FETCH_TMP/proliferate-deploy.tar.gz" \
    || die "failed to download the deploy bundle from $bundle_url. Confirm server-v$VERSION exists and carries proliferate-deploy.tar.gz."
  curl -fsSL "$sums_url" -o "$FETCH_TMP/self-hosted-assets.SHA256SUMS" \
    || die "failed to download the checksum file from $sums_url."

  log "Verifying checksum before extraction"
  (
    cd "$FETCH_TMP"
    # --ignore-missing: the sums file also covers the runtime tarballs and AWS
    # template, which we did not download here.
    sha256sum -c --ignore-missing self-hosted-assets.SHA256SUMS
  ) || die "checksum verification FAILED for proliferate-deploy.tar.gz. The download is corrupt or tampered; not extracting."
  info "Checksum OK"

  log "Extracting bundle"
  tar xzf "$FETCH_TMP/proliferate-deploy.tar.gz" -C "$FETCH_TMP"
  [[ -d "$FETCH_TMP/proliferate-deploy" ]] \
    || die "bundle did not extract to a proliferate-deploy/ directory."
}

install_bundle_files() {
  # Refresh scripts/compose/example/VERSION without ever clobbering operator
  # config or data (.env.static, .env.local, .env.generated, .env.runtime).
  mkdir -p "$DEPLOY_DIR" "$INSTALL_ROOT/bin"
  local src="$FETCH_TMP/proliferate-deploy"
  local rel
  while IFS= read -r -d '' rel; do
    case "$rel" in
      ./.env.static | ./.env.local | ./.env.generated | ./.env.runtime) continue ;;
    esac
    local dest="$DEPLOY_DIR/${rel#./}"
    mkdir -p "$(dirname "$dest")"
    cp -p "$src/$rel" "$dest"
  done < <(cd "$src" && find . -type f -print0)
  info "Deploy files installed to $DEPLOY_DIR"
}

# ---------------------------------------------------------------------------
# Configuration (generate on first install, preserve on rerun)
# ---------------------------------------------------------------------------

# set_env_key <file> <key> <value>: idempotently set KEY=value in an env file,
# replacing an existing line or appending. Never prints the value.
set_env_key() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' "$file" >"$tmp"
  else
    cat "$file" >"$tmp"
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

configure() {
  local static_file="$DEPLOY_DIR/.env.static"
  local example_file="$DEPLOY_DIR/.env.production.example"

  if [[ -f "$static_file" ]]; then
    log "Existing configuration found; preserving $static_file"
    # Only re-pin the image tag on an explicit --version rerun (the installer
    # upgrade path). Everything else the operator set is left untouched.
    if [[ "$VERSION_EXPLICIT" -eq 1 ]]; then
      local current_tag
      current_tag="$(read_env "$static_file" PROLIFERATE_SERVER_IMAGE_TAG)"
      if [[ "$current_tag" != "$VERSION" ]]; then
        set_env_key "$static_file" PROLIFERATE_SERVER_IMAGE_TAG "$VERSION"
        info "Re-pinned PROLIFERATE_SERVER_IMAGE_TAG to $VERSION"
      fi
    fi
    if [[ -n "$DOMAIN" ]]; then
      local current_site
      current_site="$(read_env "$static_file" SITE_ADDRESS)"
      if [[ "$current_site" != "$DOMAIN" ]]; then
        info "NOTE: --domain=$DOMAIN differs from the existing SITE_ADDRESS ($current_site). Preserving the existing value; edit $static_file manually to change it."
      fi
    fi
    return 0
  fi

  # First install: NEEDS_DOMAIN was validated only for the fresh case.
  if [[ "$NEEDS_DOMAIN" -eq 1 ]]; then
    die "first install needs a hostname: pass --domain HOST, or --eval for an sslip.io evaluation host."
  fi

  log "Generating configuration ($static_file)"
  cp "$example_file" "$static_file"
  chmod 600 "$static_file"

  if [[ "$EVAL_MODE" -eq 1 ]]; then
    set_env_key "$static_file" SITE_ADDRESS ""
    set_env_key "$static_file" PROLIFERATE_USE_SSLIP_FALLBACK "true"
    info "Evaluation mode: SITE_ADDRESS will be an sslip.io host derived from the public IP at bootstrap."
  else
    set_env_key "$static_file" SITE_ADDRESS "$DOMAIN"
    info "SITE_ADDRESS set to $DOMAIN"
  fi

  set_env_key "$static_file" PROLIFERATE_TELEMETRY_MODE "$TELEMETRY_MODE"
  set_env_key "$static_file" PROLIFERATE_SERVER_IMAGE "$IMAGE_REPO"
  # Pin the image tag to the resolved release for controlled, reproducible
  # upgrades (the spec's recommended strategy over the rolling :stable tag).
  set_env_key "$static_file" PROLIFERATE_SERVER_IMAGE_TAG "$VERSION"

  info "Secrets (POSTGRES_PASSWORD, JWT_SECRET, CLOUD_SECRET_KEY) left blank; bootstrap generates and persists them in .env.generated."
}

record_version() {
  printf '%s\n' "$VERSION" >"$DEPLOY_DIR/.installed-version"
}

# ---------------------------------------------------------------------------
# Plan / confirm
# ---------------------------------------------------------------------------

print_plan() {
  log "Plan"
  info "Install root:   $INSTALL_ROOT"
  info "Deploy dir:     $DEPLOY_DIR"
  info "Server release: server-v${VERSION:-<resolved at run>}"
  info "Image repo:     $IMAGE_REPO"
  if [[ "$EVAL_MODE" -eq 1 ]]; then
    info "Hostname:       sslip.io evaluation host (from public IP)"
  elif [[ -n "$DOMAIN" ]]; then
    info "Hostname:       $DOMAIN"
  else
    info "Hostname:       (preserved from existing .env.static)"
  fi
  info "Telemetry:      $TELEMETRY_MODE"
  info "Start stack:    $([[ "$NO_START" -eq 1 ]] && echo no || echo yes)"
}

confirm() {
  [[ "$ASSUME_YES" -eq 1 ]] && return 0
  [[ ! -t 0 ]] && return 0 # non-interactive (piped) install proceeds
  printf '\nProceed? [y/N] '
  local reply
  read -r reply || true
  case "$reply" in
    y | Y | yes | YES) return 0 ;;
    *) die "aborted by operator." ;;
  esac
}

# ---------------------------------------------------------------------------
# Next steps
# ---------------------------------------------------------------------------

print_next_steps() {
  local site
  site="$(read_env "$DEPLOY_DIR/.env.static" SITE_ADDRESS)"
  local host="$site"
  host="${host#http://}"
  host="${host#https://}"
  host="${host%/}"
  local base
  if [[ -n "$host" ]]; then
    base="https://$host"
  else
    base="https://<your-host>"
  fi

  log "Installed server-v$VERSION"
  cat <<EOF

  Control plane:  $base
  Claim page:     $base/setup   (open in a browser with the setup token above)

  Manage this instance from $DEPLOY_DIR:
    Update:   sudo $DEPLOY_DIR/update.sh
    Doctor:   sudo $DEPLOY_DIR/doctor.sh
    Logs:     docker compose --env-file $DEPLOY_DIR/.env.runtime -f $DEPLOY_DIR/docker-compose.production.yml logs -f
    Config:   $DEPLOY_DIR/.env.static   (edit, then rerun update.sh)

  Point the official desktop app at this control plane by writing
  ~/.proliferate/config.json:
    { "apiBaseUrl": "$base" }
EOF
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  check_host
  resolve_version

  if [[ "$DRY_RUN" -eq 1 ]]; then
    print_plan
    log "Dry run: no changes made."
    exit 0
  fi

  print_plan
  confirm

  download_and_verify_bundle
  install_bundle_files

  configure
  record_version

  # Fail before starting if the resolved config is dangerous (e.g. E2B_API_KEY
  # without E2B_TEMPLATE_NAME, which would crash-loop the api container).
  # Older release bundles predate preflight.sh; skip validation there rather
  # than blocking a valid install (the server still validates at startup).
  if [[ -x "$DEPLOY_DIR/preflight.sh" ]]; then
    log "Validating configuration"
    "$DEPLOY_DIR/preflight.sh" "$DEPLOY_DIR/.env.static" || die "preflight failed; not starting. Fix $DEPLOY_DIR/.env.static and rerun."
  else
    info "This release bundle predates preflight.sh; skipping installer-side config validation."
  fi

  if [[ "$NO_START" -eq 1 ]]; then
    log "Configured only (--no-start). Start with: sudo $DEPLOY_DIR/bootstrap.sh"
    print_next_steps
    exit 0
  fi

  log "Starting the stack"
  ( cd "$DEPLOY_DIR" && ./bootstrap.sh )

  print_next_steps
}

main
