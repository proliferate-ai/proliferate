export const WORKTREE_AUTO_DELETE_LIMIT_DEFAULT = 20;
export const WORKTREE_AUTO_DELETE_LIMIT_MIN = 10;
export const WORKTREE_AUTO_DELETE_LIMIT_MAX = 100;

export function isValidWorktreeAutoDeleteLimit(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= WORKTREE_AUTO_DELETE_LIMIT_MIN
    && value <= WORKTREE_AUTO_DELETE_LIMIT_MAX;
}
