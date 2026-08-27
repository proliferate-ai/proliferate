from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import pytest


PROTECTED_STORE_SYMBOLS = {
    "proliferate.db.store.organizations": (
        "acquire_membership_activation_lock",
        "bind_team_checkout_session",
        "cancel_team_checkout_intent",
        "complete_team_checkout_activation",
        "complete_team_checkout_activation_by_id",
        "create_pending_team_checkout_intent",
        "get_current_team_checkout_intent",
        "load_team_checkout_activation_for_update",
        "load_team_checkout_intent_for_update",
        "mark_team_checkout_activating",
        "mark_team_checkout_activating_by_id",
        "mark_team_checkout_failed",
        "mark_team_checkout_failed_by_id",
    ),
    "proliferate.db.store.organization_invitations": (
        "accept_pending_invitation_for_organization_email",
        "create_or_rotate_organization_invitation",
        "mark_invitation_delivery",
    ),
    # Agent-auth credential locks (SRV-STORE-8): the package __init__
    # re-exports every protected symbol, so the union is locked under the
    # package module as well as under each defining submodule.
    "proliferate.db.store.agent_gateway": (
        "clear_auth_selections",
        "create_agent_api_key",
        "create_agent_provider_config",
        "get_agent_api_key_decrypted",
        "get_agent_provider_config_decrypted",
        "put_auth_selections",
        "revoke_agent_api_key",
        "touch_auth_selection_revisions",
    ),
    "proliferate.db.store.agent_gateway.api_keys": (
        "create_agent_api_key",
        "create_agent_provider_config",
        "get_agent_api_key_decrypted",
        "get_agent_provider_config_decrypted",
        "revoke_agent_api_key",
    ),
    "proliferate.db.store.agent_gateway.selections": (
        "clear_auth_selections",
        "put_auth_selections",
        "touch_auth_selection_revisions",
    ),
}

STORE_RULE_IDS = {
    "proliferate.db.store.organizations": "SRV-STORE-5",
    "proliferate.db.store.organization_invitations": "SRV-STORE-5",
    "proliferate.db.store.agent_gateway": "SRV-STORE-8",
    "proliferate.db.store.agent_gateway.api_keys": "SRV-STORE-8",
    "proliferate.db.store.agent_gateway.selections": "SRV-STORE-8",
}

STORE_OWNER_HINTS = {
    "proliferate.db.store.organizations": "proliferate.server.organizations.service",
    "proliferate.db.store.organization_invitations": (
        "proliferate.server.organizations.service"
    ),
    "proliferate.db.store.agent_gateway": "proliferate.server.agent_auth.service",
    "proliferate.db.store.agent_gateway.api_keys": (
        "proliferate.server.agent_auth.service"
    ),
    "proliferate.db.store.agent_gateway.selections": (
        "proliferate.server.agent_auth.service"
    ),
}


def _load_checker_module():
    script_path = Path(__file__).resolve().parents[3] / "scripts" / "check_server_boundaries.py"
    spec = importlib.util.spec_from_file_location("check_server_boundaries", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _check_named_source(
    tmp_path: Path,
    relative_path: str,
    source: str,
):
    module = _load_checker_module()
    path = tmp_path / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source)
    return module, module.check_named_cross_domain_writes([path], tmp_path)


