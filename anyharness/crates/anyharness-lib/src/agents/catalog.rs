use crate::agents::model::{ModelRegistryMetadata, ModelRegistryModelMetadata};

/// Returns the backend-owned per-harness model registry catalog exposed by AnyHarness.
pub fn model_registries() -> Vec<ModelRegistryMetadata> {
    vec![
        claude_registry(),
        codex_registry(),
        gemini_registry(),
        cursor_registry(),
        opencode_registry(),
        amp_registry(),
    ]
}

fn registry(
    kind: &str,
    display_name: &str,
    models: Vec<ModelRegistryModelMetadata>,
) -> ModelRegistryMetadata {
    let default_model_id = models
        .iter()
        .find(|model| model.is_default)
        .map(|model| model.id.clone());

    ModelRegistryMetadata {
        kind: kind.into(),
        display_name: display_name.into(),
        default_model_id,
        models,
    }
}

fn model(
    id: &str,
    name: &str,
    description: Option<&str>,
    is_default: bool,
) -> ModelRegistryModelMetadata {
    ModelRegistryModelMetadata {
        id: id.into(),
        display_name: name.into(),
        description: description.map(str::to_string),
        is_default,
    }
}

fn claude_registry() -> ModelRegistryMetadata {
    registry(
        "claude",
        "Claude",
        vec![
            model(
                "sonnet",
                "Sonnet",
                Some("Sonnet 4.6 · Best for everyday tasks"),
                true,
            ),
            model(
                "sonnet[1m]",
                "Sonnet (1M context)",
                Some("Sonnet 4.6 with 1M context · Billed as extra usage · $3/$15 per Mtok"),
                false,
            ),
            model(
                "opus[1m]",
                "Opus (1M context)",
                Some("Opus 4.6 with 1M context · Most capable for complex work"),
                false,
            ),
            model(
                "haiku",
                "Haiku",
                Some("Haiku 4.5 · Fastest for quick answers"),
                false,
            ),
        ],
    )
}

fn codex_registry() -> ModelRegistryMetadata {
    registry(
        "codex",
        "Codex",
        vec![
            model("gpt-5.4", "GPT 5.4", None, true),
            model("gpt-5.4-mini", "GPT 5.4 Mini", None, false),
            model("gpt-5.3-codex", "GPT 5.3 Codex", None, false),
            model("gpt-5.3-codex-spark", "GPT 5.3 Codex Spark", None, false),
            model("gpt-5.2-codex", "GPT 5.2 Codex", None, false),
            model("gpt-5.1-codex-max", "GPT 5.1 Codex Max", None, false),
            model("gpt-5.2", "GPT 5.2", None, false),
            model("gpt-5.1-codex-mini", "GPT 5.1 Codex Mini", None, false),
        ],
    )
}

fn gemini_registry() -> ModelRegistryMetadata {
    registry(
        "gemini",
        "Gemini",
        vec![
            model("auto-gemini-2.5", "Auto (Gemini 2.5)", None, true),
            model("gemini-2.5-pro", "Gemini 2.5 Pro", None, false),
            model("gemini-2.5-flash", "Gemini 2.5 Flash", None, false),
            model(
                "gemini-2.5-flash-lite",
                "Gemini 2.5 Flash Lite",
                None,
                false,
            ),
            model("auto-gemini-3", "Auto (Gemini 3)", None, false),
            model("gemini-3-flash-preview", "Gemini 3 Flash", None, false),
            model("gemini-3.1-pro-preview", "Gemini 3.1 Pro", None, false),
        ],
    )
}

fn cursor_registry() -> ModelRegistryMetadata {
    registry(
        "cursor",
        "Cursor",
        vec![
            model("default[]", "Auto", None, true),
            model("composer-2[fast=true]", "Composer 2", None, false),
            model("composer-1.5[]", "Composer 1.5", None, false),
            model(
                "claude-opus-4-6[thinking=true,context=200k,effort=high,fast=false]",
                "Opus 4.6",
                None,
                false,
            ),
            model(
                "claude-sonnet-4-6[thinking=true,context=200k,effort=medium]",
                "Sonnet 4.6",
                None,
                false,
            ),
            model(
                "gpt-5.4[reasoning=medium,context=272k,fast=false]",
                "GPT 5.4",
                None,
                false,
            ),
            model(
                "gpt-5.3-codex[reasoning=medium,fast=false]",
                "Codex 5.3",
                None,
                false,
            ),
            model("gemini-3.1-pro[]", "Gemini 3.1 Pro", None, false),
            model("claude-opus-4-5[thinking=true]", "Opus 4.5", None, false),
            model(
                "gpt-5.2[reasoning=medium,fast=false]",
                "GPT 5.2",
                None,
                false,
            ),
            model(
                "gpt-5.4-mini[reasoning=medium]",
                "GPT 5.4 Mini",
                None,
                false,
            ),
            model("claude-haiku-4-5[thinking=true]", "Haiku 4.5", None, false),
            model(
                "claude-sonnet-4-5[thinking=true,context=200k]",
                "Sonnet 4.5",
                None,
                false,
            ),
        ],
    )
}

fn opencode_registry() -> ModelRegistryMetadata {
    registry(
        "opencode",
        "OpenCode",
        vec![
            model("opencode/big-pickle", "Big Pickle", None, true),
            model("opencode/claude-opus-4-6", "Claude Opus 4.6", None, false),
            model(
                "opencode/claude-sonnet-4-5",
                "Claude Sonnet 4.5",
                None,
                false,
            ),
            model("opencode/gpt-5.3-codex", "GPT 5.3 Codex", None, false),
            model("opencode/gemini-3-pro", "Gemini 3 Pro", None, false),
        ],
    )
}

fn amp_registry() -> ModelRegistryMetadata {
    registry(
        "amp",
        "Amp",
        vec![model("amp-default", "Amp Default", None, true)],
    )
}

#[cfg(test)]
mod tests {
    use super::model_registries;

    #[test]
    fn claude_registry_uses_session_selector_ids() {
        let claude = model_registries()
            .into_iter()
            .find(|config| config.kind == "claude")
            .expect("claude registry");

        let ids = claude
            .models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>();
        let labels = claude
            .models
            .iter()
            .map(|model| (model.id.as_str(), model.display_name.as_str()))
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["sonnet", "sonnet[1m]", "opus[1m]", "haiku"]);
        assert_eq!(claude.default_model_id.as_deref(), Some("sonnet"));
        assert!(labels.contains(&("sonnet", "Sonnet")));
        assert!(labels.contains(&("opus[1m]", "Opus (1M context)")));
    }

    #[test]
    fn codex_registry_uses_clean_gpt_spacing() {
        let codex = model_registries()
            .into_iter()
            .find(|config| config.kind == "codex")
            .expect("codex registry");

        let labels = codex
            .models
            .iter()
            .map(|model| (model.id.as_str(), model.display_name.as_str()))
            .collect::<Vec<_>>();

        assert!(labels.contains(&("gpt-5.4", "GPT 5.4")));
        assert!(labels.contains(&("gpt-5.2", "GPT 5.2")));
        assert!(labels.contains(&("gpt-5.3-codex", "GPT 5.3 Codex")));
    }
}
