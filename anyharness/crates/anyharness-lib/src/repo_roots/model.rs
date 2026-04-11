#[derive(Debug, Clone)]
pub struct RepoRootRecord {
    pub id: String,
    pub kind: String,
    pub path: String,
    pub display_name: Option<String>,
    pub default_branch: Option<String>,
    pub remote_provider: Option<String>,
    pub remote_owner: Option<String>,
    pub remote_repo_name: Option<String>,
    pub remote_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateRepoRootInput {
    pub kind: String,
    pub path: String,
    pub display_name: Option<String>,
    pub default_branch: Option<String>,
    pub remote_provider: Option<String>,
    pub remote_owner: Option<String>,
    pub remote_repo_name: Option<String>,
    pub remote_url: Option<String>,
}
