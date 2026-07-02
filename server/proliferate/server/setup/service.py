"""First-run claim orchestration: boot-time token mint and the claim itself.

The lifecycle, all single-org mode only:

1. At API boot, while the user table is empty, ``ensure_first_run_setup_token``
   mints a setup token. The SHA-256 hash is persisted in the database (the
   verifier); the plaintext is written only to a local file
   (``settings.setup_token_file``) so deploy tooling can print it and nothing
   can read it remotely. Restarts reuse the token as long as the file still
   matches the stored hash; if the plaintext is lost the token rotates so the
   operator always has a recoverable token.
2. ``claim_first_run`` verifies the token, takes a transaction-scoped advisory
   lock, re-asserts the user table is empty, creates the owner account through
   the existing auth primitives, and creates THE instance organization through
   the single-org claim path.
3. Once any user exists, setup is closed permanently: the routes 404 and the
   boot path deletes the token row and file.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.db.store import instance_setup as instance_setup_store
from proliferate.server.organizations.membership_policy import claim_instance_organization
from proliferate.server.setup.accounts import (
    AccountValidationError,
    create_password_account,
    normalize_account_email,
    validate_account_password,
)
from proliferate.server.setup.domain.tokens import (
    hash_setup_token,
    mint_setup_token,
    setup_token_matches,
)
from proliferate.server.setup.errors import (
    InvalidSetupTokenError,
    SetupClosedError,
    SetupValidationError,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FirstRunClaim:
    email: str
    organization_name: str


async def is_setup_open(db: AsyncSession) -> bool:
    """Setup is open exactly while the user table is empty."""
    return await instance_setup_store.count_users(db) == 0


async def ensure_first_run_setup_token() -> None:
    """Mint or reuse the first-run setup token at API boot.

    No-op outside single-org mode. Opens its own short-lived session because
    it runs from the application lifespan, not a request.
    """
    if not settings.single_org_mode:
        return
    session = db_engine.async_session_factory()
    try:
        await _ensure_setup_token(session)
        await session.commit()
    except BaseException:
        await db_engine.rollback_session(session)
        raise
    finally:
        await db_engine.close_session(session)


async def _ensure_setup_token(db: AsyncSession) -> None:
    await instance_setup_store.acquire_first_run_claim_lock(db)

    if await instance_setup_store.count_users(db) > 0:
        # Claimed instance: make sure no setup artifacts linger.
        await instance_setup_store.delete_setup_token(db)
        _remove_token_file()
        return

    token_file = _token_file_path()
    stored_hash = await instance_setup_store.get_setup_token_hash(db)
    file_token = _read_token_file(token_file)
    if stored_hash is not None and file_token and setup_token_matches(file_token, stored_hash):
        # Restart with an intact token: keep it, do not rotate.
        logger.info(
            "First-run setup pending. Setup token unchanged; plaintext at %s.",
            token_file,
        )
        return

    token = mint_setup_token()
    await instance_setup_store.save_setup_token_hash(db, hash_setup_token(token))
    if _write_token_file(token_file, token):
        logger.info("First-run setup pending. Setup token written to %s.", token_file)
    else:
        logger.warning(
            "Could not write the setup token file at %s; the token below is "
            "only in this log and will rotate on the next restart.",
            token_file,
        )
    # Local log line: the grep-able fallback for dev setups without the token
    # file volume. Server logs are not remotely readable.
    logger.info("First-run setup token: %s", token)
    logger.info("Claim this instance at https://<your-host>/setup")


async def claim_first_run(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    setup_token: str,
) -> FirstRunClaim:
    """Create the owner account and THE instance organization, exactly once."""
    if not await is_setup_open(db):
        raise SetupClosedError()

    stored_hash = await instance_setup_store.get_setup_token_hash(db)
    if (
        stored_hash is None
        or not setup_token.strip()
        or not setup_token_matches(setup_token, stored_hash)
    ):
        raise InvalidSetupTokenError()

    try:
        normalized_email = normalize_account_email(email)
        validate_account_password(password)
    except AccountValidationError as exc:
        raise SetupValidationError(exc.reason) from exc

    # Serialize concurrent claims; the lock is held until this transaction
    # commits, so the user-count check below is race-free.
    await instance_setup_store.acquire_first_run_claim_lock(db)
    if await instance_setup_store.count_users(db) > 0:
        raise SetupClosedError()

    user = await create_password_account(db, email=normalized_email, password=password)
    organization = await claim_instance_organization(db, user)
    await instance_setup_store.delete_setup_token(db)
    await db_engine.run_after_commit(db, _remove_token_file_after_commit)

    logger.info(
        "Instance claimed: owner %s, organization %r.",
        normalized_email,
        organization.name,
    )
    return FirstRunClaim(email=normalized_email, organization_name=organization.name)


def _token_file_path() -> Path:
    return Path(settings.setup_token_file)


def _read_token_file(token_file: Path) -> str | None:
    try:
        return token_file.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def _write_token_file(token_file: Path, token: str) -> bool:
    try:
        token_file.parent.mkdir(parents=True, exist_ok=True)
        token_file.write_text(f"{token}\n", encoding="utf-8")
        token_file.chmod(0o600)
    except OSError:
        return False
    return True


def _remove_token_file() -> None:
    try:
        _token_file_path().unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not remove the setup token file at %s.", _token_file_path())


async def _remove_token_file_after_commit() -> None:
    _remove_token_file()
