use std::sync::Mutex;

use agent_client_protocol as acp;

const MAX_BUFFERED_FORK_NOTIFICATIONS: usize = 128;
const MAX_BUFFERED_FORK_NOTIFICATION_BYTES: usize = 256 * 1024;

/// Linearizable routing state for one ACP process. The process-local fork
/// epoch is installed before the transport starts, quarantines parent replay,
/// and does not admit child requests until durable startup has finalized.
pub(super) struct ForkInboundEpoch {
    state: Mutex<ForkInboundState>,
}

enum ForkInboundState {
    Ordinary,
    Hydrating {
        parent_native_session_id: String,
        startup_fault: bool,
    },
    ForkPending {
        parent_native_session_id: String,
        startup_fault: bool,
        buffered: Vec<acp::schema::SessionNotification>,
        buffered_bytes: usize,
    },
    ChildStarting {
        parent_native_session_id: String,
        child_native_session_id: String,
        startup_fault: bool,
    },
    ReadyChild {
        #[allow(dead_code)]
        // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
        parent_native_session_id: String,
        child_native_session_id: String,
    },
    Closed,
}

pub(super) enum NotificationRoute {
    Admit(acp::schema::SessionNotification),
    Buffered,
    Quarantine,
    RejectStartup,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RequestRoute {
    Admit,
    Quarantine,
}

impl Default for ForkInboundEpoch {
    fn default() -> Self {
        Self {
            state: Mutex::new(ForkInboundState::Ordinary),
        }
    }
}

impl ForkInboundEpoch {
    pub(super) fn prepare_hydration(&self, parent_native_session_id: &str) -> anyhow::Result<()> {
        anyhow::ensure!(
            !parent_native_session_id.trim().is_empty(),
            "process-local fork parent id is empty"
        );
        let mut state = self.lock();
        anyhow::ensure!(
            matches!(*state, ForkInboundState::Ordinary),
            "process-local fork inbound epoch was already installed"
        );
        *state = ForkInboundState::Hydrating {
            parent_native_session_id: parent_native_session_id.to_string(),
            startup_fault: false,
        };
        Ok(())
    }

    /// Advances to the only state in which an as-yet-unknown child id may
    /// produce notifications. This transition happens after parent load is
    /// proven clean and before the durable dispatch claim and wire call.
    pub(super) fn begin_fork_pending(&self) -> anyhow::Result<()> {
        let mut state = self.lock();
        let ForkInboundState::Hydrating {
            parent_native_session_id,
            startup_fault,
        } = &*state
        else {
            anyhow::bail!("process-local fork hydration epoch is unavailable");
        };
        anyhow::ensure!(
            !startup_fault,
            "process-local fork hydration epoch is faulted"
        );
        *state = ForkInboundState::ForkPending {
            parent_native_session_id: parent_native_session_id.clone(),
            startup_fault: false,
            buffered: Vec::new(),
            buffered_bytes: 0,
        };
        Ok(())
    }

    /// Called from ACP `on_receiving_result`. The callback blocks the ACP
    /// dispatch loop while the exact child id is installed and candidate
    /// notifications are selected, so no later child frame can race under the
    /// unknown-id epoch. The caller flushes the returned frames in order before
    /// releasing the callback.
    pub(super) fn adopt_child(
        &self,
        child_native_session_id: &str,
    ) -> anyhow::Result<Vec<acp::schema::SessionNotification>> {
        anyhow::ensure!(
            !child_native_session_id.trim().is_empty(),
            "process-local fork child id is empty"
        );
        let mut state = self.lock();
        let prior = std::mem::replace(&mut *state, ForkInboundState::Closed);
        let ForkInboundState::ForkPending {
            parent_native_session_id,
            startup_fault,
            buffered,
            ..
        } = prior
        else {
            *state = prior;
            anyhow::bail!("process-local fork child adoption missed pending epoch");
        };
        if child_native_session_id == parent_native_session_id {
            anyhow::bail!("process-local fork returned its parent id");
        }

        let mut selected = Vec::with_capacity(buffered.len());
        let mut unexpected_candidate = false;
        for notification in buffered {
            if notification.session_id.to_string() == child_native_session_id {
                selected.push(notification);
            } else {
                unexpected_candidate = true;
            }
        }
        let startup_fault = startup_fault || unexpected_candidate;
        *state = ForkInboundState::ChildStarting {
            parent_native_session_id,
            child_native_session_id: child_native_session_id.to_string(),
            startup_fault,
        };
        anyhow::ensure!(
            !startup_fault,
            "process-local fork candidate buffer contained an unexpected session"
        );
        Ok(selected)
    }

