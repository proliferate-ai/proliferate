use super::*;

/// House temp-dir idiom (no tempfile dev-dependency): unique dir under
/// the system temp root, removed on drop.
struct TempDir {
    path: std::path::PathBuf,
}

impl TempDir {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-native-integrations-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// A fixture mirroring the on-disk shape the desktop app provisions:
/// a home with Sky client, bundled plugin dirs, plugin cache, and a
/// separate vendor bin dir standing in for the `/Applications` path.
struct Fixture {
    home: TempDir,
    vendor: TempDir,
}

impl Fixture {
    fn provisioned(prefix: &str) -> Self {
        let fixture = Self {
            home: TempDir::new(&format!("{prefix}-home")),
            vendor: TempDir::new(&format!("{prefix}-vendor")),
        };
        std::fs::write(fixture.bin_dir().join("node_repl"), "#!/bin/sh\n").unwrap();
        std::fs::create_dir_all(sky_client_app(fixture.home())).unwrap();
        let cu_skills =
            bundled_plugin_dir(fixture.home(), "computer-use").join("skills/computer-use");
        std::fs::create_dir_all(&cu_skills).unwrap();
        std::fs::write(
            cu_skills.join("SKILL.md"),
            "Use `node_repl` (JavaScript) for all Computer Use actions.\n",
        )
        .unwrap();
        let chrome_skills =
            bundled_plugin_dir(fixture.home(), "chrome").join("skills/control-chrome");
        std::fs::create_dir_all(&chrome_skills).unwrap();
        std::fs::write(
            chrome_skills.join("SKILL.md"),
            "Drive Chrome through `node_repl`.\n",
        )
        .unwrap();
        std::fs::create_dir_all(plugin_cache_dir(fixture.home(), "chrome").join("1.0.0")).unwrap();
        fixture
    }

    fn home(&self) -> &Path {
        self.home.path()
    }

    fn bin_dir(&self) -> &Path {
        self.vendor.path()
    }

    fn write_config(&self, contents: &str) {
        std::fs::write(self.home().join(".codex/config.toml"), contents).unwrap();
    }

    fn discover(&self) -> Vec<NativeIntegration> {
        discover_codex_bundles(self.home(), self.bin_dir())
    }
}

fn stdio_env(integration: &NativeIntegration) -> Vec<(String, String)> {
    match integration.spawn.as_ref().expect("spawn") {
        NativeSpawn::Stdio { env, .. } => env.clone(),
        NativeSpawn::Http { .. } => panic!("bundle spawn must be stdio"),
    }
}

#[test]
fn both_bundles_list_for_codex_and_none_for_other_kinds() {
    let fixture = Fixture::provisioned("kinds");
    let listed = fixture.discover();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, "bundle:computer-use");
    assert_eq!(listed[0].risk, NativeIntegrationRisk::DesktopControl);
    assert_eq!(listed[1].id, "bundle:chrome");
    assert_eq!(listed[1].risk, NativeIntegrationRisk::BrowserControl);
    assert!(discover(&AgentKind::Claude, fixture.home()).is_empty());
}

#[test]
fn a_fully_provisioned_computer_use_bundle_is_available_and_spawns_the_node_repl_binary() {
    let fixture = Fixture::provisioned("available");
    let listed = fixture.discover();
    let computer_use = &listed[0];
    assert!(
        computer_use.available,
        "{:?}",
        computer_use.unavailable_reason
    );
    assert_eq!(computer_use.kind, NativeIntegrationKind::Bundle);
    match computer_use.spawn.as_ref().unwrap() {
        NativeSpawn::Stdio { command, args, .. } => {
            assert_eq!(
                command,
                &fixture.bin_dir().join("node_repl").display().to_string()
            );
            assert!(args.is_empty());
        }
        NativeSpawn::Http { .. } => panic!("bundle spawn must be stdio"),
    }
}

