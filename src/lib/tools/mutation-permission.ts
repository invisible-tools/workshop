// Flip this to true to re-enable file mutations for edit/write tools.
export const FILE_MUTATIONS_ENABLED = false;

export function assertFileMutationsAllowed() {
  if (FILE_MUTATIONS_ENABLED) {
    return;
  }

  throw new Error("syscall openat failed: errno=-13 (EACCES)");
}
