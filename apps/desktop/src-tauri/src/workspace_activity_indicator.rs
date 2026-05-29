use serde::Deserialize;
use std::sync::Mutex;

#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::NSApplication;
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;
#[cfg(target_os = "macos")]
use tauri::Manager;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceActivityIndicatorState {
    Idle,
    Attention,
}

#[derive(Debug, Default)]
struct WorkspaceActivityIndicatorCache {
    state: Option<WorkspaceActivityIndicatorState>,
    attention_count: Option<u32>,
}

impl WorkspaceActivityIndicatorCache {
    fn needs_update(
        &self,
        state: WorkspaceActivityIndicatorState,
        attention_count: Option<u32>,
    ) -> bool {
        self.state != Some(state) || self.attention_count != attention_count
    }

    fn remember(&mut self, state: WorkspaceActivityIndicatorState, attention_count: Option<u32>) {
        self.state = Some(state);
        self.attention_count = attention_count;
    }
}

#[derive(Debug, Default)]
pub struct WorkspaceActivityIndicatorStore {
    cache: Mutex<WorkspaceActivityIndicatorCache>,
}

impl WorkspaceActivityIndicatorStore {
    #[cfg(target_os = "macos")]
    fn apply_macos_dock_badge(
        state: WorkspaceActivityIndicatorState,
        attention_count: Option<u32>,
        mtm: MainThreadMarker,
    ) -> Result<(), String> {
        let app = NSApplication::sharedApplication(mtm);
        let dock_tile = app.dockTile();
        match dock_badge_label(state, attention_count) {
            Some(label) => {
                let label = NSString::from_str(&label);
                dock_tile.setBadgeLabel(Some(&label));
            }
            None => dock_tile.setBadgeLabel(None),
        }
        dock_tile.display();
        Ok(())
    }

    fn cached_payload_or_default(
        &self,
    ) -> Result<(WorkspaceActivityIndicatorState, Option<u32>), String> {
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| "workspace activity indicator cache lock poisoned".to_string())?;
        let state = cache.state.unwrap_or(WorkspaceActivityIndicatorState::Idle);
        let attention_count = cache.attention_count;
        cache.remember(state, attention_count);
        Ok((state, attention_count))
    }
}

pub fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let store = app.state::<WorkspaceActivityIndicatorStore>();
        let mtm = MainThreadMarker::new().ok_or_else(|| {
            std::io::Error::other("workspace activity indicator setup must run on the main thread")
        })?;
        let (state, attention_count) = store
            .cached_payload_or_default()
            .map_err(std::io::Error::other)?;
        WorkspaceActivityIndicatorStore::apply_macos_dock_badge(state, attention_count, mtm)
            .map_err(std::io::Error::other)?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_workspace_activity_indicator(
    app: tauri::AppHandle,
    store: tauri::State<'_, WorkspaceActivityIndicatorStore>,
    state: WorkspaceActivityIndicatorState,
    attention_count: Option<u32>,
) -> Result<(), String> {
    let mut cache = store
        .cache
        .lock()
        .map_err(|_| "workspace activity indicator cache lock poisoned".to_string())?;
    if !cache.needs_update(state, attention_count) {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let result = MainThreadMarker::new()
                .ok_or_else(|| {
                    "workspace activity indicator update must run on the main thread".to_string()
                })
                .and_then(|mtm| {
                    WorkspaceActivityIndicatorStore::apply_macos_dock_badge(
                        state,
                        attention_count,
                        mtm,
                    )
                });
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
        receiver
            .recv()
            .map_err(|_| "workspace activity indicator update did not complete".to_string())??;
        tracing::info!(
            ?state,
            attention_count = attention_count.unwrap_or(0),
            "updated workspace activity Dock badge"
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }

    cache.remember(state, attention_count);
    Ok(())
}

fn dock_badge_label(
    state: WorkspaceActivityIndicatorState,
    attention_count: Option<u32>,
) -> Option<String> {
    match state {
        WorkspaceActivityIndicatorState::Idle => None,
        WorkspaceActivityIndicatorState::Attention => {
            Some(attention_count.unwrap_or(1).max(1).to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_known_indicator_states() {
        let idle: WorkspaceActivityIndicatorState = serde_json::from_str("\"idle\"").unwrap();
        let attention: WorkspaceActivityIndicatorState =
            serde_json::from_str("\"attention\"").unwrap();

        assert_eq!(idle, WorkspaceActivityIndicatorState::Idle);
        assert_eq!(attention, WorkspaceActivityIndicatorState::Attention);
    }

    #[test]
    fn rejects_unknown_indicator_states() {
        let parsed = serde_json::from_str::<WorkspaceActivityIndicatorState>("\"busy\"");

        assert!(parsed.is_err());
    }

    #[test]
    fn repeated_identical_state_does_not_need_an_update() {
        let mut cache = WorkspaceActivityIndicatorCache::default();

        assert!(cache.needs_update(WorkspaceActivityIndicatorState::Idle, None));
        cache.remember(WorkspaceActivityIndicatorState::Idle, Some(0));

        assert!(!cache.needs_update(WorkspaceActivityIndicatorState::Idle, Some(0)));
        assert!(cache.needs_update(WorkspaceActivityIndicatorState::Attention, Some(1)));
    }

    #[test]
    fn formats_dock_badge_label() {
        assert_eq!(
            dock_badge_label(WorkspaceActivityIndicatorState::Idle, Some(3)),
            None
        );
        assert_eq!(
            dock_badge_label(WorkspaceActivityIndicatorState::Attention, Some(3)),
            Some("3".to_string())
        );
        assert_eq!(
            dock_badge_label(WorkspaceActivityIndicatorState::Attention, Some(0)),
            Some("1".to_string())
        );
    }
}
