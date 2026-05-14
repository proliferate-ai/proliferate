use tracing::info;

use crate::update::staging::StagedArtifact;

pub fn artifact_staged(artifact: &StagedArtifact) {
    info!(
        component = %artifact.component,
        version = %artifact.version,
        path = %artifact.path.display(),
        "supervisor staged update artifact"
    );
}
