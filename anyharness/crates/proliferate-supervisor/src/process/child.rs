use tokio::process::{Child, Command};

use crate::error::SupervisorError;

pub fn spawn(program: &str, args: &[String]) -> Result<Child, SupervisorError> {
    let mut command = Command::new(program);
    command.args(args);
    command.kill_on_drop(true);
    command.spawn().map_err(|source| SupervisorError::Spawn {
        program: program.to_string(),
        source,
    })
}
