import type { AgentCapabilityLevel, AgentCapabilityQuery } from "@pi-desktop/shared";

/**
 * The query a capability request carries for one row of its own level.
 *
 * A global row's switch reads and writes the global default, so its query must
 * stay scope-free even when a project is selected: appending the selection
 * would write a per-project override while the switch still reads as global,
 * and a reader with a legacy override under one project could then never turn
 * the global default off from there (#1957). Project rows are the one case
 * that needs the path - the host resolves a project definition through that
 * project's directory, so without it the row cannot be found at all.
 */
export function capabilityQuery(
  level: AgentCapabilityLevel,
  selectedProjectPath: string | null,
): AgentCapabilityQuery {
  return {
    level,
    ...(level === "project" && selectedProjectPath
      ? { projectPath: selectedProjectPath }
      : {}),
  };
}
