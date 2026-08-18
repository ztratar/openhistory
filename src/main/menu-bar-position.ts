export interface WindowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowPosition {
  x: number;
  y: number;
}

export const DOCK_TO_MENU_BAR_SHOW_DELAY_MS = 1_000;

export function menuBarTransitionShowDelay(
  previousMode: "dock" | "menuBar",
  nextMode: "dock" | "menuBar"
): number {
  return previousMode === "dock" && nextMode === "menuBar"
    ? DOCK_TO_MENU_BAR_SHOW_DELAY_MS
    : 0;
}

export function menuBarToggleAction(
  windowVisible: boolean,
  showRequested: boolean
): "hide" | "show" {
  return windowVisible || showRequested ? "hide" : "show";
}

export function usableTrayBounds(bounds: WindowRectangle): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width > 0
    && bounds.height > 0
    && !(bounds.x === 0 && bounds.y === 0);
}

export function anchoredMenuBarWindowPosition(
  trayBounds: WindowRectangle,
  windowBounds: Pick<WindowRectangle, "width" | "height">,
  workArea: WindowRectangle,
  margin = 8
): WindowPosition | undefined {
  if (!usableTrayBounds(trayBounds)) return undefined;
  if (windowBounds.width <= 0 || windowBounds.height <= 0) return undefined;
  if (workArea.width <= 0 || workArea.height <= 0) return undefined;

  const centeredX = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  return {
    x: Math.max(
      workArea.x + margin,
      Math.min(centeredX, workArea.x + workArea.width - windowBounds.width - margin)
    ),
    y: workArea.y + margin
  };
}
