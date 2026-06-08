#[derive(Debug, Default)]
pub(super) struct TerminalStreamFormatter {
    previous_was_cr: bool,
    at_line_start: bool,
}

impl TerminalStreamFormatter {
    pub(super) fn normalize(&mut self, data: Vec<u8>) -> Vec<u8> {
        let mut normalized = Vec::with_capacity(data.len());
        for byte in data {
            if byte == b'\n' && !self.previous_was_cr {
                normalized.push(b'\r');
                self.at_line_start = true;
            }
            normalized.push(byte);
            self.previous_was_cr = byte == b'\r';
            self.at_line_start = byte == b'\r' || byte == b'\n';
        }
        normalized
    }

    pub(super) fn normalize_prompt(&mut self, prompt: Vec<u8>) -> Vec<u8> {
        if self.at_line_start {
            return self.normalize(prompt);
        }
        let mut data = Vec::with_capacity(prompt.len() + 2);
        data.extend_from_slice(b"\r\n");
        data.extend(prompt);
        self.normalize(data)
    }
}

pub(super) fn terminal_command_preface(workspace_path: &str, command: &str) -> Vec<u8> {
    terminal_command_preface_with_prompt(workspace_prompt(workspace_path), command)
}

fn terminal_command_preface_with_prompt(mut prompt: Vec<u8>, command: &str) -> Vec<u8> {
    let mut formatter = TerminalStreamFormatter::default();
    let mut data = Vec::with_capacity(prompt.len() + command.len() + 3);
    data.push(b'\r');
    data.append(&mut prompt);
    data.extend_from_slice(command.as_bytes());
    data.extend_from_slice(b"\r\n");
    formatter.normalize(data)
}

pub(super) fn workspace_prompt(_workspace_path: &str) -> Vec<u8> {
    format!(
        "{}@{}:workspace{} ",
        current_user(),
        current_host(),
        prompt_symbol()
    )
    .into_bytes()
}

fn current_user() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "user".to_string())
}

fn current_host() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .and_then(|value| normalize_host(&value))
        .or_else(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .and_then(|output| String::from_utf8(output.stdout).ok())
                .and_then(|value| normalize_host(&value))
        })
        .unwrap_or_else(|| "localhost".to_string())
}

fn normalize_host(value: &str) -> Option<String> {
    let host = value.trim();
    if host.is_empty() {
        return None;
    }
    Some(host.split('.').next().unwrap_or(host).to_string())
}

fn prompt_symbol() -> &'static str {
    if current_user() == "root" {
        "#"
    } else {
        "$"
    }
}

#[cfg(test)]
mod tests {
    use super::{terminal_command_preface_with_prompt, TerminalStreamFormatter};

    #[test]
    fn terminal_stream_formatter_converts_bare_lf_to_crlf() {
        let mut formatter = TerminalStreamFormatter::default();

        assert_eq!(
            formatter.normalize(b"one\ntwo\r\nthree".to_vec()),
            b"one\r\ntwo\r\nthree"
        );
    }

    #[test]
    fn terminal_stream_formatter_preserves_crlf_across_chunks() {
        let mut formatter = TerminalStreamFormatter::default();

        assert_eq!(formatter.normalize(b"one\r".to_vec()), b"one\r");
        assert_eq!(formatter.normalize(b"\ntwo\n".to_vec()), b"\ntwo\r\n");
    }

    #[test]
    fn terminal_stream_formatter_puts_prompt_on_new_line_when_needed() {
        let mut formatter = TerminalStreamFormatter::default();

        assert_eq!(formatter.normalize(b"VERSION".to_vec()), b"VERSION");
        assert_eq!(
            formatter.normalize_prompt(b"user@host:workspace$ ".to_vec()),
            b"\r\nuser@host:workspace$ "
        );
    }

    #[test]
    fn terminal_command_preface_repaints_prompt_with_command() {
        assert_eq!(
            terminal_command_preface_with_prompt(b"user@host:workspace$ ".to_vec(), "ls"),
            b"\ruser@host:workspace$ ls\r\n"
        );
    }

    #[test]
    fn terminal_command_preface_normalizes_multiline_commands() {
        assert_eq!(
            terminal_command_preface_with_prompt(
                b"user@host:workspace$ ".to_vec(),
                "echo one\necho two"
            ),
            b"\ruser@host:workspace$ echo one\r\necho two\r\n"
        );
    }
}
