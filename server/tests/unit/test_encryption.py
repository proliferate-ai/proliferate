from __future__ import annotations

import ast
import base64
import hashlib
import importlib
import inspect
from collections.abc import Callable
from types import ModuleType

import pytest
from cryptography.fernet import Fernet, InvalidToken

from proliferate.lib.infra.encryption.fernet import decrypt_text, encrypt_text
from proliferate.lib.infra.encryption.json import decrypt_json, encrypt_json

_LEGACY_SECRET = "legacy-test-secret"
_LEGACY_TEXT_CIPHERTEXT = (
    "gAAAAABqcuweZbz9NEFtZQdXfong1R40LCuDBJVEdKHFLXM4xyPamrq-"
    "JLDQMKwIA-AoxRd2oUoFcMLzVCUjuK3mzexaEb6w-6z9O7PTO6J5_McMC96Vsgo="
)
_LEGACY_JSON_CIPHERTEXT = (
    "gAAAAABqcuwexOoxkQ8AtnY1VH4KD2_jA_mOZ_9kBcp7RpsleIkr07Y6GZ6ht7yEbjWScfvUHs9"
    "Tzy1PAIExd19oudxDLzDvkBmhzlz7-cxku0huxGaZQ4g="
)
_LEGACY_LIST_CIPHERTEXT = (
    "gAAAAABqcuweb6MVrIuS1MMf0sOfGIvaaBNCmX9lC-flv3z28tCqJQsNtj3uakYdCbo0HNonL3Ex"
    "sIgaDsG3VqhCD9qenKKj_Q=="
)
_CONFIG_INJECTED_STORE_MODULES = (
    "proliferate.db.store.agent_gateway.api_keys",
    "proliferate.db.store.agent_gateway.enrollment_keys",
    "proliferate.db.store.agent_gateway.enrollments",
    "proliferate.db.store.github_app",
)
_CRYPTO_HELPER_NAMES = {"encrypt_json", "decrypt_json", "encrypt_text", "decrypt_text"}


def _independent_fernet(secret: str) -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


def _store_crypto_calls(module: ModuleType) -> list[ast.Call]:
    source = inspect.getsource(module)
    return [
        node
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in _CRYPTO_HELPER_NAMES
    ]


def _uses_configured_cloud_secret(call: ast.Call) -> bool:
    secret = next((keyword.value for keyword in call.keywords if keyword.arg == "secret"), None)
    return (
        isinstance(secret, ast.Attribute)
        and secret.attr == "cloud_secret_key"
        and isinstance(secret.value, ast.Name)
        and secret.value.id == "settings"
    )


@pytest.mark.parametrize(
    ("helper", "value"),
    [
        (encrypt_text, "value"),
        (decrypt_text, _LEGACY_TEXT_CIPHERTEXT),
        (encrypt_json, {"value": 1}),
        (decrypt_json, _LEGACY_JSON_CIPHERTEXT),
    ],
)
def test_public_helpers_require_keyword_only_secret(
    helper: Callable[..., object],
    value: object,
) -> None:
    parameter = inspect.signature(helper).parameters["secret"]
    assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
    assert parameter.default is inspect.Parameter.empty

    with pytest.raises(TypeError):
        helper(value)


@pytest.mark.parametrize("module_name", _CONFIG_INJECTED_STORE_MODULES)
def test_config_injected_store_crypto_calls_reject_a_wrong_secret(
    monkeypatch: pytest.MonkeyPatch,
    module_name: str,
) -> None:
    module = importlib.import_module(module_name)
    configured_secret = f"{module_name}-configured-secret"
    monkeypatch.setattr(module.settings, "cloud_secret_key", configured_secret)

    calls = _store_crypto_calls(module)
    assert calls
    assert all(_uses_configured_cloud_secret(call) for call in calls)

    ciphertext = encrypt_text(
        f"{module_name} encrypted payload",
        secret=module.settings.cloud_secret_key,
    )
    with pytest.raises(InvalidToken):
        decrypt_text(ciphertext, secret=f"{module_name}-wrong-secret")


def test_pre_inversion_text_ciphertext_remains_decryptable() -> None:
    assert decrypt_text(_LEGACY_TEXT_CIPHERTEXT, secret=_LEGACY_SECRET) == "legacy payload 🧪"


def test_pre_inversion_json_ciphertext_remains_decryptable() -> None:
    assert decrypt_json(_LEGACY_JSON_CIPHERTEXT, secret=_LEGACY_SECRET) == {
        "a": 1,
        "nested": {"z": True},
    }


def test_new_text_ciphertext_uses_frozen_derivation() -> None:
    ciphertext = encrypt_text("new payload", secret="new-test-secret")

    assert (
        _independent_fernet("new-test-secret").decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        == "new payload"
    )


def test_new_json_ciphertext_preserves_compact_sorted_plaintext() -> None:
    ciphertext = encrypt_json(
        {"z": "last", "a": {"unicode": "雪"}},
        secret="json-test-secret",
    )

    plaintext = _independent_fernet("json-test-secret").decrypt(ciphertext.encode("utf-8"))
    assert plaintext.decode("utf-8") == '{"a":{"unicode":"\\u96ea"},"z":"last"}'


@pytest.mark.parametrize("secret", ["", "unicode-secret-雪"])
def test_text_and_json_round_trip_with_existing_secret_semantics(secret: str) -> None:
    assert decrypt_text(encrypt_text("value 🧪", secret=secret), secret=secret) == "value 🧪"
    payload = {"nested": [1, True, None], "value": "雪"}
    assert decrypt_json(encrypt_json(payload, secret=secret), secret=secret) == payload


@pytest.mark.parametrize("ciphertext", [_LEGACY_TEXT_CIPHERTEXT, "not-a-fernet-token"])
def test_wrong_key_and_malformed_ciphertext_keep_invalid_token_failure(ciphertext: str) -> None:
    with pytest.raises(InvalidToken):
        decrypt_text(ciphertext, secret="different-secret")


def test_valid_non_object_json_keeps_exact_value_error() -> None:
    with pytest.raises(ValueError, match="^encrypted payload did not contain an object$"):
        decrypt_json(_LEGACY_LIST_CIPHERTEXT, secret=_LEGACY_SECRET)
