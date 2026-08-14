use super::*;

pub(super) fn validate_workspace_creation(
    options: &WorkspaceCreationOptions,
    input: &CreateWorkspaceFromOptionsInput,
) -> Result<ValidatedWorkspaceCreation, WorkspaceOptionsError> {
    let repository_id = input.repository_id.trim();
    let repository = options
        .repository(repository_id)
        .ok_or_else(|| WorkspaceOptionsError::RepositoryNotFound(repository_id.to_string()))?;
    if !repository.availability.is_present() {
        return Err(WorkspaceOptionsError::RepositoryUnavailable {
            repository_id: repository_id.to_string(),
            availability: repository.availability.clone(),
        });
    }

    let creation_mode = WorkspaceCreationMode::parse(&input.creation_mode)?;
    let branch = match creation_mode {
        WorkspaceCreationMode::Worktree => {
            let branch = input
                .branch
                .as_deref()
                .map(str::trim)
                .filter(|branch| !branch.is_empty())
                .ok_or(WorkspaceOptionsError::BranchRequired)?;
            validate_new_branch(branch).map_err(WorkspaceOptionsError::InvalidBranch)?;
            Some(branch.to_string())
        }
        WorkspaceCreationMode::Local => {
            if input.branch.is_some() {
                return Err(WorkspaceOptionsError::BranchNotAllowed);
            }
            None
        }
    };
    let display_name = normalize_workspace_display_name(input.display_name.as_deref())
        .map_err(map_display_name_error)?;

    Ok(ValidatedWorkspaceCreation {
        repository_id: repository_id.to_string(),
        creation_mode,
        branch,
        display_name,
    })
}

fn validate_new_branch(branch: &str) -> Result<(), String> {
    if branch.starts_with('-') {
        return Err("branch name must not begin with '-'".into());
    }
    if branch == "HEAD" {
        return Err("branch name must not be 'HEAD'".into());
    }
    if branch.starts_with('/') || branch.ends_with('/') || branch.contains("//") {
        return Err("branch name has an invalid '/' component".into());
    }
    if branch.ends_with('.') || branch.contains("..") {
        return Err("branch name must not contain '..' or end with '.'".into());
    }
    if branch.contains("@{") || branch == "@" {
        return Err("branch name contains a forbidden ref sequence".into());
    }
    for component in branch.split('/') {
        if component.starts_with('.') || component.ends_with(".lock") {
            return Err("branch name has an invalid component".into());
        }
    }
    if branch.chars().any(|character| {
        character.is_ascii_control()
            || matches!(
                character,
                ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\' | '\u{7f}'
            )
    }) {
        return Err("branch name contains a forbidden character".into());
    }
    Ok(())
}

pub(super) fn map_display_name_error(error: SetWorkspaceDisplayNameError) -> WorkspaceOptionsError {
    match error {
        SetWorkspaceDisplayNameError::TooLong(limit) => {
            WorkspaceOptionsError::DisplayNameTooLong(limit)
        }
        SetWorkspaceDisplayNameError::NotFound(workspace_id) => {
            WorkspaceOptionsError::WorkspaceNotFound(workspace_id)
        }
        SetWorkspaceDisplayNameError::Unexpected(error) => WorkspaceOptionsError::Create(error),
    }
}
