export async function runContextualAwsCommand({
  execFileImpl,
  args,
  signal,
  throwIfDeadlineExpired,
}) {
  if (typeof throwIfDeadlineExpired !== "function" || !signal) {
    throw new Error("Contextual AWS commands require a signal and deadline guard");
  }
  throwIfDeadlineExpired();
  signal.throwIfAborted();
  return execFileImpl("aws", args, { signal });
}
