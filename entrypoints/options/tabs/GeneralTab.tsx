import { createSignal, For, onMount, Show } from 'solid-js';
import { StringListEditor } from '../../../components/options/StringListEditor';
import { configStore } from '../../../src/platform/configStore';
import { parseBackup, serializeBackup } from '../../../src/shared/config/backup';
import { downloadBlob } from '../../../src/shared/downloadBlob';
import { COMMON_LANGUAGES } from '../../../src/shared/languages';
import { translateShortcut } from '../../../src/shared/shortcut';
import { describeError, type SettingsTabProps } from './types';

/** General tab: theme, languages, the shortcut hint, and backup/restore. */
export function GeneralTab(props: SettingsTabProps) {
  /** The live translate/restore key binding, or null — see translateShortcut. */
  const [shortcut, setShortcut] = createSignal<string | null>(null);
  const [backupMessage, setBackupMessage] = createSignal<string | null>(null);
  const [restoredDefaults, setRestoredDefaults] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  onMount(() => {
    browser.commands
      ?.getAll?.()
      .then((commands) => setShortcut(translateShortcut(commands)))
      .catch(() => {});
  });

  function handleExport(): void {
    const json = serializeBackup(props.settings, Date.now());
    const blob = new Blob([json], { type: 'application/json' });
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `prism-settings-${date}.json`);
  }

  function handleImportClick(): void {
    fileInput?.click();
  }

  async function handleImportFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = parseBackup(text);
    if (!result.ok) {
      setBackupMessage(result.error);
      input.value = '';
      return;
    }
    try {
      await configStore.import(JSON.stringify(result.value));
      setBackupMessage('Settings imported.');
      setTimeout(() => setBackupMessage(null), 3000);
    } catch (e2) {
      setBackupMessage(`Import failed: ${describeError(e2)}`);
    }
    input.value = '';
  }

  async function handleRestoreDefaults(): Promise<void> {
    if (!confirm('Restore all settings to their defaults? This cannot be undone.')) return;
    try {
      await configStore.restoreToDefault();
      setRestoredDefaults(true);
      setTimeout(() => setRestoredDefaults(false), 2000);
    } catch (e) {
      props.onError(`Couldn't restore defaults: ${describeError(e)}`);
    }
  }

  return (
    <>
      <section class="section">
        <h2>General</h2>
        <p class="hint">
          <Show
            when={shortcut()}
            fallback={
              <>
                No keyboard shortcut is set for translating a page — you can assign one in your browser's extension
                shortcuts settings.
              </>
            }
          >
            Translate or restore the current page with <kbd>{shortcut()}</kbd>. You can change it in your browser's
            extension shortcuts settings.
          </Show>
        </p>
        <label class="field">
          <span>Theme</span>
          <select
            value={props.settings.theme}
            onChange={(e) => void props.setField('theme', e.currentTarget.value as never)}
          >
            <option value="auto">Match system</option>
            <option value="light">Always light</option>
            <option value="dark">Always dark</option>
          </select>
        </label>
        <label class="field">
          <span>Translate into</span>
          <select
            value={props.settings.targetLanguage}
            onChange={(e) => void props.setField('targetLanguage', e.currentTarget.value)}
          >
            <For each={COMMON_LANGUAGES}>{(l) => <option value={l.code}>{l.name}</option>}</For>
          </select>
        </label>
        <label class="field">
          <span>Source language for selected text</span>
          <select
            value={props.settings.sourceLanguage}
            onChange={(e) => void props.setField('sourceLanguage', e.currentTarget.value)}
          >
            <option value="auto">Detect automatically</option>
            <For each={COMMON_LANGUAGES}>{(l) => <option value={l.code}>{l.name}</option>}</For>
          </select>
          <small class="hint">
            Page translation detects the language by itself. If it guesses wrong on a site, set it with the bubble's
            From picker.
          </small>
        </label>
        <StringListEditor
          label="Preferred target languages"
          values={props.settings.targetLanguages ?? []}
          languageOptions
          onAdd={(code) =>
            void props.setField('targetLanguages', [...new Set([...(props.settings.targetLanguages ?? []), code])])
          }
          onRemove={(code) =>
            void props.setField(
              'targetLanguages',
              (props.settings.targetLanguages ?? []).filter((c) => c !== code),
            )
          }
        />
        <Show
          when={
            props.savedField() === 'theme' ||
            props.savedField() === 'targetLanguage' ||
            props.savedField() === 'sourceLanguage'
          }
        >
          <p class="saved">Saved</p>
        </Show>
      </section>

      <section class="section">
        <h2>Backup</h2>
        <p class="hint">
          Settings are saved on this device only. To move them to another device, export them here and import the file
          there.
        </p>
        {/*
          Unlike the diagnostics export, this one keeps API keys (stripping
          them would break restoring on another device), so warn instead.
        */}
        <p class="hint">
          <strong>The exported file includes any API keys you've entered in plain text</strong> — store and share it the
          same way you would the keys themselves.
        </p>
        <div class="backupActions">
          <button type="button" onClick={handleExport}>
            Export settings
          </button>
          <button type="button" class="secondary" onClick={handleImportClick}>
            Import settings
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => void handleImportFile(e)}
          />
          <button type="button" class="danger" onClick={() => void handleRestoreDefaults()}>
            Restore defaults
          </button>
        </div>
        <Show when={backupMessage()}>
          <p class="saved">{backupMessage()}</p>
        </Show>
        <Show when={restoredDefaults()}>
          <p class="saved">Defaults restored.</p>
        </Show>
      </section>
    </>
  );
}
