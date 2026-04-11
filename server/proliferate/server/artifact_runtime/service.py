from pathlib import Path

STATIC_DIR = Path(__file__).resolve().parent / "static"
INDEX_PATH = STATIC_DIR / "index.html"
SCRIPT_SRC_ALLOWED_ORIGINS = (
    "https://cdn.jsdelivr.net",
    "https://esm.sh",
)
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "connect-src 'none'; "
    "frame-src 'self'; "
    "img-src 'self' data:; "
    f"script-src 'self' 'unsafe-inline' 'unsafe-eval' {' '.join(SCRIPT_SRC_ALLOWED_ORIGINS)}; "
    "style-src 'self' 'unsafe-inline'; "
    "font-src 'self'; "
    "form-action 'none'; "
    "base-uri 'self'"
)


def resolve_runtime_path(requested_path: str) -> Path:
    candidate = (STATIC_DIR / requested_path).resolve()
    try:
        candidate.relative_to(STATIC_DIR)
    except ValueError:
        return INDEX_PATH

    if requested_path and candidate.is_file():
        return candidate
    return INDEX_PATH