    /// Holds the routing mutex across the synchronous durable transition and
    /// the ReadyChild publication. No inbound request can poison startup
    /// between the final clean check and the completed/ready state change.
    pub(super) fn finalize_ready(
        &self,
        finalize: impl FnOnce() -> anyhow::Result<()>,
    ) -> anyhow::Result<()> {
        let mut state = self.lock();
        let ForkInboundState::ChildStarting {
            parent_native_session_id,
            child_native_session_id,
            startup_fault,
        } = &*state
        else {
            anyhow::bail!("process-local fork child is not starting");
        };
        anyhow::ensure!(
            !*startup_fault,
            "process-local fork child startup is faulted"
        );
        let parent_native_session_id = parent_native_session_id.clone();
        let child_native_session_id = child_native_session_id.clone();
        finalize()?;
        *state = ForkInboundState::ReadyChild {
            parent_native_session_id,
            child_native_session_id,
        };
        Ok(())
    }

    pub(super) fn close(&self) {
        *self.lock() = ForkInboundState::Closed;
    }

    pub(super) fn route_notification(
        &self,
        notification: acp::schema::SessionNotification,
    ) -> NotificationRoute {
        let native_session_id = notification.session_id.to_string();
        let mut state = self.lock();
        match &mut *state {
            ForkInboundState::Ordinary => NotificationRoute::Admit(notification),
            ForkInboundState::Hydrating {
                parent_native_session_id,
                startup_fault,
            } => {
                if native_session_id == *parent_native_session_id {
                    NotificationRoute::Quarantine
                } else {
                    *startup_fault = true;
                    NotificationRoute::RejectStartup
                }
            }
            ForkInboundState::ForkPending {
                parent_native_session_id,
                startup_fault,
                buffered,
                buffered_bytes,
            } => {
                if native_session_id == *parent_native_session_id {
                    return NotificationRoute::Quarantine;
                }
                let Some(encoded_bytes) = serde_json::to_vec(&notification).ok().map(|v| v.len())
                else {
                    *startup_fault = true;
                    return NotificationRoute::RejectStartup;
                };
                if buffered.len() >= MAX_BUFFERED_FORK_NOTIFICATIONS
                    || buffered_bytes.saturating_add(encoded_bytes)
                        > MAX_BUFFERED_FORK_NOTIFICATION_BYTES
                {
                    *startup_fault = true;
                    NotificationRoute::RejectStartup
                } else {
                    *buffered_bytes += encoded_bytes;
                    buffered.push(notification);
                    NotificationRoute::Buffered
                }
            }
            ForkInboundState::ChildStarting {
                parent_native_session_id,
                child_native_session_id,
                startup_fault,
            } => {
                if native_session_id == *child_native_session_id {
                    NotificationRoute::Admit(notification)
                } else if native_session_id == *parent_native_session_id {
                    NotificationRoute::Quarantine
                } else {
                    *startup_fault = true;
                    NotificationRoute::RejectStartup
                }
            }
            ForkInboundState::ReadyChild {
                child_native_session_id,
                ..
            } => {
                if native_session_id == *child_native_session_id {
                    NotificationRoute::Admit(notification)
                } else {
                    NotificationRoute::Quarantine
                }
            }
            ForkInboundState::Closed => NotificationRoute::Quarantine,
        }
    }

    /// Agent-initiated requests are never replay material. Every request is
    /// denied before the child becomes ready. Once ready, only an exactly
    /// scoped child request is admitted; parent, unknown, and unscoped traffic
    /// stays permanently quarantined without poisoning the live child.
    pub(super) fn route_request(&self, native_session_id: Option<&str>) -> RequestRoute {
        let mut state = self.lock();
        match &mut *state {
            ForkInboundState::Ordinary => RequestRoute::Admit,
            ForkInboundState::Hydrating { startup_fault, .. }
            | ForkInboundState::ForkPending { startup_fault, .. }
            | ForkInboundState::ChildStarting { startup_fault, .. } => {
                *startup_fault = true;
                RequestRoute::Quarantine
            }
            ForkInboundState::ReadyChild {
                child_native_session_id,
                ..
            } if native_session_id == Some(child_native_session_id.as_str()) => RequestRoute::Admit,
            ForkInboundState::ReadyChild { .. } | ForkInboundState::Closed => {
                RequestRoute::Quarantine
            }
        }
    }

