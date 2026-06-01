use std::path::Path;

use uuid::Uuid;

use super::manifest::{
    artifact_type_from_path, enrich_manifest_entry, validate_relative_artifact_path,
    ArtifactManifestDocument, ArtifactManifestEntry, ARTIFACT_MANIFEST_VERSION,
};
use super::model::{
    ArtifactDetail, ArtifactError, ArtifactManifest, ArtifactSummary, CreateArtifactInput,
    UpdateArtifactInput,
};

pub struct ArtifactCreatePlan {
    pub entry: ArtifactManifestEntry,
    pub content: String,
}

pub struct ArtifactUpdatePlan {
    pub entry: ArtifactManifestEntry,
    pub content: Option<String>,
}

pub struct ArtifactService;

impl ArtifactService {
    pub fn manifest_read_model(
        workspace_root: &Path,
        manifest: &ArtifactManifestDocument,
    ) -> ArtifactManifest {
        let mut artifacts: Vec<ArtifactSummary> = manifest
            .artifacts
            .values()
            .map(|entry| enrich_manifest_entry(workspace_root, entry))
            .collect();
        artifacts.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        ArtifactManifest {
            version: ARTIFACT_MANIFEST_VERSION,
            artifacts,
        }
    }

    pub fn artifact_detail(
        workspace_root: &Path,
        manifest: &ArtifactManifestDocument,
        artifact_id: &str,
    ) -> Result<ArtifactDetail, ArtifactError> {
        let entry = manifest
            .artifacts
            .get(artifact_id)
            .ok_or_else(|| ArtifactError::ArtifactNotFound(artifact_id.to_string()))?;
        let artifact = enrich_manifest_entry(workspace_root, entry);
        if !artifact.exists {
            return Err(ArtifactError::ArtifactFileInvalid(entry.path.clone()));
        }
        let content = std::fs::read_to_string(workspace_root.join(&entry.path))
            .map_err(|error| ArtifactError::ArtifactFileInvalid(error.to_string()))?;
        Ok(ArtifactDetail { artifact, content })
    }

    pub fn plan_create(
        manifest: &mut ArtifactManifestDocument,
        input: CreateArtifactInput,
    ) -> Result<ArtifactCreatePlan, ArtifactError> {
        validate_relative_artifact_path(&input.path)?;
        let artifact_type = artifact_type_from_path(&input.path)?;
        if manifest
            .artifacts
            .values()
            .any(|entry| entry.path == input.path)
        {
            return Err(ArtifactError::PathAlreadyRegistered(input.path));
        }

        let now = chrono::Utc::now().to_rfc3339();
        let entry = ArtifactManifestEntry {
            id: format!("art_{}", Uuid::new_v4().simple()),
            path: input.path,
            r#type: artifact_type,
            title: input.title.trim().to_string(),
            description: normalize_optional_text(input.description),
            created_at: now.clone(),
            updated_at: now,
        };
        manifest.artifacts.insert(entry.id.clone(), entry.clone());
        Ok(ArtifactCreatePlan {
            entry,
            content: input.content,
        })
    }

    pub fn plan_update(
        manifest: &mut ArtifactManifestDocument,
        input: UpdateArtifactInput,
    ) -> Result<ArtifactUpdatePlan, ArtifactError> {
        let current = manifest
            .artifacts
            .get(&input.id)
            .cloned()
            .ok_or_else(|| ArtifactError::ArtifactNotFound(input.id.clone()))?;

        let entry = ArtifactManifestEntry {
            id: current.id.clone(),
            path: current.path.clone(),
            r#type: current.r#type.clone(),
            title: input
                .title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| current.title.clone()),
            description: input
                .description
                .map(|value| normalize_optional_text(Some(value)))
                .unwrap_or_else(|| current.description.clone()),
            created_at: current.created_at.clone(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        manifest.artifacts.insert(entry.id.clone(), entry.clone());
        Ok(ArtifactUpdatePlan {
            entry,
            content: input.content,
        })
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
