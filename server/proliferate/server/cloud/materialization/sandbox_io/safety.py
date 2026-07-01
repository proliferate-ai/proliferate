"""Shell safety helpers for materialized sandbox file writes."""

from __future__ import annotations


def path_safety_functions() -> str:
    return r"""
ensure_safe_path_components() {
  check_path="$1"
  case "$check_path" in
    /*) ;;
    *)
      echo "Refusing to materialize a non-absolute path." >&2
      exit 47
      ;;
  esac

  current=""
  rest="${check_path#/}"
  old_ifs="$IFS"
  IFS="/"
  set -- $rest
  IFS="$old_ifs"
  for part in "$@"; do
    [ -n "$part" ] || continue
    current="${current}/${part}"
    if [ -L "$current" ]; then
      echo "Refusing to materialize through a symlink component: $current" >&2
      exit 47
    fi
  done
}

ensure_safe_target_parent() {
  check_target="$1"
  check_root="${2:-}"
  parent="$(dirname "$check_target")"
  ensure_safe_path_components "$parent"
  if [ -n "$check_root" ]; then
    ensure_safe_path_components "$check_root"
    root_real="$(realpath -m "$check_root")"
    parent_real="$(realpath -m "$parent")"
    case "$parent_real" in
      "$root_real"|"$root_real"/*) ;;
      *)
        echo "Refusing to materialize outside allowed root." >&2
        exit 47
        ;;
    esac
  fi
}
""".strip()