def test_named_write_registry_matches_frozen_contract() -> None:
    module = _load_checker_module()

    actual = {
        store_module: tuple(sorted(boundary.protected_symbols))
        for store_module, boundary in module.NAMED_STORE_BOUNDARIES.items()
    }
    expected = {
        store_module: tuple(sorted(symbols))
        for store_module, symbols in PROTECTED_STORE_SYMBOLS.items()
    }

    assert actual == expected
    assert {store_module: len(symbols) for store_module, symbols in actual.items()} == {
        "proliferate.db.store.organizations": 13,
        "proliferate.db.store.organization_invitations": 3,
        "proliferate.db.store.agent_gateway": 8,
        "proliferate.db.store.agent_gateway.api_keys": 5,
        "proliferate.db.store.agent_gateway.selections": 3,
    }
    assert sum(len(symbols) for symbols in actual.values()) == 32
    organization_persistence = frozenset(
        {
            "server/proliferate/db/store/organization_invitations.py",
            "server/proliferate/db/store/organizations.py",
        }
    )
    for store_module in (
        "proliferate.db.store.organizations",
        "proliferate.db.store.organization_invitations",
    ):
        boundary = module.NAMED_STORE_BOUNDARIES[store_module]
        assert boundary.product_owner_prefixes == (
            (
                "server",
                "proliferate",
                "server",
                "organizations",
            ),
        )
        assert boundary.persistence_owner_paths == organization_persistence
        assert boundary.owner_service_hint == "proliferate.server.organizations.service"
        assert boundary.rule_id == "SRV-STORE-5"
        assert boundary.detail_noun == "store mutation"
    agent_gateway_persistence = frozenset(
        {
            "server/proliferate/db/store/agent_gateway/__init__.py",
            "server/proliferate/db/store/agent_gateway/api_keys.py",
            "server/proliferate/db/store/agent_gateway/selections.py",
        }
    )
    for store_module in (
        "proliferate.db.store.agent_gateway",
        "proliferate.db.store.agent_gateway.api_keys",
        "proliferate.db.store.agent_gateway.selections",
    ):
        boundary = module.NAMED_STORE_BOUNDARIES[store_module]
        assert boundary.product_owner_prefixes == (
            ("server", "proliferate", "server", "agent_auth"),
            ("server", "proliferate", "server", "ai_gateway"),
        )
        assert boundary.persistence_owner_paths == agent_gateway_persistence
        assert boundary.owner_service_hint == "proliferate.server.agent_auth.service"
        assert boundary.rule_id == "SRV-STORE-8"
        assert boundary.detail_noun == "credential-bearing store symbol"


@pytest.mark.parametrize(
    ("store_module", "symbol"),
    [
        (store_module, symbol)
        for store_module, symbols in PROTECTED_STORE_SYMBOLS.items()
        for symbol in symbols
    ],
)
@pytest.mark.parametrize("alias", ["", " as protected_alias"])
def test_foreign_direct_import_rejects_every_protected_symbol(
    tmp_path: Path,
    store_module: str,
    symbol: str,
    alias: str,
) -> None:
    local_name = "protected_alias" if alias else symbol
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foreign.py",
        f"from {store_module} import {symbol}{alias}\n{local_name}()\n",
    )

    assert len(violations) == 1
    violation = violations[0]
    assert violation.rule_id == STORE_RULE_IDS[store_module]
    assert violation.lineno == 1
    assert f"{store_module}.{symbol}" in violation.detail
    assert STORE_OWNER_HINTS[store_module] in violation.detail
    assert violation.relative_path(tmp_path) == ("server/proliferate/server/billing/foreign.py")


@pytest.mark.parametrize(
    "source",
    [
        "from proliferate.db.store import organizations as organization_store\n"
        "write = organization_store.bind_team_checkout_session\n",
        "import proliferate.db.store.organizations as organization_store\n"
        "write = organization_store.bind_team_checkout_session\n",
        "from proliferate.db.store import organizations as organization_store\n"
        "organization_store.bind_team_checkout_session()\n",
        "from proliferate.db.store import organizations as organization_store\n"
        'write = getattr(organization_store, "bind_team_checkout_session")\n',
        "import proliferate.db.store.organizations as organization_store\n"
        'write = getattr(organization_store, "bind_team_checkout_session")\n',
    ],
)
def test_module_alias_access_is_rejected(tmp_path: Path, source: str) -> None:
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foreign.py",
        source,
    )

    assert len(violations) == 1
    assert violations[0].rule_id == "SRV-STORE-5"
    assert "proliferate.db.store.organizations.bind_team_checkout_session" in violations[0].detail


