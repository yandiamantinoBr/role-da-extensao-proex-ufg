/** CSS custom property, set on <html> only while the dock is on screen, with the room the page must leave at its end. */
export const DOCK_RESERVE_PROPERTY = '--dock-reserve';
/** Breathing room between the last content of the page and the top of the dock. */
export const DOCK_RESERVE_GAP = 16;

/**
 * Room to leave at the end of the page so nothing ends up under the dock: from the top of its highest
 * resting desktop part (Rolê, the Widgets button, a minimized chip) down to the bottom of the screen.
 * Returns null when there is nothing to measure (no visible part), so the caller keeps the CSS fallback.
 */
export function dockReserve(viewportHeight: number, tops: number[], gap = DOCK_RESERVE_GAP): number | null {
  const visible = tops.filter(top => Number.isFinite(top) && top < viewportHeight);
  if (!visible.length || !(viewportHeight > 0)) return null;
  return Math.max(0, Math.ceil(viewportHeight - Math.min(...visible) + gap));
}
