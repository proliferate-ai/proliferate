use std::path::PathBuf;
use std::process::Command;

pub(super) fn built_cli_binary() -> PathBuf {
    let dependencies = std::env::current_exe()
        .expect("current test executable")
        .parent()
        .expect("target dependency directory")
        .to_path_buf();
    let mut candidates = std::fs::read_dir(dependencies)
        .expect("read target dependency directory")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("proliferate_debug-"))
        })
        .collect::<Vec<_>>();
    candidates.sort();
    candidates
        .into_iter()
        .find(|candidate| {
            Command::new(candidate)
                .arg("--version")
                .output()
                .map(|output| {
                    output.status.success()
                        && String::from_utf8_lossy(&output.stdout).starts_with("proliferate-debug ")
                })
                .unwrap_or(false)
        })
        .expect("Cargo-built proliferate-debug command binary")
}
