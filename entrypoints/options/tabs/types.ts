import type { Accessor } from 'solid-js';
import type { Config, ConfigKey } from '../../../src/shared/config/schema';

/** What every Settings tab gets from the shell in `App.tsx`. */
export interface SettingsTabProps {
  /** The reactive config mirror; read it in JSX instead of `configStore.get()`. */
  settings: Config;
  /** Saves one key, updating the mirror first and rolling it back on failure. */
  setField<K extends ConfigKey>(key: K, value: Config[K]): Promise<void>;
  /** The key saved in the last moment, for its "Saved" note. */
  savedField: Accessor<ConfigKey | null>;
  /** Shows a storage failure in the page-level alert. */
  onError(message: string): void;
}

export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
