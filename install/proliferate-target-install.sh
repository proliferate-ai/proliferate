#!/usr/bin/env sh
set -eu
umask 077

if [ -z "${PROLIFERATE_CLOUD_URL:-}" ]; then
  echo "PROLIFERATE_CLOUD_URL is required" >&2
  exit 1
fi

if [ -z "${PROLIFERATE_ENROLLMENT_TOKEN:-}" ]; then
  echo "PROLIFERATE_ENROLLMENT_TOKEN is required" >&2
  exit 1
fi

PROLIFERATE_HOME="${PROLIFERATE_HOME:-$HOME/.proliferate}"
PROLIFERATE_ANYHARNESS_PORT="${PROLIFERATE_ANYHARNESS_PORT:-8457}"
case "$PROLIFERATE_ANYHARNESS_PORT" in
  ""|*[!0123456789]*|0)
    echo "PROLIFERATE_ANYHARNESS_PORT must be a positive port number" >&2
    exit 1
    ;;
esac
if [ "$PROLIFERATE_ANYHARNESS_PORT" -gt 65535 ]; then
  echo "PROLIFERATE_ANYHARNESS_PORT must be between 1 and 65535" >&2
  exit 1
fi
PROLIFERATE_ANYHARNESS_BASE_URL="${PROLIFERATE_ANYHARNESS_BASE_URL:-http://127.0.0.1:$PROLIFERATE_ANYHARNESS_PORT}"
PROLIFERATE_SERVICE_NAME="${PROLIFERATE_SERVICE_NAME:-proliferate-target}"
case "$PROLIFERATE_SERVICE_NAME" in
  ""|*[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.@-]*)
    echo "PROLIFERATE_SERVICE_NAME must be a simple systemd unit name" >&2
    exit 1
    ;;
esac
BIN_DIR="$PROLIFERATE_HOME/bin"
WORKER_DIR="$PROLIFERATE_HOME/worker"
SUPERVISOR_DIR="$PROLIFERATE_HOME/supervisor"
LOG_DIR="$PROLIFERATE_HOME/logs"
mkdir -p "$BIN_DIR" "$WORKER_DIR" "$SUPERVISOR_DIR" "$LOG_DIR"
chmod 700 "$PROLIFERATE_HOME" "$BIN_DIR" "$WORKER_DIR" "$SUPERVISOR_DIR" "$LOG_DIR"

reject_newline() {
  case "$2" in
    *"
"*)
      echo "$1 must not contain newlines" >&2
      exit 1
      ;;
  esac
}

toml_string() {
  reject_newline "TOML string value" "$1"
  escaped="$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  printf '"%s"' "$escaped"
}

systemd_arg() {
  reject_newline "systemd unit argument" "$1"
  escaped="$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  printf '"%s"' "$escaped"
}

uname_s="$(uname -s)"
uname_m="$(uname -m)"
case "$uname_s:$uname_m" in
  Linux:x86_64) target="linux-x86_64" ;;
  Linux:aarch64|Linux:arm64) target="linux-aarch64" ;;
  Darwin:arm64) target="macos-aarch64" ;;
  Darwin:x86_64) target="macos-x86_64" ;;
  *) echo "Unsupported platform: $uname_s $uname_m" >&2; exit 1 ;;
esac

download_binary() {
  name="$1"
  if [ -n "${PROLIFERATE_ARTIFACT_BASE_URL:-}" ]; then
    url="${PROLIFERATE_ARTIFACT_BASE_URL%/}/$target/$name"
    tmp="$BIN_DIR/.$name.tmp.$$"
    rm -f "$tmp"
    if curl -fsSL "$url" -o "$tmp"; then
      chmod +x "$tmp"
      mv "$tmp" "$BIN_DIR/$name"
    else
      rm -f "$tmp"
      echo "Failed to download $name from $url" >&2
      exit 1
    fi
    return
  fi
  if command -v "$name" >/dev/null 2>&1; then
    cp "$(command -v "$name")" "$BIN_DIR/$name"
    chmod +x "$BIN_DIR/$name"
    return
  fi
  echo "Could not find $name and PROLIFERATE_ARTIFACT_BASE_URL is unset" >&2
  exit 1
}

