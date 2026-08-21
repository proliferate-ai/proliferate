//! Coverage for `app_config::home_dir_os`, the helper the two `expand_home_path`
//! callers use to turn a leading `~` into a real path.
//!
//! The whole point of that helper is that it reads the environment with
//! `var_os` rather than `var`. `std::env::var` rejects a non-UTF-8 value with
//! `VarError::NotUnicode`, so routing `~` expansion through it turns a working
//! latin-1 home directory on Linux or macOS into a spurious "HOME is not set".
//! A happy-path test would stay green under that regression and would be worse
//! than nothing, so the non-UTF-8 case is pinned explicitly below.
//!
//! Each case runs in a re-exec of this test binary rather than by mutating the
//! process environment in place. `cloud_worker::tests` calls
//! `app_config::home_dir().expect(..)` on two paths in this same binary, and
//! libtest runs tests on parallel threads, so temporarily pointing `HOME` at
//! invalid UTF-8 here would panic those tests at random.

use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;
use std::process::Command;

/// Set by the parent on the child re-exec to name the case being checked.
const SCENARIO: &str = "APP_CONFIG_HOME_DIR_OS_SCENARIO";

/// Invalid UTF-8: `\xC3` opens a two-byte sequence that `(` does not continue,
/// and `\xFF` is never valid. A real byte sequence a filesystem will accept.
fn non_utf8_home() -> OsString {
    OsString::from_vec(b"/home/caf\xC3(\xFF".to_vec())
}

#[test]
fn home_dir_os_reads_the_environment_without_utf8_validation() {
    if let Some(scenario) = std::env::var_os(SCENARIO) {
        run_child_case(&scenario.to_string_lossy());
        return;
    }

    for (scenario, home, userprofile) in [
        ("non_utf8_home", Some(non_utf8_home()), None),
        (
            "userprofile_fallback",
            None,
            Some(OsString::from("/windows/style/home")),
        ),
        (
            "home_wins_over_userprofile",
            Some(OsString::from("/the/home")),
            Some(OsString::from("/not/this/one")),
        ),
        ("neither_set", None, None),
    ] {
        run_case_in_child(scenario, home, userprofile);
    }
}

/// The assertions themselves, executed inside the child against the
/// environment the parent chose.
fn run_child_case(scenario: &str) {
    let observed = crate::app_config::home_dir_os();

    match scenario {
        // The regression guard. Under `var` this is `None`, because
        // `VarError::NotUnicode` is discarded and `USERPROFILE` is unset.
        "non_utf8_home" => assert_eq!(observed, Some(PathBuf::from(non_utf8_home()))),
        "userprofile_fallback" => {
            assert_eq!(observed, Some(PathBuf::from("/windows/style/home")))
        }
        "home_wins_over_userprofile" => assert_eq!(observed, Some(PathBuf::from("/the/home"))),
        "neither_set" => assert_eq!(observed, None),
        other => panic!("unknown scenario {other}"),
    }
}

fn run_case_in_child(scenario: &str, home: Option<OsString>, userprofile: Option<OsString>) {
    let mut child = Command::new(std::env::current_exe().expect("path to this test binary"));
    child
        .args([
            "--exact",
            "--nocapture",
            "app_config::home_env_tests::home_dir_os_reads_the_environment_without_utf8_validation",
        ])
        .env(SCENARIO, scenario)
        .env_remove("HOME")
        .env_remove("USERPROFILE");
    if let Some(home) = home {
        child.env("HOME", home);
    }
    if let Some(userprofile) = userprofile {
        child.env("USERPROFILE", userprofile);
    }

    let output = child.output().expect("re-run this test in a child process");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        output.status.success(),
        "scenario `{scenario}` failed in the child:\n{stdout}\n{stderr}"
    );
    // Without this a mistyped filter would match zero tests and the child would
    // exit 0, leaving every scenario vacuously green.
    assert!(
        stdout.contains("1 passed"),
        "scenario `{scenario}` matched no test, so nothing was actually checked:\n{stdout}"
    );
}
