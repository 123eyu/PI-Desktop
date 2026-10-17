import type { KeyboardEvent, ReactNode } from "react";
import type { TFunction } from "i18next";
import type { Mode, PermissionMode } from "@pi-desktop/shared";
import {
  IconPencil,
  IconShield,
  IconSparkles,
} from "../../../components/icons";
import { PERMISSION_MODE_I18N_KEYS } from "../../../lib/permission-mode-labels";
import { ModeIcon } from "./ComposerModeIcon";
import { MODE_CYCLE, MODE_LABEL_KEYS } from "./model";

type SelectablePermission = Exclude<PermissionMode, "inherit">;

type Segment<Value extends string> = {
  value: Value;
  label: string;
  icon: ReactNode;
};

const SELECT_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);
const SELECTABLE_PERMISSIONS: readonly SelectablePermission[] = [
  "ask",
  "accept-edits",
  "auto",
];
const PERMISSION_ICONS: Record<SelectablePermission, ReactNode> = {
  ask: <IconShield size={13} />,
  "accept-edits": <IconPencil size={13} />,
  auto: <IconSparkles size={13} />,
};

/**
 * Mutually exclusive choices as one segmented control.
 *
 * Every option is a real click target: any state is one pointer action away.
 * The alternatives in this toolbar used to need a menu round-trip (permission)
 * or repeated clicks on a cycling chip (mode). Selection follows focus like a
 * native radio group, so arrow keys move to and commit the neighbouring option.
 */
function SegmentedControl<Value extends string>({
  className,
  ariaLabel,
  value,
  segments,
  disabled = false,
  planning = false,
  onSelect,
}: {
  className: string;
  ariaLabel: string;
  value: Value;
  segments: readonly Segment<Value>[];
  disabled?: boolean;
  planning?: boolean;
  onSelect: (value: Value) => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!SELECT_KEYS.has(event.key)) return;
    const radios = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]:not(:disabled)',
      ),
    ];
    if (radios.length === 0) return;
    event.preventDefault();
    const active = radios.indexOf(document.activeElement as HTMLButtonElement);
    const last = radios.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowLeft"
            ? (active <= 0 ? last : active - 1)
            : active >= last
              ? 0
              : active + 1;
    const target = radios[next];
    if (!target) return;
    target.focus();
    // Selecting on arrow navigation keeps focus and the committed state equal.
    target.click();
  };

  return (
    <div
      className={`composer-segment-group ${className}`}
      role="radiogroup"
      aria-label={ariaLabel}
      data-planning={planning ? "true" : undefined}
      onKeyDown={handleKeyDown}
    >
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={segment.label}
            // The glyph-only options carry their name on hover; the committed
            // one spells it out in the row itself.
            title={active ? undefined : segment.label}
            className={`composer-segment${active ? " is-active" : ""}`}
            data-value={segment.value}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (!active) onSelect(segment.value);
            }}
          >
            <span className="composer-segment-icon" aria-hidden="true">
              {segment.icon}
            </span>
            <span className="composer-segment-label">{segment.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Approval level as a standalone switch. Scheduled task drafts show it without
 * a mode switch, because a task always runs in the agent mode.
 */
export function ComposerPermissionSwitch({
  t,
  permissionMode,
  locked = false,
  controlsBlocked,
  onSelect,
}: {
  t: TFunction;
  permissionMode: PermissionMode;
  locked?: boolean;
  controlsBlocked: boolean;
  onSelect: (mode: SelectablePermission) => void;
}) {
  const effectivePermission: SelectablePermission = locked
    ? "auto"
    : (permissionMode as SelectablePermission);
  return (
    <SegmentedControl
      className="composer-permission-switch"
      ariaLabel={
        locked
          ? `${t("chat.permissionMode")} · ${t("goal.autoWarning")}`
          : t("chat.permissionMode")
      }
      value={effectivePermission}
      segments={SELECTABLE_PERMISSIONS.map((candidate) => ({
        value: candidate,
        label: t(PERMISSION_MODE_I18N_KEYS[candidate]),
        icon: PERMISSION_ICONS[candidate],
      }))}
      disabled={controlsBlocked || locked}
      onSelect={onSelect}
    />
  );
}

/**
 * Composer-left execution switches: how the agent works (mode) and how much it
 * may do unattended (approval level), side by side in one capsule.
 */
export function ComposerSwitches({
  t,
  mode,
  planningLive,
  permissionMode,
  controlsBlocked,
  onSelectMode,
  onSelectPermission,
}: {
  t: TFunction;
  mode: Mode;
  planningLive: boolean;
  permissionMode: PermissionMode;
  controlsBlocked: boolean;
  onSelectMode: (mode: Mode) => void;
  onSelectPermission: (mode: SelectablePermission) => void;
}) {
  return (
    <div className="composer-switches">
      <SegmentedControl
        className="composer-mode-switch"
        ariaLabel={t("settings.mode")}
        value={mode}
        planning={planningLive}
        segments={MODE_CYCLE.map((candidate) => ({
          value: candidate,
          label: t(MODE_LABEL_KEYS[candidate]),
          icon: <ModeIcon mode={candidate} />,
        }))}
        disabled={controlsBlocked}
        onSelect={onSelectMode}
      />
      <span className="composer-switch-divider" aria-hidden="true" />
      {/* Goal runs fully automated, so the approval switch reports that state
          instead of offering choices the mode would override. */}
      <ComposerPermissionSwitch
        t={t}
        permissionMode={permissionMode}
        locked={mode === "goal"}
        controlsBlocked={controlsBlocked}
        onSelect={onSelectPermission}
      />
    </div>
  );
}
