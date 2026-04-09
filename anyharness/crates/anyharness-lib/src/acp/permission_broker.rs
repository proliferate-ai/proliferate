use std::collections::HashMap;
use std::sync::Arc;

use agent_client_protocol as acp;
use tokio::sync::{oneshot, Mutex};

pub struct PermissionBroker {
    pending: Arc<Mutex<HashMap<String, PendingPermissionRequest>>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PermissionOutcome {
    Selected { option_id: String },
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionDecision {
    Allow,
    Deny,
}

struct PendingPermissionRequest {
    respond_to: oneshot::Sender<PermissionOutcome>,
    options: Vec<StoredPermissionOption>,
}

#[derive(Debug, Clone)]
struct StoredPermissionOption {
    option_id: String,
    kind: StoredPermissionOptionKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StoredPermissionOptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
    Unknown,
}

impl StoredPermissionOptionKind {
    fn from_acp(kind: acp::PermissionOptionKind) -> Self {
        match kind {
            acp::PermissionOptionKind::AllowOnce => Self::AllowOnce,
            acp::PermissionOptionKind::AllowAlways => Self::AllowAlways,
            acp::PermissionOptionKind::RejectOnce => Self::RejectOnce,
            acp::PermissionOptionKind::RejectAlways => Self::RejectAlways,
            _ => Self::Unknown,
        }
    }
}

impl PermissionBroker {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn request_permission(
        &self,
        request_id: &str,
        options: &[acp::PermissionOption],
    ) -> PermissionOutcome {
        let (tx, rx) = oneshot::channel();

        {
            let mut pending = self.pending.lock().await;
            pending.insert(
                request_id.to_string(),
                PendingPermissionRequest {
                    respond_to: tx,
                    options: options
                        .iter()
                        .map(|option| StoredPermissionOption {
                            option_id: option.option_id.to_string(),
                            kind: StoredPermissionOptionKind::from_acp(option.kind),
                        })
                        .collect(),
                },
            );
        }

        rx.await.unwrap_or(PermissionOutcome::Cancelled)
    }

    pub async fn resolve_with_decision(
        &self,
        request_id: &str,
        decision: PermissionDecision,
    ) -> bool {
        let pending = {
            let mut pending = self.pending.lock().await;
            pending.remove(request_id)
        };

        let Some(pending) = pending else {
            return false;
        };

        let outcome = match decision {
            PermissionDecision::Allow => pick_option(
                &pending.options,
                &[
                    StoredPermissionOptionKind::AllowOnce,
                    StoredPermissionOptionKind::AllowAlways,
                ],
            )
            .map(|option_id| PermissionOutcome::Selected { option_id })
            .unwrap_or(PermissionOutcome::Cancelled),
            PermissionDecision::Deny => pick_option(
                &pending.options,
                &[
                    StoredPermissionOptionKind::RejectOnce,
                    StoredPermissionOptionKind::RejectAlways,
                ],
            )
            .map(|option_id| PermissionOutcome::Selected { option_id })
            .unwrap_or(PermissionOutcome::Cancelled),
        };

        let _ = pending.respond_to.send(outcome);
        true
    }

    pub async fn resolve_with_option_id(&self, request_id: &str, option_id: &str) -> bool {
        let pending = {
            let mut pending = self.pending.lock().await;
            let Some(request) = pending.get(request_id) else {
                return false;
            };
            if !request
                .options
                .iter()
                .any(|option| option.option_id == option_id)
            {
                return false;
            }
            pending.remove(request_id)
        };

        match pending {
            Some(pending) => {
                let _ = pending.respond_to.send(PermissionOutcome::Selected {
                    option_id: option_id.to_string(),
                });
                true
            }
            None => false,
        }
    }
}

fn pick_option(
    options: &[StoredPermissionOption],
    preferred_kinds: &[StoredPermissionOptionKind],
) -> Option<String> {
    preferred_kinds.iter().find_map(|kind| {
        options
            .iter()
            .find(|option| option.kind == *kind)
            .map(|option| option.option_id.clone())
    })
}

impl Clone for PermissionBroker {
    fn clone(&self) -> Self {
        Self {
            pending: self.pending.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(id: &str, kind: acp::PermissionOptionKind) -> acp::PermissionOption {
        acp::PermissionOption::new(id.to_string(), id.to_string(), kind)
    }

    #[tokio::test]
    async fn allow_prefers_allow_once() {
        let broker = PermissionBroker::new();
        let request_id = "req-1";
        let options = vec![
            option("allow-always", acp::PermissionOptionKind::AllowAlways),
            option("allow-once", acp::PermissionOptionKind::AllowOnce),
            option("reject-once", acp::PermissionOptionKind::RejectOnce),
        ];

        let task = {
            let broker = broker.clone();
            tokio::spawn(async move { broker.request_permission(request_id, &options).await })
        };
        tokio::task::yield_now().await;

        assert!(
            broker
                .resolve_with_decision(request_id, PermissionDecision::Allow)
                .await
        );

        let outcome = task.await.expect("task join");
        assert_eq!(
            outcome,
            PermissionOutcome::Selected {
                option_id: "allow-once".to_string(),
            }
        );
    }

    #[tokio::test]
    async fn deny_prefers_reject_once() {
        let broker = PermissionBroker::new();
        let request_id = "req-2";
        let options = vec![
            option("allow-once", acp::PermissionOptionKind::AllowOnce),
            option("reject-always", acp::PermissionOptionKind::RejectAlways),
            option("reject-once", acp::PermissionOptionKind::RejectOnce),
        ];

        let task = {
            let broker = broker.clone();
            tokio::spawn(async move { broker.request_permission(request_id, &options).await })
        };
        tokio::task::yield_now().await;

        assert!(
            broker
                .resolve_with_decision(request_id, PermissionDecision::Deny)
                .await
        );

        let outcome = task.await.expect("task join");
        assert_eq!(
            outcome,
            PermissionOutcome::Selected {
                option_id: "reject-once".to_string(),
            }
        );
    }

    #[tokio::test]
    async fn explicit_option_id_wins() {
        let broker = PermissionBroker::new();
        let request_id = "req-3";
        let options = vec![
            option("allow-once", acp::PermissionOptionKind::AllowOnce),
            option("allow-always", acp::PermissionOptionKind::AllowAlways),
        ];

        let task = {
            let broker = broker.clone();
            tokio::spawn(async move { broker.request_permission(request_id, &options).await })
        };
        tokio::task::yield_now().await;

        assert!(
            broker
                .resolve_with_option_id(request_id, "allow-always")
                .await
        );

        let outcome = task.await.expect("task join");
        assert_eq!(
            outcome,
            PermissionOutcome::Selected {
                option_id: "allow-always".to_string(),
            }
        );
    }
}
