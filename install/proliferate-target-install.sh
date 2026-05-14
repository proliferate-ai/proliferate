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
PROLIFERATE_ANYHARNESS_BASE_URL="${PROLIFERATE_ANYHARNESS_BASE_URL:-http://127.0.0.1:8457}"
BIN_DIR="$PROLIFERATE_HOME/bin"
WORKER_DIR="$PROLIFERATE_HOME/worker"
SUPERVISOR_DIR="$PROLIFERATE_HOME/supervisor"
mkdir -p "$BIN_DIR" "$WORKER_DIR" "$SUPERVISOR_DIR"
chmod 700 "$PROLIFERATE_HOME" "$BIN_DIR" "$WORKER_DIR" "$SUPERVISOR_DIR"

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
  if command -v "$name" >/dev/null 2>&1; then
    cp "$(command -v "$name")" "$BIN_DIR/$name"
    chmod +x "$BIN_DIR/$name"
    return
  fi
  if [ -n "${PROLIFERATE_ARTIFACT_BASE_URL:-}" ]; then
    url="${PROLIFERATE_ARTIFACT_BASE_URL%/}/$target/$name"
    curl -fsSL "$url" -o "$BIN_DIR/$name"
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
cloud_base_url = "$PROLIFERATE_CLOUD_URL"
enrollment_token = "$PROLIFERATE_ENROLLMENT_TOKEN"
anyharness_base_url = "$PROLIFERATE_ANYHARNESS_BASE_URL"
worker_db_path = "$WORKER_DIR/worker.sqlite3"
heartbeat_interval_seconds = 60
EOF
if [ -n "${PROLIFERATE_ANYHARNESS_BEARER_TOKEN:-}" ]; then
  cat >> "$WORKER_DIR/config.toml" <<EOF
anyharness_bearer_token = "$PROLIFERATE_ANYHARNESS_BEARER_TOKEN"
EOF
fi
chmod 600 "$WORKER_DIR/config.toml"

cat > "$SUPERVISOR_DIR/config.toml" <<EOF
anyharness_binary = "$BIN_DIR/anyharness"
worker_binary = "$BIN_DIR/proliferate-worker"
worker_config = "$WORKER_DIR/config.toml"
anyharness_args = ["serve"]
restart_delay_seconds = 5
EOF
chmod 600 "$SUPERVISOR_DIR/config.toml"

if command -v systemctl >/dev/null 2>&1; then
  systemd_dir="$HOME/.config/systemd/user"
  mkdir -p "$systemd_dir"
  cat > "$systemd_dir/proliferate-target.service" <<EOF
[Unit]
Description=Proliferate target supervisor
After=network-online.target

[Service]
Type=simple
ExecStart=$BIN_DIR/proliferate-supervisor --config $SUPERVISOR_DIR/config.toml run
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  if systemctl --user daemon-reload \
    && systemctl --user enable --now proliferate-target.service \
    && systemctl --user is-active --quiet proliferate-target.service; then
    echo "Proliferate target installed. Check status with: systemctl --user status proliferate-target.service"
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
