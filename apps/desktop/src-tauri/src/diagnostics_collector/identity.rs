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

/// Records the signed-in user's id (or `None` on sign-out). Applied to the
/// next collector launch or restart; a running collector keeps the value it
/// was spawned with.
pub(crate) fn set_current_user_id(user_id: Option<String>) {
    *cell() = user_id.filter(|value| !value.trim().is_empty());
}

/// The id to hand the collector at spawn: the live value if the auth commands
/// have set one this process, else whatever session the secret file holds.
pub(crate) fn current_user_id() -> Option<String> {
    if let Some(user_id) = cell().clone() {
        return Some(user_id);
    }
    crate::commands::keychain::read_auth_session_user_id()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_live_value_wins_and_blank_values_clear() {
        set_current_user_id(Some("user-77a1".to_owned()));
        assert_eq!(cell().as_deref(), Some("user-77a1"));
        set_current_user_id(Some("   ".to_owned()));
        assert!(cell().is_none(), "a blank id is a sign-out, not an attribute");
        set_current_user_id(None);
        assert!(cell().is_none());
    }
}
