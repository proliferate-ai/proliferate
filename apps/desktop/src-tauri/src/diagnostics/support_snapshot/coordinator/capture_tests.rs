use std::sync::Arc;

use tokio::sync::Barrier;

use super::join_concurrently;

#[tokio::test]
async fn export_health_child_and_file_futures_reach_one_start_latch() {
    let latch = Arc::new(Barrier::new(5));
    let source = |name: &'static str| {
        let latch = Arc::clone(&latch);
        async move {
            latch.wait().await;
            name
        }
    };

    let joined = join_concurrently(
        source("export"),
        source("health"),
        source("child"),
        source("files"),
    );
    let released = async {
        latch.wait().await;
    };
    let ((export, health, child, files), ()) = tokio::join!(joined, released);
    assert_eq!(
        (export, health, child, files),
        ("export", "health", "child", "files")
    );
}
