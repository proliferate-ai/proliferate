//! The signed-in user's id as the collector host knows it.
//!
//! The collector stamps `proliferate.user_id` on exported records only from a
//! value its host passes at spawn (`--user-id`), the same rule as
//! `--install-id`: passed in, never derived, absent when nobody is signed in.
//! This module is the host's one source for that value. The auth commands
//! update it as sessions are stored and cleared; a launch that happens before
//! the renderer has restored a session falls back to the persisted session
//! file, so a fresh app start still stamps the user who was signed in.

use std::sync::Mutex;

static CURRENT_USER_ID: Mutex<Option<String>> = Mutex::new(None);

fn cell() -> std::sync::MutexGuard<'static, Option<String>> {
    CURRENT_USER_ID
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Records the signed-in user's id (or `None` on sign-out) and reports
/// whether the value changed. The collector reads the cell at every launch,
/// so a change is only visible after a restart — [`apply_auth_change`] is the
/// pair that performs one.
pub(crate) fn set_current_user_id(user_id: Option<String>) -> bool {
    let next = user_id.filter(|value| !value.trim().is_empty());
    let mut current = cell();
    let changed = *current != next;
    *current = next;
    changed
}

/// The auth commands' entry: records the id and, when it actually changed
/// (a token refresh re-stores the same session and must not bounce the
/// collector), restarts the collector so the stamp tracks the signed-in
/// user — sign-in gains the attribute without an app relaunch, sign-out
/// stops the old id from being stamped.
pub(crate) fn apply_auth_change(app: &tauri::AppHandle, user_id: Option<String>) {
    use tauri::Manager;
    if !set_current_user_id(user_id) {
        return;
    }
    let supervisor = app
        .state::<std::sync::Arc<crate::diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor>>()
        .inner()
        .clone();
    tauri::async_runtime::spawn(async move {
        let _ = supervisor.stop_collector().await;
        let _ = supervisor.start().await;
    });
}

/// The id to hand the collector at spawn: the live value if the auth commands
/// have set one this process, else whatever session the secret file holds (a
/// fresh app start stamps the user who was signed in). Tests never read the
/// developer's real session file.
pub(crate) fn current_user_id() -> Option<String> {
    if let Some(user_id) = cell().clone() {
        return Some(user_id);
    }
    #[cfg(test)]
    {
        None
    }
    #[cfg(not(test))]
    {
        crate::commands::keychain::read_auth_session_user_id()
    }
}

/// Serializes tests that touch the process-global cell (the identity unit
/// test and the collector-launch seam test share one static).
#[cfg(test)]
pub(crate) fn test_identity_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_live_value_wins_blank_clears_and_change_detection_debounces() {
        let _guard = test_identity_lock();
        set_current_user_id(None);
        assert!(set_current_user_id(Some("user-77a1".to_owned())), "first set is a change");
        assert_eq!(cell().as_deref(), Some("user-77a1"));
        assert!(
            !set_current_user_id(Some("user-77a1".to_owned())),
            "a token refresh re-storing the same user is not a change and must not bounce the collector"
        );
        assert!(set_current_user_id(Some("   ".to_owned())), "a blank id is a sign-out");
        assert!(cell().is_none());
        assert!(!set_current_user_id(None), "already signed out");
    }
}
