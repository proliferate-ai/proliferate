use std::path::{Path, PathBuf};

use super::*;
use crate::domains::agents::installer::InstallOptions;

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "anyharness-agent-process-{prefix}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn managed_npm_install_leaves_catalog_default_args_for_runtime_spawn() {
    let package_root = TempDirGuard::new("package");
    write_test_npm_package(package_root.path(), "runtime-owned-args-agent");
    let runtime_home = TempDirGuard::new("runtime");
    let spec = AgentProcessArtifactSpec {
        install: AgentProcessInstallSpec::ManagedNpmPackage {
            package: format!("file:{}", package_root.path().display()),
            package_subdir: None,
            source_build_binary_name: None,
            executable_relpath: PathBuf::from("node_modules/.bin/runtime-owned-args-agent"),
        },
    };
    let default_args = vec!["--runtime-owned".to_string(), "value".to_string()];

    let installed = install_agent_process_artifact(
        &spec,
        &AgentKind::Codex,
        &default_args,
        runtime_home.path(),
        &InstallOptions::default(),
    )
    .expect("install agent process")
    .expect("installed artifact");
    let launcher = std::fs::read_to_string(installed.path).expect("read launcher");

    assert!(!launcher.contains("--runtime-owned"));
    assert!(!launcher.contains("value"));
    assert!(launcher.contains("\"$@\""));
}

fn write_test_npm_package(package_root: &Path, package_name: &str) {
    std::fs::create_dir_all(package_root.join("bin")).expect("create bin dir");
    std::fs::write(
        package_root.join("package.json"),
        format!(
            "{{\n  \"name\": \"{package_name}\",\n  \"version\": \"0.0.1\",\n  \"bin\": {{ \"{package_name}\": \"bin/{package_name}.js\" }},\n  \"files\": [\"bin\"]\n}}\n"
        ),
    )
    .expect("write package.json");
    std::fs::write(
        package_root.join("bin").join(format!("{package_name}.js")),
        "#!/usr/bin/env node\nconsole.log('ok');\n",
    )
    .expect("write bin");
}
