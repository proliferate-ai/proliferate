# Sandbox GitHub Auth

Status: target contract for managed cloud sandbox GitHub access.

This primitive owns GitHub repository authority for Proliferate Cloud managed
sandboxes. Product GitHub OAuth identifies the Proliferate user. GitHub App
authorization owns cloud repository access. The sandbox receives only a
short-lived GitHub user access token lease, materialized by the Worker.

## Invariants

- Product login and Git repository authority are separate.
- GitHub OAuth is product identity: who is this Proliferate user?
- GitHub App authorization is repository authority: which repos may Cloud use?
- GitHub-backed Cloud repo setup requires repo authority. A Cloud repo should
  not be presented as usable unless the user has GitHub App authorization and
  the repository is covered by an installation.
- Cloud stores durable GitHub App authorization and refresh authority.
- The sandbox never receives a GitHub App private key, OAuth client secret,
  GitHub App refresh token, or long-lived OAuth access token.
- The Worker materializes one provider-level GitHub credential lease per
  sandbox, not per workspace.
- AnyHarness and user terminals run normal Git. They do not call Cloud to
  refresh Git credentials.
- The Git credential helper is dumb: it reads the current token file and prints
  Git credential protocol output. It never calls Cloud or GitHub.
- Repo authorization is enforced before Cloud materializes or exposes a repo.
  The token file is user/provider scoped.
- Tokens must be redacted from structured logs, exception strings, request
  tracing, worker logs, sandbox command logs, and test output. The worker
  refresh response necessarily contains `accessToken`, so every call site must
  treat that response as secret-bearing.
- Product UI, Desktop, Web, and Cloud SDK clients never receive raw GitHub
  access tokens, GitHub App refresh tokens, GitHub App private keys, or sandbox
  token file contents.

## Product Gate

The canonical product flow is:

```text
1. User signs into Proliferate.
2. User connects GitHub identity for product account ownership.
3. User authorizes the Proliferate GitHub App.
4. User installs/grants the GitHub App for the target repo or org.
5. User adds a GitHub Cloud repo in Proliferate.
6. Proliferate ensures the managed sandbox.
7. Worker materializes the GitHub credential lease.
8. Repo materializes using normal Git.
9. Client connects through the gateway to AnyHarness.
```

If GitHub App authorization or repo coverage is missing, product surfaces must
fail before repo materialization:

```text
Add Cloud repo:
  missing user app auth       -> "Connect GitHub App"
  expired user app auth       -> "Reconnect GitHub App"
  missing installation        -> "Install Proliferate GitHub App"
  repo not installation-scoped -> "Grant repository access"

Existing Cloud repo:
  unavailable until authority is restored
```

## Token Model

GitHub App user access tokens are the only sandbox Git credential source.
Product GitHub OAuth tokens are for product identity and must not be materialized
into managed sandboxes.

```text
Target token:
  kind: github_app_user_to_server
  source: GitHub App user authorization refresh flow
  prefix: usually ghu_
  power: clone/fetch/push as user, bounded by user permissions AND app permissions
  lifetime: short-lived, refreshed by Cloud
```

The stable Worker contract is:

```typescript
type WorkerGitHubCredentialLease = {
  provider: "github";
  tokenKind: "github_app_user_to_server";
  accessToken: string;
  actorLogin: string;
  actorId: string;
  issuedAt: string;
  expiresAt: string;
  refreshAfter: string;
  leaseId: string;
};
```

PRs that consume sandbox Git credentials depend on this contract. They must not
read product OAuth grants or GitHub App authorization rows directly.

## PR Boundaries

The implementation is split into three PRs.

```text
PR 1: GitHub App / Git credential substrate
  Owns:
    GitHub App authorization storage
    repo authority helper
    worker credential refresh endpoint
    Worker credential lease materialization
    template credential helper

PR 2: Managed sandbox lifecycle + materialization + secrets UI
  Owns:
    managed sandbox ensure/reconcile flow
    repo materialization orchestration
    personal/org secret materialization
    a narrow sandbox Git-credentials readiness seam
    switching repo clone/fetch/push to plain Git through helper

PR 3: RepoConfig / RepoEnvironment cleanup
  Owns:
    replacing CloudRepoConfig with durable repo/environment model
    local/cloud/local+cloud repo configuration shape
    setup/run command model cleanup
```

PR 1 must not create AnyHarness workspaces, run setup scripts, own repo
materialization, own secrets materialization, store repo setup/run config, or
pass raw GitHub tokens to Desktop/Web.

PR 2 may be developed in parallel, but it must express the dependency as a
narrow readiness seam:

```python
async def ensure_sandbox_git_credentials_ready(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> None:
    await require_github_cloud_repo_authority(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
```

Before PR 1 is available, that seam fails closed with
`github_app_authorization_required` in product/manual testing. It must not fall
back to product OAuth tokens.

## File Tree

```text
server/proliferate/
  config.py
  integrations/github/
    app_jwt.py                  # GitHub App JWT from private key
    app_user_tokens.py          # user authorization exchange + refresh
    app_installations.py        # installation/repo coverage reads
  db/models/cloud/github_app.py
  db/migrations/versions/<rev>_github_app_authorization.py  # schema-only revision for new tables
  db/store/github_app_authorizations.py
  db/store/github_app_installations.py
  server/cloud/github_app/
    api.py
    models.py
    repo_authority.py
    service.py
    webhooks.py
  server/cloud/worker/
    api.py
    github_credentials.py
    models.py

anyharness/crates/proliferate-worker/src/
  lifecycle/
    github_credentials.rs
    heartbeat.rs
    mod.rs
  cloud_client/
    github_credentials.rs
    mod.rs
  materialization/
    github_credentials.rs
    mod.rs

install/
  proliferate-git-credential-helper

scripts/
  build-template.mjs
  smoke-cloud-template.mjs
```

File responsibilities:

