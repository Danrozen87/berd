import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { NavigationPanesView } from "@/app/views/NavigationPanesView";
import { CreateProjectDialog } from "@/features/projects/ui/CreateProjectDialog";
import { DesignSystemInspector } from "@/features/design-system/inspector/DesignSystemInspector";
import { isDesignSystemExplorerEnabled } from "@/features/design-system/lib/designSystemEnabled";
import { cn } from "@/shared/lib/cn";
import { usePrefersReducedMotion } from "@/shared/hooks/usePrefersReducedMotion";
import {
  SIDEBAR_COLLAPSE_TRANSITION_EASE,
  SIDEBAR_COLLAPSE_TRANSITION_MS,
  SIDEBAR_RESIZE_HANDLE_INSIDE_PX,
} from "@/shared/ui/sidebar-tokens";
import { ChannelSwitchDialog } from "@/features/updates/ui/ChannelSwitchDialog";
import { UpdateButton } from "@/features/updates/ui/UpdateButton";
import { TopBar } from "./TopBar";
import { useFocusRegion } from "@/app/focus/FocusRegionProvider";
import { useSessionListRefresh } from "@/features/sessions/hooks/useSessionListRefresh";

interface AppShellLayoutProps {
  children: ReactNode;
  contentUnderSidebar?: boolean;
  /**
   * When true, the TopBar is positioned absolutely over the content so the
   * main canvas can extend up to the viewport edge. Used by the home view so
   * pinned widgets are reachable at all edges; the top-bar floats with no
   * solid background and shares the dot-grid surface underneath.
   */
  contentUnderTopBar?: boolean;
  projectTint?: string | null;
  createProjectDialog: ComponentProps<typeof CreateProjectDialog>;
  isResizing: boolean;
  onCornerResizeDoubleClick: MouseEventHandler<HTMLDivElement>;
  onCornerResizeStart: MouseEventHandler<HTMLDivElement>;
  onHeightResizeDoubleClick: MouseEventHandler<HTMLDivElement>;
  onHeightResizeStart: MouseEventHandler<HTMLDivElement>;
  onResizeDoubleClick: MouseEventHandler<HTMLDivElement>;
  onResizeStart: MouseEventHandler<HTMLDivElement>;
  resizeHandleHeight: number;
  resizeHandleWidth: number;
  navigationPanes: ComponentProps<typeof NavigationPanesView>;
  sidebarCollapsed: boolean;
  sidebarContentAnchor?: "left" | "right";
  sidebarDisableWidthTransition?: boolean;
  sidebarHeightResizeDisabled?: boolean;
  sidebarResizeDisabled?: boolean;
  sidebarWidthResizeDisabled?: boolean;
  sidebarOuterHeight: number;
  sidebarOuterWidth: number;
  /** Full slide panel width (content + gutter); stays constant while collapsing. */
  sidebarPanelOuterWidth: number;
  designSystemInspectorModeToggleRequest: number;
  onOpenDesignSystemExplorer?: () => void;
  showDesignSystemInspector: boolean;
  /**
   * Full content takeover: hides the sidebar slot entirely and lets the main
   * content span the whole width below the top bar (used by the design system
   * explorer).
   */
  contentTakeover?: boolean;
  topBar: ComponentProps<typeof TopBar>;
}

function findFirstFocusable(
  root: HTMLElement | null,
  selectors: string[],
): HTMLElement | null {
  for (const selector of selectors) {
    const element = root?.querySelector<HTMLElement>(selector);
    if (element) {
      return element;
    }
  }
  return null;
}

function getSidebarPanelStyle(
  overlay: boolean | undefined,
  collapsed: boolean,
  width: number,
  timing: string | undefined,
): CSSProperties {
  const style: CSSProperties = {
    width,
    pointerEvents: collapsed ? "none" : undefined,
  };
  if (!overlay) return style;
  return {
    ...style,
    left: 0,
    right: "auto",
    transform: `translateX(${collapsed ? "-100%" : "0"})`,
    // Hide the offscreen shadow after the slide; reversing restores visibility
    // immediately. Inert and pointer-events block interaction from the start.
    visibility: collapsed ? "hidden" : undefined,
    transition: timing
      ? `transform ${timing}, visibility 0s ${collapsed ? SIDEBAR_COLLAPSE_TRANSITION_MS : 0}ms`
      : "none",
  };
}

