/**
 * Containment for the plugin-workspace probe. The two spellings come from
 * different worlds — the plugin folder from a native dialog (backslashes on
 * Windows), the workspace from the host (which may persist `//?/X:/…` or a
 * forward-slash variant) — so both are unified before comparing: separators
 * fold to `/`, the Windows verbatim prefix (`\\?\X:\` in either spelling)
 * drops away, and comparison stays case-sensitive only on Linux, matching the
 * worktree ref folding. Kept dependency free so its test can drive it
 * directly.
 */
export function pluginWorkspaceContains(
  workspacePath: string,
  pluginPath: string,
): boolean {
  const fold = (value: string) => {
    const unified = value.replace(/\\/g, "/").replace(/\/+$/, "");
    const stripped = unified.replace(/^\/\/\?\/(?=[a-z]:\/)/i, "");
    return process.platform === "linux" ? stripped : stripped.toLowerCase();
  };
  const workspace = fold(workspacePath);
  if (!workspace) return false;
  const plugin = fold(pluginPath);
  return plugin === workspace || plugin.startsWith(`${workspace}/`);
}