```text
server/proliferate/integrations/github/app_user_tokens.py
  Raw GitHub HTTP for exchanging authorization codes, refreshing user tokens,
  and loading the authenticated GitHub user. No DB access.

server/proliferate/integrations/github/app_installations.py
  Raw GitHub HTTP for listing app installations and repositories covered by an
  installation. No product policy.

server/proliferate/db/store/github_app_authorizations.py
  CRUD for encrypted GitHub App user authorization rows.

server/proliferate/server/cloud/github_app/service.py
  Product-authenticated connect/callback orchestration.

server/proliferate/server/cloud/github_app/repo_authority.py
  Service-level repo authority gate consumed by repo setup/materialization.

server/proliferate/server/cloud/github_app/webhooks.py
  GitHub webhook signature validation plus best-effort installation and
  selected-repository cache updates.

server/proliferate/server/cloud/worker/github_credentials.py
  Worker-token-authenticated lease endpoint implementation.

anyharness/crates/proliferate-worker/src/lifecycle/github_credentials.rs
  Decides whether to refresh the local lease and calls Cloud.

anyharness/crates/proliferate-worker/src/cloud_client/github_credentials.rs
  Raw Worker -> Cloud HTTP for the refresh endpoint.

anyharness/crates/proliferate-worker/src/materialization/github_credentials.rs
  Atomic token/meta writes and idempotent Git config.

install/proliferate-git-credential-helper
  Template-baked helper executed by Git credential protocol.
```

## GitHub App Configuration

Use separate GitHub Apps per environment.

```text
Production app:
  owner: proliferate-ai
  name: Proliferate Cloud

Development app:
  owner: proliferate-ai
  name: Proliferate Cloud Dev or Proliferate Cloud Pablo
```

Required GitHub App settings:

```text
Homepage URL:
  https://github.com/proliferate-ai/proliferate

Callback URL:
  <api-base-url>/auth/github-app/callback

Webhook URL:
  <api-base-url>/v1/cloud/webhooks/github-app

Expire user authorization tokens:
  enabled

Request user authorization during installation:
  production: disabled
  development: optional; enabled is acceptable for faster local testing
```

Production keeps installation and user authorization separate because the org
admin who installs the app is often not the human executor whose Git operations
should be attributed. Development apps may enable the combined install/OAuth
flow for convenience.

Repository permissions:

```text
Metadata: read
Contents: read/write
Pull requests: read/write
Workflows: read/write
```

Environment variables:

```bash
GITHUB_APP_ID=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_WEBHOOK_SECRET=...
GITHUB_APP_CALLBACK_BASE_URL=https://<public-api-base-url>

# Supported key forms. Inline wins when both are set.
GITHUB_APP_PRIVATE_KEY=<inline \\n-escaped private key>
GITHUB_APP_PRIVATE_KEY_PATH=/secure/path/proliferate-github-app.pem
```

Local dev profiles use the same public tunnel pattern as GitHub OAuth. The
printed ngrok API URL must be added to the dev app callback URL.

Private-key precedence:

```text
1. GITHUB_APP_PRIVATE_KEY, useful for local env files and secret managers that
   inject multiline values as escaped strings.
2. GITHUB_APP_PRIVATE_KEY_PATH, preferred for production when the runtime mounts
   secrets as files.
```

## Cloud Database

Add durable authorization state separate from product OAuth grants.