    pub(super) fn ensure_startup_clean(&self) -> anyhow::Result<()> {
        let state = self.lock();
        let clean = match &*state {
            ForkInboundState::Ordinary | ForkInboundState::ReadyChild { .. } => true,
            ForkInboundState::Hydrating { startup_fault, .. }
            | ForkInboundState::ForkPending { startup_fault, .. }
            | ForkInboundState::ChildStarting { startup_fault, .. } => !startup_fault,
            ForkInboundState::Closed => false,
        };
        anyhow::ensure!(clean, "process-local fork inbound epoch is faulted");
        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ForkInboundState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notification(session_id: &str, text: &str) -> acp::schema::SessionNotification {
        acp::schema::SessionNotification::new(
            session_id.to_owned(),
            acp::schema::SessionUpdate::AgentMessageChunk(acp::schema::ContentChunk::new(
                text.into(),
            )),
        )
    }

    #[test]
    fn hydration_quarantines_parent_and_faults_other_sessions() {
        let epoch = ForkInboundEpoch::default();
        epoch.prepare_hydration("parent").expect("prepare");

        assert!(matches!(
            epoch.route_notification(notification("parent", "replay")),
            NotificationRoute::Quarantine
        ));
        assert!(epoch.ensure_startup_clean().is_ok());
        assert!(matches!(
            epoch.route_notification(notification("unknown", "unexpected")),
            NotificationRoute::RejectStartup
        ));
        assert!(epoch.ensure_startup_clean().is_err());
    }

    #[test]
    fn pending_epoch_buffers_and_flushes_exact_child_in_order() {
        let epoch = ForkInboundEpoch::default();
        epoch.prepare_hydration("parent").expect("prepare");
        epoch.begin_fork_pending().expect("pending");

        assert!(matches!(
            epoch.route_notification(notification("child", "first")),
            NotificationRoute::Buffered
        ));
        assert!(matches!(
            epoch.route_notification(notification("child", "second")),
            NotificationRoute::Buffered
        ));
        let selected = epoch.adopt_child("child").expect("adopt child");
        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0].session_id.to_string(), "child");
        assert_eq!(selected[1].session_id.to_string(), "child");
    }

    #[test]
    fn requests_are_denied_until_ready_then_require_exact_child() {
        let epoch = ForkInboundEpoch::default();
        epoch.prepare_hydration("parent").expect("prepare");
        epoch.begin_fork_pending().expect("pending");
        epoch.adopt_child("child").expect("adopt child");

        assert_eq!(epoch.route_request(Some("child")), RequestRoute::Quarantine);
        assert!(epoch.finalize_ready(|| Ok(())).is_err());

        let clean_epoch = ForkInboundEpoch::default();
        clean_epoch.prepare_hydration("parent").expect("prepare");
        clean_epoch.begin_fork_pending().expect("pending");
        clean_epoch.adopt_child("child").expect("adopt child");
        clean_epoch.finalize_ready(|| Ok(())).expect("ready");
        assert_eq!(
            clean_epoch.route_request(Some("child")),
            RequestRoute::Admit
        );
        assert_eq!(
            clean_epoch.route_request(Some("parent")),
            RequestRoute::Quarantine
        );
        assert_eq!(clean_epoch.route_request(None), RequestRoute::Quarantine);
        assert!(clean_epoch.ensure_startup_clean().is_ok());
    }

    #[test]
    fn ready_epoch_permanently_suppresses_parent_and_unknown_notifications() {
        let epoch = ForkInboundEpoch::default();
        epoch.prepare_hydration("parent").expect("prepare");
        epoch.begin_fork_pending().expect("pending");
        epoch.adopt_child("child").expect("adopt child");
        epoch.finalize_ready(|| Ok(())).expect("ready");

        assert!(matches!(
            epoch.route_notification(notification("parent", "late")),
            NotificationRoute::Quarantine
        ));
        assert!(matches!(
            epoch.route_notification(notification("unknown", "late")),
            NotificationRoute::Quarantine
        ));
        assert!(matches!(
            epoch.route_notification(notification("child", "current")),
            NotificationRoute::Admit(_)
        ));
        assert!(epoch.ensure_startup_clean().is_ok());
    }

    #[test]
    fn pending_candidate_buffer_is_bounded() {
        let epoch = ForkInboundEpoch::default();
        epoch.prepare_hydration("parent").expect("prepare");
        epoch.begin_fork_pending().expect("pending");
        for _ in 0..MAX_BUFFERED_FORK_NOTIFICATIONS {
            assert!(matches!(
                epoch.route_notification(notification("child", "candidate")),
                NotificationRoute::Buffered
            ));
        }
        assert!(matches!(
            epoch.route_notification(notification("child", "overflow")),
            NotificationRoute::RejectStartup
        ));
        assert!(epoch.ensure_startup_clean().is_err());
    }

    #[test]
    fn ordinary_sessions_preserve_unscoped_inbound_behavior() {
        let epoch = ForkInboundEpoch::default();

        assert!(matches!(
            epoch.route_notification(notification("any-native-id", "ordinary")),
            NotificationRoute::Admit(_)
        ));
        assert_eq!(epoch.route_request(None), RequestRoute::Admit);
        assert!(epoch.ensure_startup_clean().is_ok());
    }
}