function useSidebarMotion({
  contentUnderSidebar: overlay,
  sidebarCollapsed: collapsed,
  sidebarOuterWidth,
  sidebarPanelOuterWidth,
  isResizing,
  sidebarDisableWidthTransition,
}: Pick<
  AppShellLayoutProps,
  | "contentUnderSidebar"
  | "sidebarCollapsed"
  | "sidebarOuterWidth"
  | "sidebarPanelOuterWidth"
  | "isResizing"
  | "sidebarDisableWidthTransition"
>) {
  const reducedMotion = usePrefersReducedMotion();
  const disabled = isResizing || sidebarDisableWidthTransition || reducedMotion;
  const [clipped, setClipped] = useState(collapsed);
  useEffect(() => {
    if (collapsed || disabled) {
      setClipped(collapsed);
      return;
    }
    if (!clipped) return;
    const timeout = window.setTimeout(
      () => setClipped(false),
      SIDEBAR_COLLAPSE_TRANSITION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [clipped, collapsed, disabled]);
  const timing = `${SIDEBAR_COLLAPSE_TRANSITION_MS}ms ${SIDEBAR_COLLAPSE_TRANSITION_EASE}`;
  return {
    clipOverflow: collapsed || (!disabled && clipped),
    handleTransition: disabled ? "none" : `opacity ${timing}`,
    slotStyle: {
      width: overlay ? sidebarPanelOuterWidth : sidebarOuterWidth,
      transition: disabled || overlay ? "none" : `width ${timing}`,
      pointerEvents: overlay && collapsed ? "none" : undefined,
    } satisfies CSSProperties,
    panelStyle: getSidebarPanelStyle(
      overlay,
      collapsed,
      sidebarPanelOuterWidth,
      disabled ? undefined : timing,
    ),
  };
}

export function AppShellLayout({
  children,
  contentUnderSidebar = false,
  contentUnderTopBar = false,
  projectTint = null,
  createProjectDialog,
  isResizing,
  onCornerResizeDoubleClick,
  onCornerResizeStart,
  onHeightResizeDoubleClick,
  onHeightResizeStart,
  onResizeDoubleClick,
  onResizeStart,
  resizeHandleHeight,
  resizeHandleWidth,
  navigationPanes,
  sidebarCollapsed,
  sidebarContentAnchor = "right",
  sidebarDisableWidthTransition = false,
  sidebarHeightResizeDisabled = false,
  sidebarResizeDisabled = false,
  sidebarWidthResizeDisabled = false,
  sidebarOuterHeight,
  sidebarOuterWidth,
  sidebarPanelOuterWidth,
  designSystemInspectorModeToggleRequest,
  onOpenDesignSystemExplorer,
  showDesignSystemInspector,
  contentTakeover = false,
  topBar,
}: AppShellLayoutProps) {
  // Externally-spawned ACP sessions (e.g. automation calling `session/new`
  // directly) are invisible in the sidebar until the session store is
  // re-hydrated. Refresh on focus + interval so they show up promptly.
  useSessionListRefresh();

  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarElement, setSidebarElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [mainElement, setMainElement] = useState<HTMLElement | null>(null);
  const sidebarElevated = sidebarHovered || isResizing;
  const {
    clipOverflow: sidebarClipOverflow,
    handleTransition: sidebarHandleFadeTransition,
    slotStyle,
    panelStyle,
  } = useSidebarMotion({
    contentUnderSidebar,
    sidebarCollapsed,
    sidebarOuterWidth,
    sidebarPanelOuterWidth,
    isResizing,
    sidebarDisableWidthTransition,
  });
  const sidebarWidthResizeEnabled =
    !sidebarResizeDisabled && !sidebarWidthResizeDisabled;
  const sidebarHeightResizeEnabled =
    !sidebarResizeDisabled && !sidebarHeightResizeDisabled;
  const sidebarCornerResizeEnabled =
    sidebarWidthResizeEnabled && sidebarHeightResizeEnabled;
  const sidebarSlotMaxHeight = contentUnderTopBar
    ? "calc(100% - var(--spacing-app-panel-gutter-bottom) - var(--spacing-app-top-bar))"
    : "calc(100% - var(--spacing-app-panel-gutter-bottom)";

  const shellStyle = {
    "--project-tint": projectTint ?? "transparent",
    "--app-sidebar-outer-width": `${sidebarOuterWidth}px`,
  } as CSSProperties;
  useFocusRegion(
    useMemo(
      () => ({
        id: "sidebar",
        label: "sidebar",
        key: "s",
        enabled: !sidebarCollapsed && !contentTakeover,
        element: sidebarElement,
        getInitialFocus: () =>
          sidebarElement?.querySelector<HTMLElement>(
            "[aria-current='page'], button:not(:disabled), a[href]",
          ) ?? null,
      }),
      [contentTakeover, sidebarCollapsed, sidebarElement],
    ),
  );
  useFocusRegion(
    useMemo(
      () => ({
        id: "main",
        label: "main content",
        key: "m",
        enabled: true,
        element: mainElement,
        getInitialFocus: () =>
          findFirstFocusable(mainElement, [
            "[data-testid='chat-composer']:not(:disabled)",
            "textarea:not(:disabled)",
            "input:not(:disabled)",
            "select:not(:disabled)",
            "button:not(:disabled)",
            "a[href]",
            "[tabindex]:not([tabindex='-1'])",
          ]),
      }),
      [mainElement],
    ),
  );

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden bg-dot-grid text-foreground"
      data-app-shell-root="true"
      style={shellStyle}
    >
      <TopBar
        {...topBar}
        className={
          contentUnderTopBar ? "absolute top-0 left-0 right-0 z-30" : undefined
        }
      />

      <div className="goose-zoom-scope relative flex min-h-0 flex-1">
        {/*
          Flow pages animate the slot width to move content with the panel.
          Overlaid content needs no gap: keep its slot fixed and slide the panel
          by transform so each animation frame avoids laying out the sidebar.
        */}
        <div
          className={cn(
            "relative flex-shrink-0 overflow-visible",
            contentUnderTopBar && "mt-[var(--spacing-app-top-bar)]",
            contentTakeover && "hidden",
          )}
          style={{
            clipPath: sidebarClipOverflow
              ? "inset(-100vh 0 -100vh 0)"
              : undefined,
            height: sidebarOuterHeight,
            maxHeight: sidebarSlotMaxHeight,
            ...slotStyle,
          }}
          aria-hidden={contentTakeover || sidebarCollapsed || undefined}
          inert={contentTakeover ? true : undefined}
        >
          <div
            ref={setSidebarElement}
            className={cn(
              // overflow-visible on every view: the sidebar card clips its own
              // content via `overflow-hidden rounded-md`, so the only things
              // that extend past this wrapper's right edge are the elevated panel
              // shadow and the resize rail (translate-x-1/2), both of which are
              // meant to float over the adjacent content. Clipping x here cropped
              // them on non-home pages.
              "absolute top-0 bottom-0 right-0 z-20 select-none overflow-visible",
              !sidebarClipOverflow &&
                !sidebarCollapsed &&
                sidebarContentAnchor === "left" &&
                "left-0",
              sidebarElevated && "z-30",
            )}
            style={panelStyle}
            aria-hidden={sidebarCollapsed || undefined}
            inert={sidebarCollapsed ? true : undefined}
            onMouseEnter={() => setSidebarHovered(true)}
            onMouseLeave={() => setSidebarHovered(false)}
          >
            <div className="relative h-full pt-[var(--spacing-app-panel-gutter-top)] pl-3">
              <NavigationPanesView
                {...navigationPanes}
                elevatedShadow={sidebarElevated}
              />
            </div>
            {(sidebarWidthResizeEnabled ||
              sidebarHeightResizeEnabled ||
              sidebarCornerResizeEnabled) && (
              <>
                {sidebarWidthResizeEnabled && (
                  <div
                    onMouseDown={onResizeStart}
                    onDoubleClick={onResizeDoubleClick}
                    className="sidebar-resize-rail group absolute top-0 right-0 bottom-0 z-10 cursor-ew-resize overflow-hidden"
                    style={{
                      width: sidebarCollapsed
                        ? 0
                        : resizeHandleWidth + SIDEBAR_RESIZE_HANDLE_INSIDE_PX,
                      transform: `translateX(${resizeHandleWidth}px)`,
                      opacity: sidebarCollapsed ? 0 : 1,
                      transition: sidebarHandleFadeTransition,
                    }}
                    aria-hidden={sidebarCollapsed || undefined}
                  >
                    <div
                      className="absolute top-1/2 h-8 w-px -translate-y-1/2 rounded-full bg-transparent transition-colors group-hover:bg-border"
                      style={{ left: SIDEBAR_RESIZE_HANDLE_INSIDE_PX }}
                    />
                  </div>
                )}
                {sidebarHeightResizeEnabled && (
                  <div
                    onMouseDown={onHeightResizeStart}
                    onDoubleClick={onHeightResizeDoubleClick}
                    className="group absolute right-0 bottom-0 left-3 z-10 cursor-ns-resize overflow-hidden"
                    style={{
                      height: sidebarCollapsed
                        ? 0
                        : resizeHandleHeight + SIDEBAR_RESIZE_HANDLE_INSIDE_PX,
                      transform: `translateY(${resizeHandleHeight}px)`,
                      opacity: sidebarCollapsed ? 0 : 1,
                      transition: sidebarHandleFadeTransition,
                    }}
                    aria-hidden={sidebarCollapsed || undefined}
                  >
                    <div
                      className="absolute left-1/2 h-px w-8 -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-border"
                      style={{ top: SIDEBAR_RESIZE_HANDLE_INSIDE_PX }}
                    />
                  </div>
                )}
                {sidebarCornerResizeEnabled && (
                  <div
                    onMouseDown={onCornerResizeStart}
                    onDoubleClick={onCornerResizeDoubleClick}
                    className="group absolute right-0 bottom-0 z-20 cursor-nwse-resize overflow-hidden"
                    style={{
                      height: sidebarCollapsed
                        ? 0
                        : resizeHandleHeight + SIDEBAR_RESIZE_HANDLE_INSIDE_PX,
                      width: sidebarCollapsed
                        ? 0
                        : resizeHandleWidth + SIDEBAR_RESIZE_HANDLE_INSIDE_PX,
                      transform: `translate(${resizeHandleWidth}px, ${resizeHandleHeight}px)`,
                      opacity: sidebarCollapsed ? 0 : 1,
                      transition: sidebarHandleFadeTransition,
                    }}
                    aria-hidden={sidebarCollapsed || undefined}
                  >
                    <div
                      className="absolute h-px w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-colors group-hover:bg-border"
                      style={{
                        top: SIDEBAR_RESIZE_HANDLE_INSIDE_PX,
                        left: SIDEBAR_RESIZE_HANDLE_INSIDE_PX,
                      }}
                    />
                    <div
                      className="absolute h-3 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-colors group-hover:bg-border"
                      style={{
                        top: SIDEBAR_RESIZE_HANDLE_INSIDE_PX,
                        left: SIDEBAR_RESIZE_HANDLE_INSIDE_PX,
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {sidebarWidthResizeEnabled && !contentTakeover && (
          <div
            onMouseDown={onResizeStart}
            onDoubleClick={onResizeDoubleClick}
            className={cn(
              "relative z-20 flex flex-shrink-0 cursor-ew-resize items-center justify-center overflow-visible",
              contentUnderTopBar && "mt-[var(--spacing-app-top-bar)]",
            )}
            style={{
              height: sidebarOuterHeight,
              maxHeight: sidebarSlotMaxHeight,
              width: 0,
              opacity: sidebarCollapsed ? 0 : 1,
              transition: sidebarHandleFadeTransition,
              pointerEvents: sidebarCollapsed ? "none" : undefined,
            }}
            aria-hidden={sidebarCollapsed || undefined}
          />
        )}

        <main
          ref={setMainElement}
          tabIndex={-1}
          className={
            contentUnderSidebar
              ? "absolute inset-0 z-0 min-h-0 min-w-0"
              : "min-h-0 min-w-0 flex-1 overflow-hidden"
          }
        >
          {children}
        </main>
      </div>

      <UpdateButton />
      <ChannelSwitchDialog />

      <CreateProjectDialog {...createProjectDialog} />
      {isDesignSystemExplorerEnabled() && showDesignSystemInspector ? (
        <DesignSystemInspector
          inspectModeToggleRequest={designSystemInspectorModeToggleRequest}
          onOpenExplorer={onOpenDesignSystemExplorer}
        />
      ) : null}
    </div>
  );
}
