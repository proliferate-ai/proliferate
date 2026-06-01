pub use crate::domains::artifacts::manifest::{
    artifact_type_from_path, enrich_manifest_entry, load_manifest_if_present,
    load_manifest_or_empty, manifest_path, validate_manifest, validate_relative_artifact_path,
    ArtifactManifestDocument, ArtifactManifestEntry,
    ARTIFACT_MANIFEST_RELATIVE_PATH as COWORK_ARTIFACT_MANIFEST_RELATIVE_PATH,
    ARTIFACT_MANIFEST_VERSION as COWORK_ARTIFACT_MANIFEST_VERSION,
};
pub use crate::domains::artifacts::model::{
    ArtifactError as CoworkArtifactError, ArtifactSummary as CoworkArtifactSummary,
    ArtifactType as CoworkArtifactType,
};
