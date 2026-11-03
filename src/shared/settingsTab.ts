/** A tab showing one of the extension's own pages, as the background can see it. */
export interface OpenExtensionTab {
  tabId: number;
  windowId?: number;
  /** Undefined when the browser hides the address from the extension. */
  url: string | undefined;
}

export type OpenSettingsPlan =
  | { kind: 'focus'; tabId: number; windowId?: number; url?: string }
  | { kind: 'create'; url: string }
  | { kind: 'openOptionsPage' };

/** Sections name a Settings tab, so only a plain word is accepted. */
function validSection(section: string | undefined): string | null {
  return section && /^[a-z]+$/.test(section) ? section : null;
}

function isSettingsUrl(url: string | undefined, optionsUrl: string): boolean {
  if (!url) return false;
  const withoutFragment = url.split('#')[0]?.split('?')[0];
  return withoutFragment === optionsUrl;
}

/**
 * How to show Settings: switch an already-open Settings tab to the section
 * rather than piling up new tabs; otherwise open one as a normal tab, which
 * the next link can find. Only a browser that hides its open tabs from the
 * extension falls back to `openOptionsPage()`, its own de-duplicating opener,
 * which can't carry a section.
 */
export function planOpenSettings(
  openTabs: OpenExtensionTab[],
  optionsUrl: string,
  section: string | undefined,
  { canSeeOpenTabs = true }: { canSeeOpenTabs?: boolean } = {},
): OpenSettingsPlan {
  const target = validSection(section);
  const url = target ? `${optionsUrl}#${target}` : optionsUrl;
  const existing = openTabs.find((tab) => isSettingsUrl(tab.url, optionsUrl));
  if (existing) {
    const plan: OpenSettingsPlan = { kind: 'focus', tabId: existing.tabId };
    if (existing.windowId !== undefined) plan.windowId = existing.windowId;
    if (target) plan.url = url;
    return plan;
  }
  return target || canSeeOpenTabs ? { kind: 'create', url } : { kind: 'openOptionsPage' };
}
