use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use anyharness_contract::v1::{
    RuntimeConfigManifest, RuntimeConfigRevision, RuntimeDirectAttachAuthConfig,
};
use axum::http::Method;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const JWT_LEEWAY_SECONDS: u64 = 30;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthContext {
    Unauthenticated,
    Worker,
    UserClaim(UserClaimAuth),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserClaimAuth {
    pub user_id: String,
    pub organization_id: String,
    pub target_id: String,
    pub cloud_workspace_id: String,
    pub anyharness_workspace_id: String,
    pub cloud_session_id: Option<String>,
    pub anyharness_session_id: Option<String>,
    pub claim_id: String,
    pub permissions: ClaimPermissions,
    pub jti: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ClaimPermissions {
    pub read: bool,
    pub write: bool,
    pub control: bool,
}

#[derive(Debug, Clone)]
pub struct AuthManager {
    inner: Arc<RwLock<AuthManagerState>>,
}

#[derive(Debug, Clone, Default)]
struct AuthManagerState {
    runtime_target_id: Option<String>,
    issuer: Option<String>,
    audience: String,
    verification_keys: HashMap<String, VerificationKey>,
    revoked_jtis: HashMap<String, i64>,
}

#[derive(Debug, Clone)]
struct VerificationKey {
    algorithm: String,
    public_key_pem: String,
}

#[derive(Debug, Deserialize, Clone)]
struct DirectAttachClaims {
    sub: String,
    exp: i64,
    jti: String,
    org_id: String,
    target_id: String,
    cloud_workspace_id: String,
    anyharness_workspace_id: String,
    cloud_session_id: Option<String>,
    anyharness_session_id: Option<String>,
    claim_id: String,
    permissions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    InvalidToken,
    UnsupportedRoute,
    InsufficientPermission,
    ScopeMismatch,
    Revoked,
    NotConfigured,
}

impl AuthManager {
    pub fn new(runtime_target_id: Option<String>) -> Self {
        Self {
            inner: Arc::new(RwLock::new(AuthManagerState {
                runtime_target_id,
                issuer: None,
                audience: "anyharness".to_string(),
                verification_keys: HashMap::new(),
                revoked_jtis: HashMap::new(),
            })),
        }
    }

    pub fn runtime_target_id(&self) -> Option<String> {
        self.inner
            .read()
            .ok()
            .and_then(|state| state.runtime_target_id.clone())
    }

    pub fn apply_runtime_config(
        &self,
        revision: &RuntimeConfigRevision,
        manifest: &RuntimeConfigManifest,
    ) {
        let Ok(mut state) = self.inner.write() else {
            return;
        };
        if let Some(target_id) = revision
            .external_scope
            .as_ref()
            .and_then(|scope| scope.target_id.as_ref())
            .filter(|value| !value.trim().is_empty())
        {
            state.runtime_target_id = Some(target_id.trim().to_string());
        }
        match manifest.direct_attach_auth.as_ref() {
            Some(config) => apply_direct_attach_config_to_state(&mut state, config),
            None => clear_direct_attach_config_from_state(&mut state),
        }
        prune_revocations(&mut state, timestamp_now());
    }

    pub fn push_revoked_jtis(&self, jti_hashes: &[String], expires_at: i64) -> usize {
        let Ok(mut state) = self.inner.write() else {
            return 0;
        };
        let now = timestamp_now();
        let mut accepted = 0;
        for hash in jti_hashes {
            let hash = hash.trim();
            if is_sha256_hex(hash) {
                state.revoked_jtis.insert(hash.to_string(), expires_at);
                accepted += 1;
            }
        }
        prune_revocations(&mut state, now);
        accepted
    }

    pub fn verify_user_claim_token(&self, token: &str) -> Result<UserClaimAuth, AuthError> {
        let header = decode_header(token).map_err(|_| AuthError::InvalidToken)?;
        if header.alg != Algorithm::RS256 {
            return Err(AuthError::InvalidToken);
        }
        let kid = header.kid.ok_or(AuthError::InvalidToken)?;
        let state = self
            .inner
            .read()
            .map_err(|_| AuthError::NotConfigured)?
            .clone();
        let runtime_target_id = state
            .runtime_target_id
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or(AuthError::NotConfigured)?;
        let issuer = state.issuer.as_deref().ok_or(AuthError::NotConfigured)?;
        let key = state
            .verification_keys
            .get(&kid)
            .ok_or(AuthError::InvalidToken)?;
        if key.algorithm != "RS256" {
            return Err(AuthError::InvalidToken);
        }
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[issuer]);
        validation.set_audience(&[state.audience.as_str()]);
        validation.validate_nbf = true;
        validation.leeway = JWT_LEEWAY_SECONDS;
        let decoding_key = DecodingKey::from_rsa_pem(key.public_key_pem.as_bytes())
            .map_err(|_| AuthError::NotConfigured)?;
        let token_data = decode::<DirectAttachClaims>(token, &decoding_key, &validation)
            .map_err(|_| AuthError::InvalidToken)?;
        let claims = token_data.claims;
        if claims.target_id != runtime_target_id {
            return Err(AuthError::ScopeMismatch);
        }
        let jti_hash = sha256_hex(&claims.jti);
        if state.revoked_jtis.contains_key(&jti_hash) {
            return Err(AuthError::Revoked);
        }
        Ok(UserClaimAuth {
            user_id: claims.sub,
            organization_id: claims.org_id,
            target_id: claims.target_id,
            cloud_workspace_id: claims.cloud_workspace_id,
            anyharness_workspace_id: claims.anyharness_workspace_id,
            cloud_session_id: claims.cloud_session_id,
            anyharness_session_id: claims.anyharness_session_id,
            claim_id: claims.claim_id,
            permissions: ClaimPermissions::from_values(&claims.permissions),
            jti: claims.jti,
            expires_at: claims.exp,
        })
    }
}

pub fn user_route_allowed(
    method: &Method,
    path: &str,
    claim: &UserClaimAuth,
) -> Result<(), AuthError> {
    let segments = normalized_segments(path);
    let segments = if segments.first().copied() == Some("v1") {
        &segments[1..]
    } else {
        segments.as_slice()
    };
    match segments {
        ["workspaces"] if method == Method::GET => require_permission(claim, Permission::Read),
        ["workspaces", workspace_id] if method == Method::GET => {
            require_permission(claim, Permission::Read)?;
            require_workspace_scope(claim, workspace_id)
        }
        ["workspaces", workspace_id, "plans"] if method == Method::GET => {
            require_workspace_permission(claim, workspace_id, Permission::Read)
        }
        ["workspaces", workspace_id, "plans", _] if method == Method::GET => {
            require_workspace_permission(claim, workspace_id, Permission::Read)
        }
        ["workspaces", workspace_id, "plans", _, "document"] if method == Method::GET => {
            require_workspace_permission(claim, workspace_id, Permission::Read)
        }
        ["workspaces", workspace_id, "files", "entries"] if method == Method::GET => {
            require_workspace_permission(claim, workspace_id, Permission::Read)
        }
        ["workspaces", workspace_id, "files", "entries"]
            if method == Method::POST || method == Method::PATCH || method == Method::DELETE =>
        {
            require_workspace_permission(claim, workspace_id, Permission::Write)
        }
        ["workspaces", workspace_id, "files", "search" | "stat"] if method == Method::GET => {
            require_workspace_permission(claim, workspace_id, Permission::Read)
        }
        ["workspaces", workspace_id, "files", "file"] if method == Method::GET => {
            require_workspace_permission(claim, workspace_id, Permission::Read)
        }
        ["workspaces", workspace_id, "files", "file"] if method == Method::PUT => {
            require_workspace_permission(claim, workspace_id, Permission::Write)
        }
        ["workspaces", workspace_id, "git", "status" | "diff" | "branches"]
            if method == Method::GET =>
        {
            require_workspace_permission(claim, workspace_id, Permission::Read)
        }
        ["workspaces", workspace_id, "git", "diff", "branch-files" | "base-worktree-files"]
            if method == Method::GET =>
        {
            require_workspace_permission(claim, workspace_id, Permission::Read)
        }
        ["workspaces", workspace_id, "git", "rename-branch" | "stage" | "unstage" | "commit"]
            if method == Method::POST =>
        {
            require_workspace_permission(claim, workspace_id, Permission::Write)
        }
        ["workspaces", workspace_id, "git", "push"] if method == Method::POST => {
            require_workspace_permission(claim, workspace_id, Permission::Control)
        }
        ["workspaces", workspace_id, "hosting", "pull-requests", "current"]
            if method == Method::GET =>
        {
            require_workspace_permission(claim, workspace_id, Permission::Read)
        }
        ["workspaces", workspace_id, "terminals"] if method == Method::GET => {
            require_workspace_permission(claim, workspace_id, Permission::Read)
        }
        ["workspaces", workspace_id, "terminals"] if method == Method::POST => {
            require_workspace_permission(claim, workspace_id, Permission::Write)
        }
        ["agents", _, "login", "terminal"] if method == Method::POST => {
            require_permission(claim, Permission::Write)
        }
        ["agents", "login-terminals", _] if method == Method::GET => {
            require_permission(claim, Permission::Read)
        }
        ["agents", "login-terminals", _, "ws"] if method == Method::GET => {
            require_permission(claim, Permission::Write)
        }
        ["agents", "login-terminals", _] if method == Method::DELETE => {
            require_permission(claim, Permission::Control)
        }
        ["sessions"] if method == Method::GET => require_permission(claim, Permission::Read),
        ["sessions"] if method == Method::POST => require_permission(claim, Permission::Write),
        ["sessions", session_id] if method == Method::GET => {
            require_permission(claim, Permission::Read)?;
            require_session_claim_scope(claim, session_id)
        }
        ["sessions", session_id, "events"] if method == Method::GET => {
            require_permission(claim, Permission::Read)?;
            require_session_claim_scope(claim, session_id)
        }
        ["sessions", session_id, "stream"] if method == Method::GET => {
            require_permission(claim, Permission::Read)?;
            require_session_claim_scope(claim, session_id)
        }
        ["sessions", session_id, "prompt"] if method == Method::POST => {
            require_permission(claim, Permission::Write)?;
            require_session_claim_scope(claim, session_id)
        }
        ["sessions", session_id, "interactions", _, "resolve"] if method == Method::POST => {
            require_permission(claim, Permission::Write)?;
            require_session_claim_scope(claim, session_id)
        }
        ["sessions", session_id, "cancel"] if method == Method::POST => {
            require_permission(claim, Permission::Write)?;
            require_session_claim_scope(claim, session_id)
        }
        ["sessions", session_id, "close"] if method == Method::POST => {
            require_permission(claim, Permission::Control)?;
            require_session_claim_scope(claim, session_id)
        }
        ["sessions", session_id, "title"] if method == Method::PATCH => {
            require_session_permission(claim, session_id, Permission::Write)
        }
        ["sessions", session_id, "live-config"] if method == Method::GET => {
            require_session_permission(claim, session_id, Permission::Read)
        }
        ["sessions", session_id, "config-options"] if method == Method::POST => {
            require_session_permission(claim, session_id, Permission::Write)
        }
        ["sessions", session_id, "pending-prompts", _]
            if method == Method::PATCH || method == Method::DELETE =>
        {
            require_session_permission(claim, session_id, Permission::Write)
        }
        ["sessions", session_id, "prompt-attachments", _] if method == Method::GET => {
            require_session_permission(claim, session_id, Permission::Read)
        }
        ["sessions", session_id, "subagents"] if method == Method::GET => {
            require_session_permission(claim, session_id, Permission::Read)
        }
        ["sessions", session_id, "reviews"] if method == Method::GET => {
            require_session_permission(claim, session_id, Permission::Read)
        }
        ["terminals", _] if method == Method::GET => require_permission(claim, Permission::Read),
        ["terminals", _, "ws"] if method == Method::GET => {
            require_permission(claim, Permission::Write)
        }
        ["terminals", _, "title"] if method == Method::PATCH => {
            require_permission(claim, Permission::Write)
        }
        ["terminals", _, "resize" | "commands"] if method == Method::POST => {
            require_permission(claim, Permission::Write)
        }
        ["terminals", _] if method == Method::DELETE => {
            require_permission(claim, Permission::Control)
        }
        ["terminal-command-runs", _] if method == Method::GET => {
            require_permission(claim, Permission::Read)
        }
        _ => Err(AuthError::UnsupportedRoute),
    }
}

fn require_workspace_permission(
    claim: &UserClaimAuth,
    workspace_id: &str,
    permission: Permission,
) -> Result<(), AuthError> {
    require_permission(claim, permission)?;
    require_workspace_scope(claim, workspace_id)
}

pub fn require_workspace_scope(claim: &UserClaimAuth, workspace_id: &str) -> Result<(), AuthError> {
    if workspace_id == claim.anyharness_workspace_id {
        Ok(())
    } else {
        Err(AuthError::ScopeMismatch)
    }
}

pub fn require_session_claim_scope(
    claim: &UserClaimAuth,
    session_id: &str,
) -> Result<(), AuthError> {
    match claim.anyharness_session_id.as_deref() {
        Some(scoped_session_id) if scoped_session_id != session_id => Err(AuthError::ScopeMismatch),
        _ => Ok(()),
    }
}

fn require_session_permission(
    claim: &UserClaimAuth,
    session_id: &str,
    permission: Permission,
) -> Result<(), AuthError> {
    require_permission(claim, permission)?;
    require_session_claim_scope(claim, session_id)
}

fn apply_direct_attach_config_to_state(
    state: &mut AuthManagerState,
    config: &RuntimeDirectAttachAuthConfig,
) {
    state.issuer = Some(config.issuer.clone());
    state.audience = config.audience.clone();
    if let Some(target_id) = config
        .target_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        state.runtime_target_id = Some(target_id.trim().to_string());
    }
    state.verification_keys.clear();
    for key in &config.verification_keys {
        if key.algorithm == "RS256" && !key.kid.trim().is_empty() {
            state.verification_keys.insert(
                key.kid.trim().to_string(),
                VerificationKey {
                    algorithm: key.algorithm.clone(),
                    public_key_pem: key.public_key_pem.clone(),
                },
            );
        }
    }
}

