export function isSetupHintEnabled(script: string, command: string): boolean {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    return false;
  }

  return script.split("\n").some(
    (line) => line.trim() === trimmedCommand,
  );
}

export function toggleSetupHint(script: string, command: string, enable: boolean): string {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    return script;
  }

  if (enable) {
    if (isSetupHintEnabled(script, trimmedCommand)) {
      return script;
    }

    const existing = script.trim();
    return existing ? `${existing}\n${trimmedCommand}` : trimmedCommand;
  }

  return script
    .split("\n")
    .filter((line) => line.trim() !== trimmedCommand)
    .join("\n");
}
