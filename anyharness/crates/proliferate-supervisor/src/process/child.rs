use tokio::process::{Child, Command};

use crate::error::SupervisorError;

pub fn spawn(program: &str, args: &[String]) -> Result<Child, SupervisorError> {
    spawn_with_env(program, args, &[])
}

pub fn spawn_with_env(
    program: &str,
    args: &[String],
    envs: &[(&str, &str)],
) -> Result<Child, SupervisorError> {
    let mut command = Command::new(program);
    command.args(args);
    for (name, value) in envs {
        command.env(name, value);
    }
    command.kill_on_drop(true);
    command.spawn().map_err(|source| SupervisorError::Spawn {
        program: program.to_string(),
        source,
    })
}
