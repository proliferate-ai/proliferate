"""Byte-stable Settings defaults extracted only to preserve config.py's line budget."""

ENV_FILES = (".env", ".env.local")
SAFE_IDENTITY_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-"
)

DEFAULT_CORS_ALLOW_ORIGINS = (
    "http://localhost:1420,"
    "http://127.0.0.1:1420,"
    "http://localhost:5174,"
    "http://127.0.0.1:5174,"
    "http://localhost:5175,"
    "http://127.0.0.1:5175,"
    "http://localhost:5176,"
    "http://127.0.0.1:5176,"
    "http://localhost:8081,"
    "http://127.0.0.1:8081,"
    "http://localhost:3000,"
    "http://127.0.0.1:3000,"
    "http://localhost:5174,"
    "http://127.0.0.1:5174,"
    "http://tauri.localhost,"
    "tauri://localhost"
)
