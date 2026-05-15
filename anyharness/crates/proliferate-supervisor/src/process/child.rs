use tokio::process::{Child, Command};

use crate::error::SupervisorError;

pub fn spawn_with_env<'a, I>(
    program: &str,
    args: &[String],
    envs: I,
) -> Result<Child, SupervisorError>
where
    I: IntoIterator<Item = (&'a str, &'a str)>,
{
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
