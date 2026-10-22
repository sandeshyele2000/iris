import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { modes } from '../features/capture/modes';
import type { Settings } from '../features/capture/api';

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
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  return (
    <form
      className="settings-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void update(form);
      }}
    >
      <h2>Saving & appearance</h2>
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
      <div className="form-grid">
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
          Appearance
          <select
            value={form.appearance}
            onChange={(e) =>
              setForm({ ...form, appearance: e.target.value as Settings['appearance'] })
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>
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
      <h3>Global keyboard shortcuts</h3>
      <p>
        Use CommandOrControl, Shift, Alt and a key separated by +. Leave empty to disable.
        Conflicting shortcuts are rejected.
      </p>
      {modes.map(({ label }, index) => (
        <label className="shortcut-field" key={label}>
          <span>{label}</span>
          <input
            aria-label={`${label} shortcut`}
            value={form.shortcuts[index]}
            onChange={(e) => {
              const shortcuts = [...form.shortcuts] as Settings['shortcuts'];
              shortcuts[index] = e.target.value;
              setForm({ ...form, shortcuts });
            }}
          />
        </label>
      ))}
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
