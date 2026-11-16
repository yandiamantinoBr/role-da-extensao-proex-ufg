/** CSS custom property, set on <html> only while the dock is on screen, with the room the page must leave at its end. */
export const DOCK_RESERVE_PROPERTY = '--dock-reserve';
/** Breathing room between the last content of the page and the top of the dock. */
export const DOCK_RESERVE_GAP = 16;

/**
 * Room to leave at the end of the page so nothing ends up under the dock: from the top of its highest
 * resting part (Rolê, the Widgets button, a minimized chip, or the phone's floating button at home) down to
 * the bottom of the screen. Returns null when there is nothing to measure, so the caller keeps the CSS fallback.
 */
export function dockReserve(viewportHeight: number, tops: number[], gap = DOCK_RESERVE_GAP): number | null {
  const visible = tops.filter(top => Number.isFinite(top) && top < viewportHeight);
  if (!visible.length || !(viewportHeight > 0)) return null;
  return Math.max(0, Math.ceil(viewportHeight - Math.min(...visible) + gap));
}

/** Step, in pixels, between the spots the phone's floating button tries, from its home upward. */
export const FAB_STEP = 8;
/** Margin kept free around the button when checking what is under it (room for a finger, so a near tap doesn't hit the page). */
export const FAB_MARGIN = 12;

/**
 * Phone floating button: how far above its home it must move so nothing usable sits under it (with a margin).
 * `blocked(x, y)` answers whether a control is at that screen point. Tries the home first, then every FAB_STEP
 * up to `limit`. Returns the shift in pixels, or null when no spot is free (the caller hides the button).
 */
export function fabPlacement({ left, right, bottom, size, limit, blocked }: { left: number; right: number; bottom: number; size: number; limit: number; blocked(x: number, y: number): boolean }): number | null {
  for (let shift = 0; shift <= limit; shift += FAB_STEP) {
    const top = bottom - shift - size - FAB_MARGIN, low = bottom - shift + FAB_MARGIN, l = left - FAB_MARGIN, r = right + FAB_MARGIN;
    if (top < 0) return null;
    const xs = [l, (l + r) / 2, r], ys = [top, (top + low) / 2, low];
    if (!xs.some(x => ys.some(y => blocked(x, y)))) return shift;
  }
  return null;
}