fn clear_direct_attach_config_from_state(state: &mut AuthManagerState) {
    state.issuer = None;
    state.audience = "anyharness".to_string();
    state.verification_keys.clear();
}

impl ClaimPermissions {
    fn from_values(values: &[String]) -> Self {
        let mut permissions = ClaimPermissions::default();
        for value in values {
            match value.as_str() {
                "read" => permissions.read = true,
                "write" => permissions.write = true,
                "control" => permissions.control = true,
                _ => {}
            }
        }
        permissions
    }

    fn contains(self, required: Permission) -> bool {
        match required {
            Permission::Read => self.read,
            Permission::Write => self.write,
            Permission::Control => self.control,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum Permission {
    Read,
    Write,
    Control,
}

fn require_permission(claim: &UserClaimAuth, permission: Permission) -> Result<(), AuthError> {
    if claim.permissions.contains(permission) {
        Ok(())
    } else {
        Err(AuthError::InsufficientPermission)
    }
}

fn normalized_segments(path: &str) -> Vec<&str> {
    path.trim_start_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect()
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn sha256_hex(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn prune_revocations(state: &mut AuthManagerState, now: i64) {
    state
        .revoked_jtis
        .retain(|_, expires_at| *expires_at >= now);
}

fn timestamp_now() -> i64 {
    chrono::Utc::now().timestamp()
}
