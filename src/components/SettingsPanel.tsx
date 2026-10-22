import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { native, errorMessage } from '../features/capture/api';
import { Icon } from './Icon';
import { modes } from '../features/capture/modes';
import type { Settings } from '../features/capture/api';

const keyLabels: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Super: '⌘',
  Meta: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↵',
  Backspace: '⌫',
  Delete: '⌦',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '−',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
};
function ShortcutKeys({ value }: { value: string }) {
  return value ? (
    value
      .split('+')
      .map((key, index) => (
        <kbd key={index}>{keyLabels[key] ?? key.replace(/^(Key|Digit)/, '')}</kbd>
      ))
  ) : (
    <span className="muted">Set shortcut</span>
  );
}

export function SettingsPanel({
  settings,
  disabled,
  update,
  choose,
}: {
  settings: Settings;
  disabled: boolean;
  update: (settings: Settings) => Promise<void>;
  choose: () => Promise<void>;
}) {
  const [form, setForm] = useState({ ...settings, appearance: 'system' as const });
  const [recording, setRecording] = useState<number>();
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState('');
  const capturing = recording !== undefined;
  useEffect(() => {
    if (!capturing) return;
    let mounted = true;
    const cancel = () => setRecording(undefined);
    window.addEventListener('blur', cancel);
    setReady(false);
    const pause = isTauri() ? native('set_shortcut_capture', { active: true }) : Promise.resolve();
    void pause
      .then(() => {
        if (mounted) setReady(true);
      })
      .catch((error) => {
        if (mounted) {
          setHint(errorMessage(error));
          setRecording(undefined);
        }
      });
    return () => {
      mounted = false;
      window.removeEventListener('blur', cancel);
      if (isTauri())
        void native('set_shortcut_capture', { active: false }).catch((error) =>
          setHint(errorMessage(error)),
        );
    };
  }, [capturing]);
  function setShortcut(index: number, value: string) {
    setForm((current) => {
      const shortcuts = [...current.shortcuts] as Settings['shortcuts'];
      shortcuts[index] = value;
      return { ...current, shortcuts };
    });
    setRecording(undefined);
    setHint('');
  }
  useEffect(() => setForm({ ...settings, appearance: 'system' }), [settings]);
  return (
    <form
      className="settings-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void update(form);
      }}
    >
      <h2>Saving & exports</h2>
      <p>Set your defaults once. Every export stays on this Mac.</p>
      <label>
        Save directory
        <div className="directory-field">
          <code>{settings.directory}</code>
          <button
            type="button"
            aria-label="Choose save directory"
            disabled={disabled}
            onClick={() => void choose()}
          >
            <Icon name="folder" />
            Choose…
          </button>
        </div>
      </label>
      <label>
        Image format
        <select
          value={form.format}
          onChange={(e) => setForm({ ...form, format: e.target.value as Settings['format'] })}
        >
          <option value="png">PNG · lossless</option>
          <option value="jpeg">JPEG · smaller file</option>
        </select>
      </label>
      <label>
        Filename format
        <input
          aria-label="Filename format"
          value={form.filename}
          maxLength={120}
          onChange={(e) => setForm({ ...form, filename: e.target.value })}
        />
        <small>
          Tokens: {'{date}'} · {'{time}'} · {'{mode}'}. A unique suffix is always added.
        </small>
      </label>
      <div className="shortcut-heading">
        <Icon name="keyboard" />
        <h3>Keyboard shortcuts</h3>
      </div>
      <div className="shortcut-list">
        {modes.map(({ label, icon }, index) => (
          <div className="shortcut-field" key={label}>
            <span className="shortcut-label">
              <Icon name={icon} size={18} />
              {label}
            </span>
            <button
              type="button"
              className="shortcut-recorder"
              aria-label={`${label} shortcut`}
              aria-pressed={recording === index}
              aria-describedby="shortcut-help"
              disabled={disabled}
              onClick={() => {
                setHint('');
                setRecording(index);
              }}
              onBlur={() => setRecording(undefined)}
              onKeyDownCapture={(event) => {
                if (recording !== index || !ready) return;
                if (event.key === 'Tab') {
                  setRecording(undefined);
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Escape') {
                  setRecording(undefined);
                  return;
                }
                if (['Meta', 'Control', 'Shift', 'Alt'].includes(event.key) || event.repeat) return;
                if (
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.altKey &&
                  ['Backspace', 'Delete'].includes(event.key)
                ) {
                  setShortcut(index, '');
                  return;
                }
                if (
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.altKey &&
                  !/^F\d{1,2}$/.test(event.code)
                ) {
                  setHint('Hold ⌘, ⌃ or ⌥ with a key.');
                  return;
                }
                const keys = [
                  event.ctrlKey && 'Control',
                  event.altKey && 'Alt',
                  event.shiftKey && 'Shift',
                  event.metaKey && 'Super',
                  event.code,
                ];
                setShortcut(index, keys.filter(Boolean).join('+'));
              }}
            >
              {recording === index ? (
                <span>{ready ? 'Press shortcut…' : 'Preparing…'}</span>
              ) : (
                <ShortcutKeys value={form.shortcuts[index]} />
              )}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Clear ${label.toLowerCase()} shortcut`}
              title="Disable shortcut"
              disabled={disabled || !form.shortcuts[index]}
              onClick={() => setShortcut(index, '')}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
      <p id="shortcut-help" className="shortcut-help" role="status">
        {hint ||
          (capturing
            ? 'Press your new combination. Esc cancels.'
            : 'Click a shortcut, then press your keys. × disables it.')}
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.launchAtLogin}
          onChange={(e) => setForm({ ...form, launchAtLogin: e.target.checked })}
        />
        Launch Iris when I log in
      </label>
      <div className="modal-actions">
        <button className="primary" disabled={disabled}>
          <Icon name="check" />
          Save settings
        </button>
      </div>
    </form>
  );
}