download_binary anyharness
download_binary proliferate-worker
download_binary proliferate-supervisor

cat > "$WORKER_DIR/config.toml" <<EOF
cloud_base_url = $(toml_string "$PROLIFERATE_CLOUD_URL")
enrollment_token = $(toml_string "$PROLIFERATE_ENROLLMENT_TOKEN")
anyharness_base_url = $(toml_string "$PROLIFERATE_ANYHARNESS_BASE_URL")
worker_db_path = $(toml_string "$WORKER_DIR/worker.sqlite3")
heartbeat_interval_seconds = 60
EOF
if [ -n "${PROLIFERATE_ANYHARNESS_BEARER_TOKEN:-}" ]; then
  cat >> "$WORKER_DIR/config.toml" <<EOF
anyharness_bearer_token = $(toml_string "$PROLIFERATE_ANYHARNESS_BEARER_TOKEN")
EOF
fi
chmod 600 "$WORKER_DIR/config.toml"

anyharness_args="$(toml_string "serve"), $(toml_string "--runtime-home"), $(toml_string "$PROLIFERATE_HOME/anyharness"), $(toml_string "--port"), $(toml_string "$PROLIFERATE_ANYHARNESS_PORT")"
if [ -n "${PROLIFERATE_ANYHARNESS_BEARER_TOKEN:-}" ]; then
  anyharness_args="$anyharness_args, $(toml_string "--require-bearer-auth")"
fi

cat > "$SUPERVISOR_DIR/config.toml" <<EOF
anyharness_binary = $(toml_string "$BIN_DIR/anyharness")
worker_binary = $(toml_string "$BIN_DIR/proliferate-worker")
worker_config = $(toml_string "$WORKER_DIR/config.toml")
anyharness_args = [$anyharness_args]
restart_delay_seconds = 5
EOF
if [ -n "${PROLIFERATE_ANYHARNESS_BEARER_TOKEN:-}" ]; then
  cat >> "$SUPERVISOR_DIR/config.toml" <<EOF

[anyharness_env]
ANYHARNESS_BEARER_TOKEN = $(toml_string "$PROLIFERATE_ANYHARNESS_BEARER_TOKEN")
EOF
fi
chmod 600 "$SUPERVISOR_DIR/config.toml"

if command -v systemctl >/dev/null 2>&1; then
  if command -v loginctl >/dev/null 2>&1; then
    current_user="${USER:-$(id -un)}"
    linger_state="$(loginctl show-user "$current_user" -p Linger --value 2>/dev/null || true)"
    if [ "$linger_state" != "yes" ] && ! loginctl enable-linger "$current_user" 2>/dev/null; then
      echo "Warning: could not enable systemd lingering for $current_user." >&2
      echo "The service started by this SSH session may stop after logout." >&2
      echo "To make it persistent, run: sudo loginctl enable-linger $current_user" >&2
    fi
  fi
  systemd_dir="$HOME/.config/systemd/user"
  mkdir -p "$systemd_dir"
  cat > "$systemd_dir/$PROLIFERATE_SERVICE_NAME.service" <<EOF
[Unit]
Description=Proliferate target supervisor
After=network-online.target

[Service]
Type=simple
ExecStart=$(systemd_arg "$BIN_DIR/proliferate-supervisor") --config $(systemd_arg "$SUPERVISOR_DIR/config.toml") run
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  if systemctl --user daemon-reload \
    && systemctl --user enable --now "$PROLIFERATE_SERVICE_NAME.service" \
    && systemctl --user is-active --quiet "$PROLIFERATE_SERVICE_NAME.service"; then
    echo "Proliferate target installed. Check status with: systemctl --user status $PROLIFERATE_SERVICE_NAME.service"
  else
    echo "Proliferate target files installed, but the user systemd service did not start." >&2
    echo "Start manually with:" >&2
    echo "  $BIN_DIR/proliferate-supervisor --config $SUPERVISOR_DIR/config.toml run" >&2
    exit 1
  fi
else
  echo "Proliferate target installed."
  echo "Start it with:"
  echo "  $BIN_DIR/proliferate-supervisor --config $SUPERVISOR_DIR/config.toml run"
fi
