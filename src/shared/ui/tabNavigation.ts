/** Arrow/Home/End roving-tabindex navigation for an ARIA `role="tablist"` (APG automatic activation). */
export type TabNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/** Returns the next tab index for a keypress, or `null` if the key isn't a tab-navigation key. */
export function nextTabIndex(key: string, currentIndex: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (currentIndex + 1) % count;
    case 'ArrowLeft':
      return (currentIndex - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
