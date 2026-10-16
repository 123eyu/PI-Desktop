/**
 * The one floating panel behind every sidebar menu.
 *
 * The sidebar offers row actions, the sort popover, and section actions, and
 * each of them used to hand-write its own button list. They are one surface, so
 * they are rendered by one component: placement (via the caller's ref), roving
 * focus, checked rows, and labeled groups have a single implementation instead
 * of three that drift.
 *
 * The panel is data-driven (`SidebarMenuItem`) and stateless; `Sidebar.tsx`
 * owns the open menu, the placement, and the focus refs.
 */
import { Fragment, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type {
  SidebarMenuActionItem,
  SidebarMenuGroupItem,
  SidebarMenuPanelContent,
} from "../lib/sidebar-menu";

/** Arrow/Home/End moves focus between the rows that can actually take it. */
const MENU_ROW_SELECTOR =
  '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)';

function groupOptions(group: SidebarMenuGroupItem) {
  /* A lone option with no caption is not a group; it is one more row. */
  return group.label || group.options.length > 1
    ? group.options
    : group.options.map((option) => ({ ...option, icon: undefined }));
}

export function SidebarMenuPanel({
  content,
  menuRef,
  firstItemRef,
  onKeyDown,
  className,
  position,
}: {
  content: SidebarMenuPanelContent;
  /** Placement measurement lives with the caller's resize/scroll effects. */
  menuRef?: RefObject<HTMLDivElement | null>;
  /** The row the menu focuses when it opens. */
  firstItemRef?: RefObject<HTMLButtonElement | null>;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  className?: string;
  position: { top: number; left: number };
}) {
  let firstItemTaken = false;
  const takeFirstItemRef = () => {
    if (firstItemTaken) return undefined;
    firstItemTaken = true;
    return firstItemRef;
  };

  const renderAction = (
    item: SidebarMenuActionItem,
    options?: { iconFrom?: SidebarMenuActionItem["icon"]; keyPrefix?: string },
  ) => (
    <Fragment key={`${options?.keyPrefix ?? ""}${item.id}`}>
      {item.separatorBefore ? (
        <div className="sidebar-menu-separator" role="separator" />
      ) : null}
      <button
        ref={takeFirstItemRef()}
        type="button"
        role="menuitem"
        className={item.danger ? "danger" : undefined}
        data-action={item.id}
        data-armed={item.armed ? "true" : undefined}
        disabled={item.disabled}
        title={item.title}
        aria-busy={item.busy || undefined}
        aria-describedby={item.describedBy}
        onClick={item.onSelect}
      >
        {options?.iconFrom ?? (item.icon ? item.icon : null)}
        <span className="sidebar-menu-label">{item.label}</span>
      </button>
      {item.describedBy && item.title ? (
        <p id={item.describedBy} className="sidebar-menu-hint">
          {item.title}
        </p>
      ) : null}
    </Fragment>
  );

  return (
    <div
      ref={menuRef}
      className={className ? `sidebar-row-menu sidebar-floating-menu ${className}` : "sidebar-row-menu sidebar-floating-menu"}
      role="menu"
      aria-label={content.label}
      onKeyDown={onKeyDown}
      style={{ top: position.top, left: position.left }}
    >
      {content.hint ? <p className="sidebar-menu-hint">{content.hint}</p> : null}
      {content.items.map((item) => {
        if (item.kind === "section") {
          return (
            <Fragment key={item.id}>
              <div className="sidebar-menu-separator" role="separator" />
              <p className="sidebar-menu-section" data-sidebar-menu-section={item.id}>
                {item.label}
              </p>
            </Fragment>
          );
        }
        if (item.kind === "check") {
          return (
            <button
              key={item.id}
              ref={takeFirstItemRef()}
              type="button"
              role="menuitemcheckbox"
              aria-checked={item.checked}
              data-action={item.id}
              onClick={item.onSelect}
            >
              <span className="sidebar-menu-label">{item.label}</span>
              <span
                className={`sidebar-checkbox ${item.checked ? "checked" : ""}`}
                aria-hidden
              >
                {item.checked ? "✓" : ""}
              </span>
            </button>
          );
        }
        if (item.kind === "group") {
          const titled = Boolean(item.label) && (item.options.length > 1 || item.label);
          return (
            <Fragment key={item.id}>
              {titled ? (
                <>
                  <div className="sidebar-menu-separator" role="separator" />
                  <p className="sidebar-menu-section" data-sidebar-menu-section={item.id}>
                    {item.label}
                  </p>
                </>
              ) : null}
              {groupOptions(item).map((option) => (
                <button
                  key={`${item.id}-${option.id}`}
                  ref={takeFirstItemRef()}
                  type="button"
                  role="menuitemradio"
                  className={option.selected ? "selected" : undefined}
                  aria-checked={option.selected}
                  data-action={option.id}
                  onClick={option.onSelect}
                >
                  <span className="sidebar-menu-label">{option.label}</span>
                  {option.selected ? (
                    <span className="sidebar-sort-check" aria-hidden>
                      ✓
                    </span>
                  ) : null}
                </button>
              ))}
            </Fragment>
          );
        }
        return renderAction(item);
      })}
      {content.notes?.map((note) => (
        <Fragment key={note.id}>
          {note.separatorBefore ? (
            <div className="sidebar-menu-separator" role="separator" />
          ) : null}
          <p className="sidebar-menu-note" data-sidebar-menu-note={note.id}>
            {note.text}
          </p>
        </Fragment>
      ))}
    </div>
  );
}

/** Shared keyboard handling for every sidebar floating menu. */
export function sidebarMenuKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  onClose: (restoreFocus?: boolean) => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(MENU_ROW_SELECTOR),
  );
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
  items[next]?.focus();
}
