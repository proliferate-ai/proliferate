use super::error::ApiError;

pub(super) async fn run_blocking<T, E, F>(
    label: &'static str,
    f: F,
) -> Result<Result<T, E>, ApiError>
where
    T: Send + 'static,
    E: Send + 'static,
    F: FnOnce() -> Result<T, E> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| ApiError::internal(format!("{label} task failed: {e}")))
}
