//! Fork commands on [`LiveSessionHandle`].

use super::{
    ForkSessionCommandError, ForkSessionCommandResult, LiveSessionCommandError, LiveSessionHandle,
};
use crate::domains::sessions::runtime::fork_anchor::ProviderForkAnchor;
use crate::live::sessions::actor::command::SessionCommand;

impl LiveSessionHandle {
    pub async fn verify_fork_ready(
        &self,
        requires_targeted_fork: bool,
    ) -> Result<(), LiveSessionCommandError<ForkSessionCommandError>> {
        self.send_request(|respond_to| SessionCommand::VerifyForkReady {
            requires_targeted_fork,
            respond_to,
        })
        .await
    }

    pub async fn fork(
        &self,
        provider_anchor: Option<ProviderForkAnchor>,
    ) -> Result<ForkSessionCommandResult, LiveSessionCommandError<ForkSessionCommandError>> {
        self.send_request(|respond_to| SessionCommand::Fork {
            provider_anchor,
            respond_to,
        })
        .await
    }
}
