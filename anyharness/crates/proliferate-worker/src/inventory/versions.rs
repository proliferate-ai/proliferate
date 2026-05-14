use std::{
    io::Read,
    process::{Command, Stdio},
    thread::sleep,
    time::{Duration, Instant},
};

use serde_json::{json, Value};

pub fn command_version(command: &str, args: &[&str]) -> Option<Value> {
    let mut child = Command::new(command)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait().ok()? {
            Some(status) if status.success() => {
                let mut stdout = String::new();
                if let Some(mut pipe) = child.stdout.take() {
                    let _ = pipe.read_to_string(&mut stdout);
                }
                return Some(json!({ "available": true, "version": stdout.trim() }));
            }
            Some(_) => {
                return Some(json!({ "available": false }));
            }
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Some(json!({ "available": false, "timedOut": true }));
            }
            None => sleep(Duration::from_millis(25)),
        }
    }
}

pub fn node_inventory() -> Option<Value> {
    Some(json!({
        "node": command_version("node", &["--version"]),
        "npm": command_version("npm", &["--version"]),
        "npx": command_version("npx", &["--version"])
    }))
}

pub fn python_inventory() -> Option<Value> {
    Some(json!({
        "python3": command_version("python3", &["--version"]),
        "python": command_version("python", &["--version"]),
        "uv": command_version("uv", &["--version"])
    }))
}
