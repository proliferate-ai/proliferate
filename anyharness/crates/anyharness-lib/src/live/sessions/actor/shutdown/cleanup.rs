use crate::live::sessions::actor::*;

pub(in crate::live::sessions::actor) fn interaction_resolution_for_exit(
    disposition: &ActorExitDisposition,
) -> InteractionResolution {
    match disposition {
        ActorExitDisposition::Dismiss => InteractionResolution::Dismissed,
        ActorExitDisposition::Error { .. } | ActorExitDisposition::Close => {
            InteractionResolution::Cancelled
        }
    }
}
