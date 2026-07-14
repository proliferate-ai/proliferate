export function createPromptId(): string {
  return `prompt:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}