@pytest.mark.parametrize("literal_getattr", [False, True])
def test_qualified_reference_is_rejected(tmp_path: Path, literal_getattr: bool) -> None:
    store_module = "proliferate.db.store.organization_invitations"
    symbol = "mark_invitation_delivery"
    reference = (
        f'getattr({store_module}, "{symbol}")' if literal_getattr else f"{store_module}.{symbol}"
    )
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foreign.py",
        f"import {store_module}\nwrite = {reference}\nwrite()\n",
    )

    assert len(violations) == 1
    assert violations[0].lineno == 2
    assert f"{store_module}.{symbol}" in violations[0].detail


def test_star_import_rejects_each_protected_store_symbol(tmp_path: Path) -> None:
    store_module = "proliferate.db.store.organization_invitations"
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foreign.py",
        f"from {store_module} import *\n",
    )

    assert len(violations) == 3
    assert {item.rule_id for item in violations} == {"SRV-STORE-5"}
    for symbol in PROTECTED_STORE_SYMBOLS[store_module]:
        assert any(f"{store_module}.{symbol}" in item.detail for item in violations)


@pytest.mark.parametrize(
    ("relative_path", "store_module", "symbol"),
    [
        (
            "server/proliferate/server/organizations/invitation_delivery.py",
            "proliferate.db.store.organization_invitations",
            "mark_invitation_delivery",
        ),
        (
            "server/proliferate/server/organizations/service.py",
            "proliferate.db.store.organizations",
            "bind_team_checkout_session",
        ),
    ],
)
def test_product_owner_may_access_its_protected_store(
    tmp_path: Path,
    relative_path: str,
    store_module: str,
    symbol: str,
) -> None:
    _, violations = _check_named_source(
        tmp_path,
        relative_path,
        f"from {store_module} import {symbol}\n",
    )

    assert violations == []


@pytest.mark.parametrize(
    ("relative_path", "store_module", "symbol"),
    [
        (
            "server/proliferate/db/store/organizations.py",
            "proliferate.db.store.organization_invitations",
            "mark_invitation_delivery",
        ),
        (
            "server/proliferate/db/store/organization_invitations.py",
            "proliferate.db.store.organizations",
            "mark_team_checkout_failed_by_id",
        ),
    ],
)
def test_exact_persistence_owner_may_access_protected_store(
    tmp_path: Path,
    relative_path: str,
    store_module: str,
    symbol: str,
) -> None:
    _, violations = _check_named_source(
        tmp_path,
        relative_path,
        f"from {store_module} import {symbol}\n",
    )

    assert violations == []


def test_credential_lock_rejects_out_of_owner_import(tmp_path: Path) -> None:
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foo.py",
        "from proliferate.db.store.agent_gateway.api_keys import get_agent_api_key_decrypted\n"
        "get_agent_api_key_decrypted()\n",
    )

    assert len(violations) == 1
    violation = violations[0]
    assert violation.rule_id == "SRV-STORE-8"
    assert (
        "proliferate.db.store.agent_gateway.api_keys.get_agent_api_key_decrypted"
        in violation.detail
    )
    assert "credential-bearing store symbol" in violation.detail
    assert "proliferate.server.agent_auth.service" in violation.detail


@pytest.mark.parametrize(
    ("relative_path", "store_module", "symbol"),
    [
        (
            "server/proliferate/server/agent_auth/service.py",
            "proliferate.db.store.agent_gateway.api_keys",
            "get_agent_api_key_decrypted",
        ),
        (
            "server/proliferate/server/agent_auth/service.py",
            "proliferate.db.store.agent_gateway.selections",
            "put_auth_selections",
        ),
        (
            "server/proliferate/server/ai_gateway/enrollment.py",
            "proliferate.db.store.agent_gateway.api_keys",
            "get_agent_api_key_decrypted",
        ),
        (
            "server/proliferate/server/ai_gateway/enrollment.py",
            "proliferate.db.store.agent_gateway",
            "create_agent_api_key",
        ),
    ],
)
def test_both_owning_systems_may_access_credential_stores(
    tmp_path: Path,
    relative_path: str,
    store_module: str,
    symbol: str,
) -> None:
    _, violations = _check_named_source(
        tmp_path,
        relative_path,
        f"from {store_module} import {symbol}\n{symbol}()\n",
    )

    assert violations == []