#[test]
fn a_missing_sky_client_makes_computer_use_unavailable_naming_the_missing_artifact() {
    let fixture = Fixture::provisioned("missing-sky");
    std::fs::remove_dir_all(sky_client_app(fixture.home())).unwrap();
    let listed = fixture.discover();
    let computer_use = &listed[0];
    assert!(!computer_use.available);
    let reason = computer_use.unavailable_reason.as_deref().unwrap();
    assert!(
        reason.starts_with("the Codex Computer Use client is not installed"),
        "reason was: {reason}"
    );
    assert!(computer_use.spawn.is_none());
    assert!(computer_use.skill_text.is_none());
}

#[test]
fn the_computer_use_bundle_passes_the_user_node_repl_env_table_through_verbatim() {
    let fixture = Fixture::provisioned("user-env");
    fixture.write_config(
        r#"
[mcp_servers.node_repl]
command = "/fixture/cua_node/bin/node_repl"

[mcp_servers.node_repl.env]
CODEX_HOME = "/fixture/.codex"
SKY_CUA_SERVICE_PATH = "/fixture/.codex/computer-use/Codex Computer Use.app"
"#,
    );
    let listed = fixture.discover();
    let env = stdio_env(&listed[0]);
    assert_eq!(
        env,
        vec![
            ("CODEX_HOME".to_string(), "/fixture/.codex".to_string()),
            (
                "SKY_CUA_SERVICE_PATH".to_string(),
                "/fixture/.codex/computer-use/Codex Computer Use.app".to_string()
            ),
        ]
    );
}

#[test]
fn without_a_user_env_table_the_fallback_env_is_derived_from_the_home_paths() {
    let fixture = Fixture::provisioned("fallback-env");
    let listed = fixture.discover();
    let env = stdio_env(&listed[0]);
    let get = |key: &str| {
        env.iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.clone())
            .unwrap_or_else(|| panic!("missing fallback key {key}"))
    };
    assert_eq!(
        get("CODEX_HOME"),
        fixture.home().join(".codex").display().to_string()
    );
    assert_eq!(
        get("SKY_CUA_SERVICE_PATH"),
        sky_client_app(fixture.home()).display().to_string()
    );
    assert_eq!(
        get("NODE_REPL_NODE_PATH"),
        fixture.bin_dir().join("node").display().to_string()
    );
    assert_eq!(
        get("NODE_REPL_TRUSTED_SERVICES"),
        r#"{"sky":"@oai/sky/service"}"#
    );
    assert_eq!(
        get("NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE"),
        "Control desktop apps on macOS through Computer Use."
    );
}

#[test]
fn each_bundle_skill_text_rewrites_node_repl_references_to_its_own_server_name() {
    let fixture = Fixture::provisioned("skill-rewrite");
    let listed = fixture.discover();
    let computer_use = listed[0].skill_text.as_deref().unwrap();
    assert!(computer_use.starts_with(COMPUTER_USE_SKILL_PREAMBLE));
    assert!(computer_use.contains("`cua_repl` (JavaScript)"));
    assert!(!computer_use.contains("node_repl"));
    let chrome = listed[1].skill_text.as_deref().unwrap();
    assert!(chrome.starts_with(CHROME_SKILL_PREAMBLE));
    assert!(chrome.contains("`browser_repl`"));
    assert!(!chrome.contains("node_repl"));
    assert!(
        !chrome.contains("cua_repl"),
        "the chrome skill must name its own server, not computer-use's"
    );
}

#[test]
fn bundle_ids_map_to_the_server_names_their_recipes_inject_under() {
    let fixture = Fixture::provisioned("id-name-map");
    for integration in fixture.discover() {
        assert!(
            server_name_for_bundle_id(&integration.id).is_some(),
            "no injected server name for {}",
            integration.id
        );
    }
    assert_eq!(
        server_name_for_bundle_id("bundle:computer-use"),
        Some(CUA_REPL_SERVER_NAME)
    );
    assert_eq!(
        server_name_for_bundle_id("bundle:chrome"),
        Some(BROWSER_REPL_SERVER_NAME)
    );
    assert_eq!(server_name_for_bundle_id("mcp:linear"), None);
}

