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
import os
import secrets
import stat
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import instance_setup as instance_setup_store
from proliferate.server.organizations.domain.profile import (
    clean_organization_name,
    organization_name_issue,
)
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

_TOKEN_FILE_MODE = 0o600
_TOKEN_FILE_MAX_BYTES = 256


@dataclass(frozen=True)
class FirstRunClaim:
    email: str
    organization_name: str


async def is_setup_open(db: AsyncSession) -> bool:
    """Setup is open exactly while the user table is empty."""
    return await instance_setup_store.count_users(db) == 0


async def ensure_setup_token(db: AsyncSession) -> None:
    """Session-scoped body of the boot-time token mint (see lifecycle.py)."""
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
    # A persistence error must escape. The lifecycle wrapper rolls this
    # transaction back and aborts startup, so a verifier can never be committed
    # without its matching plaintext file.
    _write_token_file(token_file, token)
    logger.info("First-run setup pending. Setup token written to %s.", token_file)
    logger.info("Claim this instance at https://<your-host>/setup")


async def claim_first_run(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    setup_token: str,
    organization_name: str = "",
    schedule_token_file_cleanup: Callable[[AsyncSession], Awaitable[None]] | None = None,
) -> FirstRunClaim:
    """Create the owner account and THE instance organization, exactly once.

    ``organization_name`` is optional: blank falls back to the name derived
    from the claimer's email domain.
    """
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

    requested_organization_name = clean_organization_name(organization_name)
    if requested_organization_name:
        issue = organization_name_issue(requested_organization_name)
        if issue is not None:
            raise SetupValidationError(issue.message)

    # Serialize concurrent claims; the lock is held until this transaction
    # commits, so the user-count check below is race-free.
    await instance_setup_store.acquire_first_run_claim_lock(db)
    if await instance_setup_store.count_users(db) > 0:
        raise SetupClosedError()

    user = await create_password_account(db, email=normalized_email, password=password)
    organization = await claim_instance_organization(
        db,
        user,
        name=requested_organization_name or None,
    )
    await instance_setup_store.delete_setup_token(db)
    if schedule_token_file_cleanup is not None:
        # Injected by the transport (see lifecycle.py); when omitted the file
        # still gets cleaned up by the next boot's ensure_setup_token pass.
        await schedule_token_file_cleanup(db)

    logger.info(
        "Instance claimed: owner %s, organization %r.",
        normalized_email,
        organization.name,
    )
    return FirstRunClaim(email=normalized_email, organization_name=organization.name)


def _token_file_path() -> Path:
    return Path(settings.setup_token_file)


def _read_token_file(token_file: Path) -> str | None:
    parent_fd: int | None = None
    token_fd: int | None = None
    try:
        # macOS exposes /tmp as a trusted symlink to /private/tmp. Resolve the
        # parent once, then apply O_NOFOLLOW to the directory we actually open
        # and to the token's final path component. This permits that standard
        # filesystem layout without ever following a token-file symlink.
        parent_path = token_file.parent.resolve(strict=True)
        parent_fd = os.open(
            parent_path,
            os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW,
        )
        token_fd = os.open(
            token_file.name,
            os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW,
            dir_fd=parent_fd,
        )
        metadata = os.fstat(token_fd)
        mode = stat.S_IMODE(metadata.st_mode)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.geteuid()
            or mode & 0o077
            or not mode & stat.S_IRUSR
            or metadata.st_nlink != 1
        ):
            return None

        payload = os.read(token_fd, _TOKEN_FILE_MAX_BYTES + 1)
        if len(payload) > _TOKEN_FILE_MAX_BYTES:
            return None
        return payload.decode("utf-8").strip() or None
    except (OSError, UnicodeError):
        return None
    finally:
        if token_fd is not None:
            os.close(token_fd)
        if parent_fd is not None:
            os.close(parent_fd)


def _write_token_file(token_file: Path, token: str) -> None:
    parent_fd: int | None = None
    token_fd: int | None = None
    temporary_name: str | None = None
    try:
        token_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        parent_path = token_file.parent.resolve(strict=True)
        parent_fd = os.open(
            parent_path,
            os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW,
        )
        temporary_name = f".{token_file.name}.{secrets.token_hex(16)}.tmp"
        token_fd = os.open(
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW,
            _TOKEN_FILE_MODE,
            dir_fd=parent_fd,
        )
        os.fchmod(token_fd, _TOKEN_FILE_MODE)

        remaining = memoryview(f"{token}\n".encode())
        while remaining:
            written = os.write(token_fd, remaining)
            if written == 0:
                raise OSError("setup token file write made no progress")
            remaining = remaining[written:]
        os.fsync(token_fd)
        os.close(token_fd)
        token_fd = None

        # rename(2) replaces a destination symlink rather than following it.
        # Keeping both names relative to the no-follow directory descriptor
        # also prevents a last-component parent symlink from redirecting us.
        os.replace(
            temporary_name,
            token_file.name,
            src_dir_fd=parent_fd,
            dst_dir_fd=parent_fd,
        )
        temporary_name = None
        os.fsync(parent_fd)
    except (OSError, ValueError) as exc:
        raise RuntimeError(
            "Could not securely persist the first-run setup token at "
            f"{token_file}. Verify that the parent directory is writable by "
            "the API process, resolves to a directory, and supports atomic file "
            "replacement. Startup was stopped so the token verifier cannot "
            "be committed."
        ) from exc
    finally:
        if token_fd is not None:
            with suppress(OSError):
                os.close(token_fd)
        if temporary_name is not None and parent_fd is not None:
            with suppress(OSError):
                os.unlink(temporary_name, dir_fd=parent_fd)
        if parent_fd is not None:
            with suppress(OSError):
                os.close(parent_fd)


def _remove_token_file() -> None:
    try:
        _token_file_path().unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not remove the setup token file at %s.", _token_file_path())


async def remove_token_file_after_commit() -> None:
    _remove_token_file()
