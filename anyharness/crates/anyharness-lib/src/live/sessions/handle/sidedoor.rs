//! OpenCode side-door targeted-fork dispatch surface on `LiveSessionHandle`.
//!
//! A second `impl LiveSessionHandle` block, split out of `handle.rs` into this
//! child module so the parent stays under the 600-line cap after the rung-3
//! refold onto main (main independently grew `handle.rs` to the cap edge). As a
//! descendant module it legitimately reaches the parent's private `send_request`.

use crate::live::sessions::actor::command::{
    SessionCommand, SidedoorForkCommandError, SidedoorForkCommandResult,
};

use super::{LiveSessionCommandError, LiveSessionHandle};

impl LiveSessionHandle {
    /// Dispatch an OpenCode side-door targeted fork on the parent
    /// actor, which validates the vendor message id and POSTs the fork.
    pub async fn sidedoor_targeted_fork(
        &self,
        vendor_message_id: String,
    ) -> Result<SidedoorForkCommandResult, LiveSessionCommandError<SidedoorForkCommandError>> {
        self.send_request(|respond_to| SessionCommand::SidedoorTargetedFork {
            vendor_message_id,
            respond_to,
        })
        .await
    }
}