/// Lay a cached browser plugin version dir (with its service script)
/// into the fixture home.
fn cache_browser_service(fixture: &Fixture, version: &str) {
    let version_dir = plugin_cache_dir(fixture.home(), "browser").join(version);
    std::fs::create_dir_all(version_dir.join("scripts")).unwrap();
    std::fs::write(
        version_dir.join("scripts/browser-service.mjs"),
        "// fixture\n",
    )
    .unwrap();
}

fn env_value(env: &[(String, String)], key: &str) -> String {
    env.iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.clone())
        .unwrap_or_else(|| panic!("missing env key {key}"))
}

#[test]
fn the_chrome_bundle_env_names_the_newest_cached_browser_service_by_numeric_version() {
    let fixture = Fixture::provisioned("chrome-browser-service");
    // 1.9.0 sorts after 1.10.0 lexically; the numeric comparison must
    // still pick 1.10.0 as newest.
    for version in ["1.0.0", "1.2.0", "1.10.0", "1.9.0"] {
        cache_browser_service(&fixture, version);
    }
    let listed = fixture.discover();
    let env = stdio_env(&listed[1]);
    let trusted = env_value(&env, "NODE_REPL_TRUSTED_SERVICES");
    assert!(
        trusted.contains("1.10.0/scripts/browser-service.mjs"),
        "{trusted}"
    );
    assert!(trusted.contains(r#""sky":"@oai/sky/service""#));
}

#[test]
fn a_non_numeric_version_dir_sorts_lexically_behind_every_numeric_one() {
    let fixture = Fixture::provisioned("chrome-non-numeric-version");
    // "zzz-nightly" would win a raw lexical sort; numeric dirs outrank it.
    for version in ["zzz-nightly", "1.2.0"] {
        cache_browser_service(&fixture, version);
    }
    let listed = fixture.discover();
    let trusted = env_value(&stdio_env(&listed[1]), "NODE_REPL_TRUSTED_SERVICES");
    assert!(
        trusted.contains("1.2.0/scripts/browser-service.mjs"),
        "{trusted}"
    );
}

#[test]
fn a_sky_only_user_env_table_still_yields_a_chrome_bundle_pointed_at_the_browser_service() {
    let fixture = Fixture::provisioned("chrome-env-precedence");
    cache_browser_service(&fixture, "1.4.0");
    // The desktop app's own table is sky-only: no browser keys at all.
    fixture.write_config(
        r#"
[mcp_servers.node_repl]
command = "/fixture/cua_node/bin/node_repl"

[mcp_servers.node_repl.env]
CODEX_HOME = "/fixture/.codex"
NODE_REPL_TRUSTED_SERVICES = '{"sky":"@oai/sky/service"}'
"#,
    );
    let listed = fixture.discover();
    let env = stdio_env(&listed[1]);
    // Base keys ride through from the user's table…
    assert_eq!(env_value(&env, "CODEX_HOME"), "/fixture/.codex");
    // …but the browser-specific keys are always the derived chrome set.
    let trusted = env_value(&env, "NODE_REPL_TRUSTED_SERVICES");
    assert!(
        trusted.contains("1.4.0/scripts/browser-service.mjs"),
        "{trusted}"
    );
    assert_eq!(env_value(&env, "BROWSER_USE_AVAILABLE_BACKENDS"), "chrome");
    assert_eq!(
        env.iter()
            .filter(|(name, _)| name == "NODE_REPL_TRUSTED_SERVICES")
            .count(),
        1,
        "the user's sky-only value must be replaced, not shadowed"
    );
}

#[test]
fn a_missing_chrome_plugin_cache_makes_the_chrome_bundle_unavailable() {
    let fixture = Fixture::provisioned("chrome-missing-cache");
    std::fs::remove_dir_all(plugin_cache_dir(fixture.home(), "chrome")).unwrap();
    let listed = fixture.discover();
    assert!(!listed[1].available);
    let reason = listed[1].unavailable_reason.as_deref().unwrap();
    assert!(
        reason.starts_with("the chrome plugin's cache is not installed"),
        "reason was: {reason}"
    );
}