```python
class GitHubAppAuthorization(Base):
    __tablename__ = "github_app_authorization"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ready', 'expired', 'revoked', 'needs_reauth')",
            name="ck_github_app_authorization_status",
        ),
        Index(
            "ux_github_app_authorization_user_active",
            "user_id",
            unique=True,
            postgresql_where=text("status != 'revoked'"),
        ),
        Index("ix_github_app_authorization_github_user", "github_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    github_user_id: Mapped[str] = mapped_column(String(64), index=True)
    github_login: Mapped[str] = mapped_column(String(255))

    access_token_ciphertext: Mapped[str | None] = mapped_column(Text)
    refresh_token_ciphertext: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    status: Mapped[str] = mapped_column(String(32), index=True)  # ready, expired, revoked, needs_reauth
    permissions_json: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

Installations and repo coverage can be added separately:

```python
class GitHubAppInstallation(Base):
    __tablename__ = "github_app_installation"
    __table_args__ = (
        Index("ix_github_app_installation_account", "account_login", "account_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    github_installation_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    account_login: Mapped[str] = mapped_column(String(255), index=True)
    account_type: Mapped[str] = mapped_column(String(32))  # User, Organization
    repository_selection: Mapped[str] = mapped_column(String(32))  # all, selected
    permissions_json: Mapped[str | None] = mapped_column(Text)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
```

If selected-repo installations need local caching, use a child table:

```python
class GitHubAppInstallationRepository(Base):
    __tablename__ = "github_app_installation_repository"
    __table_args__ = (
        Index(
            "ux_github_app_installation_repository",
            "github_app_installation_id",
            "owner",
            "name",
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    github_app_installation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("github_app_installation.id", ondelete="CASCADE"),
        index=True,
    )
    owner: Mapped[str] = mapped_column(String(255), index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    github_repository_id: Mapped[str] = mapped_column(String(64), index=True)
    private: Mapped[bool] = mapped_column(default=True)
    default_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
```

Store helper shape:

```python
@dataclass(frozen=True)
class GitHubAppAuthorizationValue:
    id: UUID
    user_id: UUID
    github_user_id: str
    github_login: str
    access_token: str | None
    refresh_token: str | None
    token_expires_at: datetime | None
    refresh_token_expires_at: datetime | None
    status: str
    permissions: dict[str, object]


async def get_ready_github_app_authorization(
    db: AsyncSession,
    *,
    user_id: UUID,
    lock_row: bool = False,
) -> GitHubAppAuthorizationValue | None:
    ...


async def upsert_github_app_authorization(
    db: AsyncSession,
    *,
    user_id: UUID,
    authorization: GitHubAppUserAuthorization,
) -> GitHubAppAuthorizationValue:
    ...
```

## Product OAuth Flow

Product OAuth remains the account identity flow.

Existing owner:

```text
server/proliferate/auth/identity/*
server/proliferate/auth/desktop/*
```

Current GitHub OAuth scopes should be reduced after GitHub App repo authority is
live:

```text
target OAuth identity scopes:
  read:user
  user:email
```

## GitHub App Authorization And Installation Flow

GitHub App cloud access has two distinct product concepts:

```text
User authorization
  A Proliferate user authorizes the GitHub App and gives Cloud a refreshable
  GitHub App user token authority.

Installation
  A Proliferate organization admin installs/grants the GitHub App on a GitHub
  account and gives Cloud repo coverage.
```

These must remain separate in the backend API. User authorization is user
state. Installation is organization-admin state. Repo authority composes both
and never returns raw tokens to clients.

```text
GET /v1/cloud/github-app/user-authorization/start
  current_product_user
  creates signed state
  redirects to GitHub App user authorization URL

GET /auth/github-app/user-authorization/callback?code=...&state=...
  validates state
  exchanges code for GitHub App user access token + refresh token
  stores encrypted authorization
  redirects back to product settings

GET /v1/cloud/github-app/user-authorization
  current_product_user
  returns whether this user has ready GitHub App authorization

GET /v1/cloud/organizations/{organization_id}/github-app/installation/start
  current_path_org_admin
  creates signed install state
  returns the GitHub App installation URL

GET /auth/github-app/installation/callback?installation_id=...&setup_action=...&state=...
  validates install state
  fetches/verifies the installation from GitHub
  stores installation facts linked to the Proliferate organization
  redirects back to product settings

GET /v1/cloud/organizations/{organization_id}/github-app/installation
  current_path_org_member
  returns whether the org has an active linked installation

GET /v1/cloud/github-app/repos/{owner}/{repo}/authority
  current_product_user
  returns product-actionable repo authority status
  never returns GitHub access tokens

GET /v1/cloud/github-app/accessible-repos
  current_product_user
  lists repos visible to the GitHub App user token
```

Server files:

```text
server/proliferate/server/cloud/github_app/api.py
server/proliferate/server/cloud/github_app/models.py
server/proliferate/server/cloud/github_app/service.py
server/proliferate/server/cloud/github_app/repo_authority.py
server/proliferate/integrations/github/app_user_tokens.py
server/proliferate/integrations/github/app_installations.py
```

Status behavior:

```text
GET /v1/cloud/github-app/user-authorization
  connected=false, status=null, action="authorize"
  connected=true, status="ready", action=null
  connected=true, status="needs_reauth", action="reauthorize"

GET /v1/cloud/organizations/{organization_id}/github-app/installation
  installed=false, action="install"
  installed=true, action="manage"

GET /v1/cloud/github-app/repos/{owner}/{repo}/authority
  authorized=false, status="missing_user_authorization", action="authorize_user"
  authorized=false, status="expired_user_authorization", action="reauthorize_user"
  authorized=false, status="missing_installation", action="install_app"
  authorized=false, status="repo_not_covered", action="grant_repo_access"
  authorized=false, status="missing_user_repo_access", action="authorize_user"
  authorized=true, status="ready", action=null
```

## Product UI

The visible product entrypoint for user authorization belongs in Account
settings.

```text
Desktop:
  apps/desktop/src/components/settings/panes/AccountPane.tsx

Web:
  equivalent account/settings page when web settings are enabled
```

Account UI:

```text
Section: Connected services

GitHub:
  existing product identity status
  copy: "Used to sign in to Proliferate."

Proliferate GitHub App:
  connected status from GET /v1/cloud/github-app/user-authorization
  primary action:
    Connect GitHub App
    Reconnect GitHub App
  copy: "Required for Proliferate Cloud repositories."

Organization Cloud GitHub App:
  install status from GET /v1/cloud/organizations/{organization_id}/github-app/installation
  primary action:
    Install Proliferate GitHub App
    Manage repository access
  copy: "Admins install the app for repos this organization can use in Cloud."
```

Add Cloud repo UI:

```text
1. User picks/searches GitHub repo.
2. Client calls GET /v1/cloud/github-app/repos/{owner}/{repo}/authority.
3. If app authorization missing, show Connect GitHub App action.
4. If installation missing, show Install Proliferate GitHub App action.
5. If repo not covered, show Grant repository access action.
6. If covered, allow Cloud repo creation.
```

Do not expose the Worker credential lease, GitHub App refresh token, or sandbox
token state in UI. UI shows only product-actionable authorization and coverage
state.

Exchange helper:

```python
@dataclass(frozen=True)
class GitHubAppUserAuthorization:
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    refresh_token_expires_at: datetime | None
    github_user_id: str
    github_login: str


async def exchange_github_app_code(*, code: str) -> GitHubAppUserAuthorization:
    response = await httpx.AsyncClient().post(
        "https://github.com/login/oauth/access_token",
        headers={"Accept": "application/json"},
        data={
            "client_id": settings.github_app_client_id,
            "client_secret": settings.github_app_client_secret,
            "code": code,
        },
    )
    ...
```

Refresh helper:

```python
async def refresh_github_app_user_authorization(
    authorization: GitHubAppAuthorizationValue,
) -> GitHubAppUserAuthorization:
    response = await httpx.AsyncClient().post(
        "https://github.com/login/oauth/access_token",
        headers={"Accept": "application/json"},
        data={
            "client_id": settings.github_app_client_id,
            "client_secret": settings.github_app_client_secret,
            "grant_type": "refresh_token",
            "refresh_token": decrypt_text(authorization.refresh_token_ciphertext),
        },
    )
    ...
```

## GitHub App Webhooks

Webhook route:

```text
POST /v1/cloud/webhooks/github-app
```

Route behavior:

```python
@router.post("/github-app", status_code=204)
async def github_app_webhook_endpoint(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> Response:
    payload = await request.body()
    event = request.headers.get("x-github-event")
    signature = request.headers.get("x-hub-signature-256")

    verify_github_app_webhook_signature(
        payload,
        signature=signature,
        secret=settings.github_app_webhook_secret,
    )
    await process_github_app_webhook(db, event=event, payload=payload)
    return Response(status_code=204)
```

Handled events:

```text
installation.created
  upsert installation row
  cache selected repositories when included

installation.deleted
  mark installation revoked/deleted
  delete or stale all cached repository coverage for the installation

installation.suspend
  set suspended_at
  status checks should treat the installation as unusable

installation.unsuspend
  clear suspended_at
  status checks may use cache if fresh, otherwise live fallback

installation_repositories.added
  add/upsert selected repository cache rows

installation_repositories.removed
  delete or stale selected repository cache rows
```

Webhook processing is best-effort cache maintenance, not the only correctness
path. The repo authority helper must still perform live GitHub checks on cache
miss, stale cache, suspended installation, missing installation, or any
ambiguous selected-repository state. A missed webhook can make the UI briefly
stale, but it must not allow unauthorized materialization.

## Repo Authority Helper

Repo setup and materialization call one service-level gate. They must not query
GitHub App tables directly.

```python
@dataclass(frozen=True)
class GitHubCloudRepoAuthority:
    user_id: UUID
    git_provider: Literal["github"]
    git_owner: str
    git_repo_name: str
    token_kind: Literal["github_app_user_to_server"]
    actor_login: str
    github_user_id: str | None
    installation_id: str | None
    repository_id: str | None
```

```python
async def require_github_cloud_repo_authority(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> GitHubCloudRepoAuthority:
    authorization = await get_ready_github_app_authorization(db, user_id=user_id)
    if authorization is None:
        raise CloudApiError(
            "github_app_authorization_required",
            "Connect the Proliferate GitHub App before using GitHub Cloud repos.",
            status_code=409,
        )

    installation = await find_installation_covering_repo(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    if installation is None:
        raise CloudApiError(
            "github_app_installation_required",
            "Install the Proliferate GitHub App for this repository.",
            status_code=409,
        )

    coverage = await resolve_installation_repo_coverage(
        db,
        installation=installation,
        authorization=authorization,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    if not coverage.covered:
        raise CloudApiError(
            "github_app_repo_not_covered",
            "Grant the Proliferate GitHub App access to this repository.",
            status_code=409,
        )

    if not await verify_github_app_user_repo_access(
        authorization=authorization,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    ):
        raise CloudApiError(
            "github_repo_access_required",
            "Your GitHub user must have access to this repository.",
            status_code=409,
        )

    return GitHubCloudRepoAuthority(
        user_id=user_id,
        git_provider="github",
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        token_kind="github_app_user_to_server",
        actor_login=authorization.github_login,
        github_user_id=authorization.github_user_id,
        installation_id=installation.github_installation_id,
        repository_id=coverage.repository_id,
    )
```

Coverage resolution:

```python
@dataclass(frozen=True)
class GitHubRepoCoverage:
    covered: bool
    repository_id: str | None
    source: Literal["cache", "live"]


async def resolve_installation_repo_coverage(
    db: AsyncSession,
    *,
    installation: GitHubAppInstallationValue,
    authorization: GitHubAppAuthorizationValue,
    git_owner: str,
    git_repo_name: str,
) -> GitHubRepoCoverage:
    cached = await get_fresh_installation_repo_cache(
        db,
        installation_id=installation.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    if cached is not None:
        return GitHubRepoCoverage(
            covered=True,
            repository_id=cached.github_repository_id,
            source="cache",
        )

    live = await fetch_installation_repo_coverage_from_github(
        authorization=authorization,
        installation=installation,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    await update_installation_repo_cache(db, installation=installation, coverage=live)
    return live
```

Webhooks update installation and selected-repo cache best-effort. Live GitHub
checks remain the correctness fallback for cache misses, stale cache, missed
webhooks, revoked installations, and changed selected-repository lists.

The authority check verifies both:

```text
1. GitHub App installation covers the repository.
2. The actor/user access token can access the repository.
```

The second check is required because user access tokens are bounded by the
intersection of app permissions and the human actor's permissions.

Errors surfaced by this helper:

```text
github_app_authorization_required
github_app_authorization_expired
github_app_installation_required
github_app_repo_not_covered
github_repo_access_required
```

## Worker Credential Refresh Endpoint

The sandbox Worker gets Git credentials through a worker-authenticated endpoint.

```text
POST /v1/cloud/worker/github-credentials/refresh
Authorization: Bearer <worker_token>
```

Request:

```python
class WorkerGitHubCredentialLeaseRequest(BaseModel):
    current_lease_id: str | None = Field(default=None, alias="currentLeaseId")
    current_expires_at: datetime | None = Field(default=None, alias="currentExpiresAt")
```

Response:

```python
class WorkerGitHubCredentialLeaseResponse(BaseModel):
    provider: str = "github"
    token_kind: str = Field(serialization_alias="tokenKind")
    access_token: str = Field(serialization_alias="accessToken")
    actor_login: str = Field(serialization_alias="actorLogin")
    actor_id: str = Field(serialization_alias="actorId")
    issued_at: datetime = Field(serialization_alias="issuedAt")
    expires_at: datetime = Field(serialization_alias="expiresAt")
    refresh_after: datetime = Field(serialization_alias="refreshAfter")
    lease_id: str = Field(serialization_alias="leaseId")
```

Worker Rust DTOs:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshGitHubCredentialsRequest {
    pub current_lease_id: Option<String>,
    pub current_expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCredentialLease {
    pub provider: String,
    pub token_kind: String,
    pub access_token: String,
    pub actor_login: String,
    pub actor_id: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub refresh_after: DateTime<Utc>,
    pub lease_id: String,
}
```

Worker client:

```rust
impl CloudClient {
    pub async fn refresh_github_credentials(
        &self,
        worker_token: &str,
        request: &RefreshGitHubCredentialsRequest,
    ) -> Result<GitHubCredentialLease, WorkerError> {
        let response = self
            .http
            .post(format!(
                "{}/v1/cloud/worker/github-credentials/refresh",
                self.base_url
            ))
            .header(
                reqwest::header::AUTHORIZATION,
                auth::bearer_header(worker_token),
            )
            .json(request)
            .send()
            .await?;
        parse_json_response(response).await
    }
}
```

Route:

```python
@router.post("/github-credentials/refresh", response_model=WorkerGitHubCredentialLeaseResponse)
async def worker_github_credentials_refresh_endpoint(
    body: WorkerGitHubCredentialLeaseRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerGitHubCredentialLeaseResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await refresh_worker_github_credentials(db, auth=auth, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)
```

Service:

```python
async def refresh_worker_github_credentials(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerGitHubCredentialLeaseRequest,
) -> WorkerGitHubCredentialLeaseResponse:
    target = await require_active_worker_target(db, auth=auth)
    user_id = _personal_target_owner_user_id(target)

    authorization = await get_ready_github_app_authorization(db, user_id=user_id)
    if authorization is None:
        raise CloudApiError(
            "github_app_authorization_required",
            "Connect the Proliferate GitHub App before refreshing sandbox Git credentials.",
            status_code=409,
        )

    lease = await mint_or_refresh_github_app_user_lease(db, authorization=authorization)
    return WorkerGitHubCredentialLeaseResponse(...)
```

Owner resolution:

```python
def _personal_target_owner_user_id(target: CloudTargetSnapshot) -> UUID:
    if target.owner_scope == "personal" and target.owner_user_id is not None:
        return target.owner_user_id
    raise CloudApiError(
        "github_credentials_personal_target_required",
        "GitHub credential refresh currently requires a personal managed sandbox target.",
        status_code=409,
    )
```

GitHub App lease minting:

```python
async def mint_or_refresh_github_app_user_lease(
    db: AsyncSession,
    *,
    authorization: GitHubAppAuthorizationValue,
) -> WorkerGitHubCredentialLeaseResponse:
    now = utcnow()
    refreshed = authorization

    if (
        authorization.token_expires_at is None
        or authorization.token_expires_at <= now + timedelta(minutes=10)
    ):
        if authorization.refresh_token is None:
            await mark_github_app_authorization_needs_reauth(db, authorization.id)
            raise CloudApiError(
                "github_app_authorization_expired",
                "Reconnect the Proliferate GitHub App before refreshing sandbox Git credentials.",
                status_code=409,
            )
        refreshed_token = await refresh_github_app_user_authorization(authorization)
        refreshed = await upsert_github_app_authorization(
            db,
            user_id=authorization.user_id,
            authorization=refreshed_token,
        )
        await db.flush()

    if refreshed.access_token is None or refreshed.token_expires_at is None:
        raise CloudApiError(
            "github_app_authorization_required",
            "Connect the Proliferate GitHub App before using GitHub Cloud repos.",
            status_code=409,
        )

    return WorkerGitHubCredentialLeaseResponse(
        provider="github",
        token_kind="github_app_user_to_server",
        access_token=refreshed.access_token,
        actor_login=refreshed.github_login,
        actor_id=refreshed.github_user_id,
        issued_at=now,
        expires_at=refreshed.token_expires_at,
        refresh_after=_lease_refresh_after(
            now=now,
            expires_at=refreshed.token_expires_at,
        ),
        lease_id=secrets.token_urlsafe(18),
    )
```

Refresh timing helper:

```python
def _lease_refresh_after(*, now: datetime, expires_at: datetime) -> datetime:
    latest_safe_refresh = expires_at - timedelta(minutes=10)
    preferred_refresh = min(
        expires_at - timedelta(minutes=30),
        now + timedelta(hours=7),
    )
    refresh_after = min(preferred_refresh, latest_safe_refresh)
    if refresh_after <= now:
        return now
    return refresh_after
```

`refreshAfter` must never be later than `expiresAt - 10 minutes`. If the
token is already inside that safety window, the server returns an immediate
refresh point and the next Worker cycle will request a new lease again.

If the GitHub refresh request returns `invalid_grant`, the server marks the
authorization `needs_reauth` and returns `github_app_authorization_expired`.

```python
try:
    refreshed_token = await refresh_github_app_user_authorization(authorization)
except GitHubAppInvalidGrant as exc:
    await mark_github_app_authorization_needs_reauth(db, authorization.id)
    raise CloudApiError(
        "github_app_authorization_expired",
        "Reconnect the Proliferate GitHub App.",
        status_code=409,
    ) from exc
```

The response never includes `refresh_token_ciphertext`, app private-key
material, app JWTs, installation access tokens, OAuth client secrets, or raw DB
row identifiers.

## Worker Refresh Logic

High-level Worker workflow:

```text
startup / sandbox resume:
  load worker config
  load enrolled worker identity
  send heartbeat to Cloud
  converge GitHub credential lease
  continue existing event/control loops while they exist

heartbeat loop:
  sleep until heartbeat interval
  send heartbeat
  if heartbeat succeeds:
    converge GitHub credential lease

credential convergence:
  ensure global git config points github.com to the helper
  read ~/.proliferate/git/github.com/meta.json
  if token/meta are missing or stale:
    call Cloud worker refresh endpoint with worker token
    atomically write token + meta
```

The important mental model: the Worker is the sandbox-side maintenance process.
For this auth path it does not clone repos, run Git commands, create PRs, or
decide repo permissions. It keeps the sandbox enrolled, heartbeats to Cloud,
and refreshes the local Git credential lease. AnyHarness and terminals then use
normal Git, and Git asks the helper for the current token.

Worker local files:

```text
~/.proliferate/git/github.com/token
~/.proliferate/git/github.com/meta.json
~/.gitconfig
```

`meta.json`:

```json
{
  "provider": "github",
  "tokenKind": "github_app_user_to_server",
  "actorLogin": "pablonyx",
  "actorId": "123456",
  "issuedAt": "2026-06-26T20:00:00Z",
  "expiresAt": "2026-06-27T04:00:00Z",
  "refreshAfter": "2026-06-27T03:30:00Z",
  "leaseId": "..."
}
```

Worker lifecycle:

```rust
pub async fn converge_once(
    config: &WorkerConfig,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
) -> Result<(), WorkerError> {
    materialization::github_credentials::ensure_global_git_config(config)?;

    let paths = materialization::github_credentials::paths()?;
    let current = materialization::github_credentials::read_meta(&paths)?;

    if materialization::github_credentials::lease_is_fresh(current.as_ref(), Utc::now()) {
        return Ok(());
    }

    let lease = cloud
        .refresh_github_credentials(
            &identity.worker_token,
            &RefreshGitHubCredentialsRequest {
                current_lease_id: current.as_ref().map(|state| state.lease_id.clone()),
                current_expires_at: current.as_ref().map(|state| state.expires_at),
            },
        )
        .await?;

    materialization::github_credentials::write_lease(&paths, &lease)?;
    Ok(())
}
```

Freshness:

```text
refresh if:
  token file missing
  meta file missing
  tokenKind unsupported
  now >= refreshAfter
  now + 10 minutes >= expiresAt
```

Cadence:

```text
after enrollment and the first successful heartbeat:
  converge_once()

on worker process start after sandbox resume:
  converge_once() runs again through normal startup

once per heartbeat cycle:
  send heartbeat
  if heartbeat succeeds, converge_once()

future explicit trigger:
  AnyHarness may ask Worker to force refresh after a Git auth failure, but the
  helper still never calls Cloud directly.
```

Runtime insertion:

```rust
if let Err(error) = lifecycle::heartbeat::send_once(&config, &cloud, &identity, &store).await {
    warn!(?error, "worker heartbeat failed");
}
if let Err(error) =
    lifecycle::github_credentials::converge_once(&config, &cloud, &identity).await
{
    warn!(?error, "github credential convergence failed");
}

loop {
    sleep(heartbeat::interval(&config)).await;
    match heartbeat::send_once(&config, &cloud, &identity, &store).await {
        Ok(()) => {
            if let Err(error) =
                lifecycle::github_credentials::converge_once(&config, &cloud, &identity).await
            {
                warn!(?error, "github credential convergence failed");
            }
        }
        Err(error) => warn!(?error, "worker heartbeat failed"),
    }
}
```

The credential refresh is intentionally outside the command long-poll. It is
not a Cloud command and does not require command leases, exposures, session
projections, or AnyHarness health.

## Worker Materialization

`materialization/github_credentials.rs` writes files atomically with private
permissions.

Paths and local state:

```rust
#[derive(Debug, Clone)]
pub struct GitHubCredentialPaths {
    pub root: PathBuf,
    pub token: PathBuf,
    pub meta: PathBuf,
    pub helper: PathBuf,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCredentialMeta {
    pub provider: String,
    pub token_kind: String,
    pub actor_login: String,
    pub actor_id: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub refresh_after: DateTime<Utc>,
    pub lease_id: String,
}

pub fn paths() -> Result<GitHubCredentialPaths, WorkerError> {
    let home = dirs::home_dir().ok_or_else(|| {
        WorkerError::Materialization("home directory is unavailable".to_string())
    })?;
    let root = home.join(".proliferate").join("git").join("github.com");
    Ok(GitHubCredentialPaths {
        root: root.clone(),
        token: root.join("token"),
        meta: root.join("meta.json"),
        helper: home
            .join(".proliferate")
            .join("bin")
            .join("proliferate-git-credential-helper"),
    })
}

pub fn read_meta(paths: &GitHubCredentialPaths) -> Result<Option<GitHubCredentialMeta>, WorkerError> {
    if !paths.meta.exists() || !paths.token.exists() {
        return Ok(None);
    }
    let contents = std::fs::read(&paths.meta).map_err(|source| WorkerError::ReadConfig {
        path: paths.meta.clone(),
        source,
    })?;
    Ok(Some(serde_json::from_slice(&contents)?))
}

pub fn lease_is_fresh(
    meta: Option<&GitHubCredentialMeta>,
    now: DateTime<Utc>,
) -> bool {
    let Some(meta) = meta else {
        return false;
    };
    if meta.provider != "github" {
        return false;
    }
    if !matches!(
        meta.token_kind.as_str(),
        "github_app_user_to_server"
    ) {
        return false;
    }
    if now >= meta.refresh_after {
        return false;
    }
    if now + chrono::Duration::minutes(10) >= meta.expires_at {
        return false;
    }
    true
}
```

Lease write:

```rust
pub fn write_lease(
    paths: &GitHubCredentialPaths,
    lease: &GitHubCredentialLease,
) -> Result<(), WorkerError> {
    validate_token_kind(&lease.token_kind)?;
    validate_token(&lease.access_token)?;

    files::write_file(
        &paths.token,
        format!("{}\n", lease.access_token).as_bytes(),
        true,
    )?;

    let meta = GitHubCredentialMeta::from(lease);
    files::write_file(
        &paths.meta,
        &serde_json::to_vec_pretty(&meta)?,
        true,
    )?;

    Ok(())
}
```

Global Git config:

```rust
pub fn ensure_global_git_config(_config: &WorkerConfig) -> Result<(), WorkerError> {
    git_config_set(
        "credential.https://github.com.helper",
        "!/home/user/.proliferate/bin/proliferate-git-credential-helper",
    )?;
    git_config_add_once("url.https://github.com/.insteadOf", "git@github.com:")?;
    git_config_add_once("url.https://github.com/.insteadOf", "ssh://git@github.com/")?;
    Ok(())
}
```

Idempotent Git config helpers:

```rust
fn git_config_set(key: &str, value: &str) -> Result<(), WorkerError> {
    run_git(["config", "--global", key, value])
}

fn git_config_add_once(key: &str, value: &str) -> Result<(), WorkerError> {
    let existing = git_config_get_all(key)?;
    if existing.iter().any(|item| item == value) {
        return Ok(());
    }
    run_git(["config", "--global", "--add", key, value])
}
```

The Worker does not install the helper. The helper is part of the template. The
Worker may verify that the helper exists and log a materialization error if it
is missing.

## Credential Helper

The template bakes the helper at:

```text
/home/user/.proliferate/bin/proliferate-git-credential-helper
```

Helper:

```bash
#!/usr/bin/env bash
set -euo pipefail

operation="${1:-get}"
[[ "$operation" == "get" ]] || exit 0

protocol=""
host=""
while IFS= read -r line; do
  [[ -z "$line" ]] && break
  case "$line" in
    protocol=*) protocol="${line#protocol=}" ;;
    host=*) host="${line#host=}" ;;
  esac
done

[[ "$protocol" == "https" ]] || exit 0
case "$host" in
  github.com|www.github.com) ;;
  *) exit 0 ;;
esac

token_file="${PROLIFERATE_GIT_TOKEN_FILE:-$HOME/.proliferate/git/github.com/token}"
[[ -r "$token_file" ]] || exit 0

IFS= read -r token < "$token_file" || exit 0
[[ -n "$token" ]] || exit 0

printf 'username=x-access-token\n'
printf 'password=%s\n\n' "$token"
```

Template build must copy this file and chmod it:

```javascript
await template.files.write(
  "/home/user/.proliferate/bin/proliferate-git-credential-helper",
  fs.readFileSync("install/proliferate-git-credential-helper", "utf8"),
);
await template.commands.run(
  "chmod 700 /home/user/.proliferate/bin/proliferate-git-credential-helper",
);
```

The helper intentionally has no `.sh` extension. Git credential helpers are
executables, not sourced shell scripts, and the shebang selects the interpreter.
Keeping the stable name `proliferate-git-credential-helper` makes the Git config
read like an executable contract and lets us later replace the shell helper with
a Rust or static binary without changing sandbox Git config.

## Repo Materialization Boundary

Cloud DB owns configured repos, setup commands, run commands, and repo policy.
AnyHarness owns workspace records, worktrees, sessions, Git operations, and
terminal-visible state.

Repo materialization must not pass GitHub tokens in command env. It relies on
global Git config and the helper.

```bash
git clone https://github.com/<owner>/<repo>.git <repo_path>
git -C <repo_path> fetch --prune origin
git -C <repo_path> push origin HEAD:<branch>
```

Managed-cloud repo materialization must fail closed if the helper/token path is
not ready. Server-side askpass/token clone paths are not part of the target
contract for managed cloud.

## Error States

Worker refresh endpoint errors:

```text
401 cloud_worker_auth_required
401 cloud_worker_auth_invalid
409 cloud_worker_target_archived
409 github_credentials_personal_target_required
409 github_app_authorization_required
409 github_app_authorization_expired
502 github_app_refresh_failed
```

Repo authority errors:

```text
409 github_app_authorization_required
409 github_app_authorization_expired
409 github_app_installation_required
409 github_app_repo_not_covered
409 github_repo_access_required
```

Worker local errors are logged and retried on the next heartbeat cycle. A Git
operation fails naturally if no valid credential can be provided.

## Rollout

```text
1. Add GitHub App config reader, connect/callback/status endpoints, and storage.
2. Add GitHub App webhooks and installation/repo coverage cache.
3. Add repo authority helper with cached coverage plus live fallback checks.
4. Add Worker refresh endpoint that mints GitHub App user-to-server leases only.
5. Add helper to template build and smoke tests.
6. Add Worker lifecycle refresh + materialization files.
7. Stop passing GitHub tokens through repo materialization commands.
8. Require helper-backed plain Git for managed-cloud materialization.
9. Reduce product GitHub OAuth scopes after Cloud repo access no longer
   depends on OAuth repo scope.
```

## Tests

Server:

```text
worker refresh rejects missing/invalid worker token
worker refresh rejects archived target
worker refresh resolves personal target owner
worker refresh rejects missing GitHub App auth
worker refresh marks needs_reauth when refresh token is missing on refresh path
worker refresh marks needs_reauth when GitHub returns invalid_grant
worker refresh returns GitHub App lease when authorization is ready
worker refresh never returns refresh tokens or app secrets
lease refreshAfter is never later than expiresAt minus ten minutes
repo authority helper rejects missing app auth
repo authority helper rejects missing installation
repo authority helper rejects uncovered repo
repo authority helper verifies actor/user access, not only installation coverage
repo coverage cache uses fresh rows and falls back to live GitHub lookup
GitHub App status returns connect/reauthorize/install/grant actions
GitHub App webhooks update installation and selected-repo cache best-effort
```

Worker:

```text
fresh meta skips refresh
missing token refreshes
expired meta refreshes
write_lease writes token/meta with private permissions
helper config is installed idempotently
github.com SSH insteadOf config is installed idempotently
```

Template smoke:

```text
helper exists and is executable
helper no-ops without token
with token file, helper prints username and password
git clone through helper succeeds
git fetch through helper succeeds
git commit succeeds locally
git push --dry-run through helper succeeds
```

Live smoke:

```text
connect GitHub App in local profile
ensure managed sandbox
worker refreshes github.com token
materialize configured repo
through gateway, create AnyHarness workspace/session
inside terminal, git fetch succeeds
inside terminal, git push --dry-run succeeds
confirm no raw GitHub token reaches Desktop/Web
```

## Manual Profile QA

Every PR that wires the GitHub App credential path must be manually tested with
a local full-stack profile. This is required because the critical behavior spans
GitHub App OAuth, local profile env, PAPI, E2B, Worker, the credential helper,
Git, gateway access, and AnyHarness.

Local secret setup:

```text
server/.env.local
  GITHUB_APP_ID=<dev app id>
  GITHUB_APP_CLIENT_ID=<dev app client id>
  GITHUB_APP_CLIENT_SECRET=<dev app client secret>
  GITHUB_APP_WEBHOOK_SECRET=<dev app webhook secret>
  GITHUB_APP_CALLBACK_BASE_URL=<ngrok api url for this run>
  GITHUB_APP_PRIVATE_KEY=<inline \n-escaped private key>
  # Or, in prod-like local tests:
  # GITHUB_APP_PRIVATE_KEY_PATH=/secure/path/proliferate-github-app.pem

  # Production values may be kept as commented reference only.
  # Production secrets belong in SSM/secret manager, not committed files.
```

`GITHUB_APP_CALLBACK_BASE_URL` must match the public URL printed by the local
profile/dev auth flow for the current session. It is not stable across ngrok
runs unless a reserved domain is used.

Profile startup:

```bash
make setup PROFILE=github-app-smoke
make run PROFILE=github-app-smoke
```

The runner should print the public API URL and provider callback URLs. Update
`server/.env.local` with the current GitHub App callback base if it changed,
then restart the profile.

User handoff:

```text
1. Open the local product URL for the profile.
2. User logs in with the normal product GitHub identity flow.
3. User connects/authorizes the dev GitHub App from the product UI.
4. User installs/grants the dev GitHub App to the test repo or org.
5. User returns to the product after the callback succeeds.
```

After user auth is complete, the implementer must verify:

```text
Product:
  GitHub App status shows connected.
  Add Cloud repo succeeds only for repos covered by the GitHub App.
  Add Cloud repo fails with product-actionable errors for uncovered repos.

Server:
  github_app_authorization row exists for the user.
  encrypted refresh token is present when GitHub returns one.
  worker refresh endpoint returns tokenKind=github_app_user_to_server.

Sandbox:
  Worker writes ~/.proliferate/git/github.com/token.
  Worker writes ~/.proliferate/git/github.com/meta.json.
  Global git config points github.com credentials at the helper.
  SSH-style GitHub remotes rewrite to HTTPS.
```

Do not print real tokens. Use size, hash prefix, redaction, or metadata.

Sandbox inspection commands:

```bash
e2b sandbox connect <sandbox-id>

test -x /home/user/.proliferate/bin/proliferate-git-credential-helper
test -s /home/user/.proliferate/git/github.com/token
test -s /home/user/.proliferate/git/github.com/meta.json

python3 - <<'PY'
import json
from pathlib import Path

meta = json.loads(Path("/home/user/.proliferate/git/github.com/meta.json").read_text())
print({
    "provider": meta.get("provider"),
    "tokenKind": meta.get("tokenKind"),
    "actorLogin": meta.get("actorLogin"),
    "expiresAt": meta.get("expiresAt"),
    "refreshAfter": meta.get("refreshAfter"),
})
PY

git config --global --show-origin --get-all credential.https://github.com.helper
git config --global --show-origin --get-all url.https://github.com/.insteadOf

printf 'protocol=https\nhost=github.com\n\n' \
  | /home/user/.proliferate/bin/proliferate-git-credential-helper get \
  | sed 's/^password=.*/password=<redacted>/'
```

Plain Git smoke inside the sandbox:

```bash
export GIT_TERMINAL_PROMPT=0
repo=/home/user/workspace/github-app-smoke/proliferate
branch="codex/github-app-smoke-$(date +%s)"

rm -rf "$repo"
mkdir -p "$(dirname "$repo")"

git clone https://github.com/proliferate-ai/proliferate.git "$repo"
git -C "$repo" fetch --dry-run origin

git -C "$repo" checkout -B "$branch"
printf 'github app smoke %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$repo/.proliferate-github-app-smoke.txt"
git -C "$repo" add -f .proliferate-github-app-smoke.txt
git -C "$repo" commit -m "test: github app credential smoke"
git -C "$repo" push --dry-run origin "HEAD:refs/heads/$branch"
```

Product end-to-end smoke:

```text
1. In the product UI, add/select a GitHub Cloud repo covered by the app.
2. Ensure the managed sandbox starts or wakes.
3. Create or open a Cloud workspace.
4. Confirm repo materialization completes without token env/askpass injection.
5. Send a chat prompt through the gateway-backed AnyHarness connection.
6. Open terminal through the gateway.
7. Run `git fetch --dry-run origin` in the terminal.
8. Run `git push --dry-run origin HEAD:refs/heads/<smoke-branch>` in the terminal.
9. Confirm Desktop/Web never receive raw GitHub token, app refresh token, app
   private key, or sandbox helper token.
```

Negative selected-repo smoke:

```text
1. In GitHub, remove the test repo from the selected repositories granted to the
   dev GitHub App installation.
2. In product, retry Add Cloud repo or refresh the existing Cloud repo.
3. Confirm product shows the repo as unavailable/actionable.
4. Confirm materialization fails before clone/fetch with
   github_app_repo_not_covered.
5. Restore repo access in GitHub and confirm the product recovers after status
   refresh/live fallback.
```

Acceptance notes to capture in the PR:

```text
profile name:
public callback base:
GitHub App mode: app-user-token
managed sandbox id:
tokenKind observed in meta.json:
repo smoke result:
gateway session smoke result:
terminal git smoke result:
known failures / skipped steps:
```