def test_store_package_init_reexport_is_legal(tmp_path: Path) -> None:
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/db/store/agent_gateway/__init__.py",
        "from proliferate.db.store.agent_gateway.api_keys import (\n"
        "    create_agent_api_key,\n"
        "    get_agent_api_key_decrypted,\n"
        ")\n"
        "from proliferate.db.store.agent_gateway.selections import put_auth_selections\n",
    )

    assert violations == []


@pytest.mark.parametrize(
    "source",
    [
        "from proliferate.db.store import agent_gateway\n"
        'write = getattr(agent_gateway, "get_agent_api_key_decrypted")\n',
        "import proliferate.db.store.agent_gateway.selections\n"
        'getattr(proliferate.db.store.agent_gateway.selections, "put_auth_selections")\n',
    ],
)
def test_credential_lock_rejects_getattr_string_access(
    tmp_path: Path,
    source: str,
) -> None:
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foo.py",
        source,
    )

    assert len(violations) == 1
    assert violations[0].rule_id == "SRV-STORE-8"


@pytest.mark.parametrize(
    "relative_path",
    [
        "server/proliferate/db/store/unrelated.py",
        "server/proliferate/server/organizations_external/service.py",
    ],
)
def test_owner_lookalikes_may_not_access_protected_store(
    tmp_path: Path,
    relative_path: str,
) -> None:
    _, violations = _check_named_source(
        tmp_path,
        relative_path,
        "from proliferate.db.store.organizations import bind_team_checkout_session\n",
    )

    assert len(violations) == 1
    assert violations[0].rule_id == "SRV-STORE-5"


def test_same_named_owner_service_calls_are_legal(tmp_path: Path) -> None:
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foreign.py",
        "from proliferate.server.organizations import service as organization_service\n"
        "organization_service.bind_team_checkout_session()\n",
    )

    assert violations == []


@pytest.mark.parametrize(
    ("relative_path", "source"),
    [
        (
            "server/proliferate/auth/identity/sessions.py",
            "from proliferate.db.store import organization_invitations as invitations\n"
            "from proliferate.db.store import organizations as organizations\n"
            "invitations.has_live_pending_invitation_for_organization_email()\n"
            "organizations.get_active_membership()\n",
        ),
        (
            "server/proliferate/server/billing/reconciler.py",
            "from proliferate.db.store import cloud_sandboxes as sandboxes\n"
            "sandboxes.load_cloud_sandbox_by_id()\n",
        ),
        (
            "server/proliferate/server/billing/team_checkout/activation.py",
            "from proliferate.db.store import billing_subscriptions as subscriptions\n"
            "from proliferate.db.store import organizations as organizations\n"
            "from proliferate.db.store import users as users\n"
            "users.get_user_by_id()\n"
            "subscriptions.upsert_billing_subscription()\n"
            'symbol_name = "bind_team_checkout_session"\n'
            "getattr(organizations, symbol_name)\n"
            'getattr(organizations, "get_active_membership")\n'
            "unrelated.bind_team_checkout_session()\n",
        ),
    ],
)
def test_named_legal_reads_and_unrelated_same_named_method_are_legal(
    tmp_path: Path,
    relative_path: str,
    source: str,
) -> None:
    _, violations = _check_named_source(tmp_path, relative_path, source)

    assert violations == []


def test_named_rule_scans_root_production_and_skips_migrations(
    tmp_path: Path,
) -> None:
    module = _load_checker_module()
    root_source = tmp_path / "server" / "proliferate" / "root_concern.py"
    migration_source = tmp_path / "server" / "proliferate" / "db" / "migrations" / "revision.py"
    alembic_source = tmp_path / "server" / "proliferate" / "alembic" / "versions" / "revision.py"
    for path in (root_source, migration_source, alembic_source):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "from proliferate.db.store.organizations import cancel_team_checkout_intent\n"
        )

    targets = module.iter_named_write_target_files(tmp_path)
    violations = module.check_named_cross_domain_writes(targets, tmp_path)

    assert targets == [root_source]
    assert len(violations) == 1
    assert violations[0].path == root_source
