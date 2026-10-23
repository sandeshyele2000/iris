import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import { Icon } from './components/Icon';
import { ShortcutKeys } from './components/ShortcutKeys';
import { SettingsPanel } from './components/SettingsPanel';
import { modes } from './features/capture/modes';
import { native, errorMessage } from './features/capture/api';
import { useScreenRecordingPermission } from './features/capture/useScreenRecordingPermission';
import type {
  Capture,
  Diagnostic,
  Library,
  Mode,
  Recording,
  Sources,
} from './features/capture/api';
import { Editor } from './features/editor/Editor';
import type { EditorHandle } from './features/editor/Editor';

type Page = 'library' | 'settings' | 'diagnostics';
function date(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function Pin({ id }: { id: string }) {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void native<string>('library_image', { id, original: false })
      .then(setSource)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen('image-updated', () => {
      void native<string>('library_image', { id, original: false })
        .then(setSource)
        .catch((e) => setError(errorMessage(e)));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [id]);
  return (
    <main className="pin-preview">
      {source ? (
        <img src={source} alt="Pinned screenshot" />
      ) : (
        <p role="status">{error || 'Loading…'}</p>
      )}
    </main>
  );
}
export function App() {
  const pin = new URLSearchParams(window.location.search).get('pin');
  return pin ? <Pin id={pin} /> : <Workspace />;
}
function Workspace() {
  const [data, setData] = useState<Library>();
  const [page, setPage] = useState<Page>('library');
  const [selected, setSelected] = useState<string>();
  const [source, setSource] = useState('');
  const [sources, setSources] = useState<Sources>();
  const [displayId, setDisplayId] = useState<number>();
  const [windowId, setWindowId] = useState<number>();
  const [windowPicker, setWindowPicker] = useState(false);
  const [recording, setRecording] = useState<Recording>({ active: false });
  const { diagnostic, refresh: refreshPermission, requestAccess } = useScreenRecordingPermission();
  useEffect(() => {
    if (diagnostic?.permissionGranted) {
      setError((current) => (current.startsWith('PERMISSION_REQUIRED:') ? '' : current));
    }
  }, [diagnostic?.permissionGranted]);
  useEffect(() => {
    if (page === 'diagnostics') void refreshPermission().catch(() => {});
  }, [page, refreshPermission]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ocr, setOcr] = useState<string>();
  const [rename, setRename] = useState<string>();
  const [prompt, setPrompt] = useState<{ message: string; resolve: (answer: boolean) => void }>();
  const editor = useRef<EditorHandle>(null);
  const lock = useRef(false);
  const closing = useRef(false);
  const recordingStarting = useRef(false);
  const recordingRef = useRef(recording.active);
  recordingRef.current = recording.active;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const row = data?.captures.find((c) => c.id === selected);
  async function reload() {
    const library = await native<Library>('library');
    setData(library);
    return library;
  }
  async function task(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      if (!(
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        cause.code === 'CANCELLED'
      ))
        setError(errorMessage(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => setPrompt({ message, resolve }));
  }
  async function leave() {
    return (
      !dirty ||
      (await confirm(
        'Discard your unsaved edits? The original screenshot will stay in your library.',
      ))
    );
  }
  useEffect(() => {
    void task(async () => {
      await reload();
    });
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const update = (status: Recording) => {
      if (!active) return;
      setRecording(status);
      if (status.path) setNotice(`Recording saved to ${status.path}`);
    };
    const listener = listen<Recording>('recording-changed', (event) => update(event.payload));
    // Subscribe before reading status so stopping from the tray cannot leave stale UI.
    void listener
      .then(() => native<Recording>('recording_status'))
      .then(update)
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
      void listener.then((unlisten) => unlisten());
    };
  }, []);
  useEffect(() => {
    setSource('');
    setOcr(undefined);
    if (!selected) return;
    let active = true;
    void native<string>('library_image', { id: selected, original: true })
      .then((value) => {
        if (active) setSource(value);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [selected]);
  const runCapture = useRef<(mode: Mode) => void>(() => {});
  runCapture.current = (mode) => {
    void startCapture(mode);
  };
  useEffect(() => {
    if (!isTauri()) return;
    const completed = listen<string>('capture-completed', (event) => {
      void task(async () => {
        if (
          dirtyRef.current &&
          !(await confirm('Discard unsaved edits and open the new capture?'))
        ) {
          await reload();
          return;
        }
        await reload();
        setSelected(event.payload);
        setDirty(false);
        setPage('library');
      });
    });
    const failed = listen<unknown>('capture-error', (event) =>
      setError(errorMessage(event.payload)),
    );
    const windowCapture = listen<Mode>('capture-shortcut', (event) =>
      runCapture.current(event.payload),
    );
    return () => {
      for (const listener of [completed, failed, windowCapture])
        void listener.then((unlisten) => unlisten());
    };
  }, []);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (dirty && !closing.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  const modalOpen = !!prompt || windowPicker || ocr !== undefined || rename !== undefined;
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement;
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (prompt) {
          prompt.resolve(false);
          setPrompt(undefined);
        } else {
          setWindowPicker(false);
          setOcr(undefined);
          setRename(undefined);
        }
      }
      if (event.key !== 'Tab') return;
      const modal = document.querySelector('.modal-backdrop:last-child');
      const elements = modal?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, select, textarea, [tabindex="0"]',
      );
      if (!elements?.length) return;
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
      previous?.focus();
    };
  }, [modalOpen, prompt]);
  useEffect(() => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    const unlisten = window.onCloseRequested((event) => {
      if (recordingRef.current || recordingStarting.current) {
        // Rust hides the window; keep its webview alive so recording can continue.
        event.preventDefault();
        return;
      }
      if (!dirty || closing.current) return;
      event.preventDefault();
      void confirm('Discard your unsaved edits and close Iris?').then(async (accepted) => {
        if (accepted) {
          closing.current = true;
          await window.close();
        }
      });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [dirty]);
  async function availableSources() {
    const result = await native<Sources>('list_sources');
    setSources(result);
    const display =
      result.displays.find((d) => d.id === displayId) ??
      (displayId === undefined || displayId === 0
        ? (result.displays.find((d) => d.x === 0 && d.y === 0) ?? result.displays[0])
        : undefined);
    setDisplayId(displayId === 0 ? 0 : display?.id);
    setWindowId(result.windows[0]?.id);
    return { result, display };
  }
  async function startCapture(mode: Mode) {
    if (lock.current || prompt || !(await leave())) return;
    await task(async () => {
      const { display } = await availableSources();
      if (mode === 'window') {
        setWindowPicker(true);
        return;
      }
      if (!display)
        throw new Error('No displays are available. Connect a display and refresh sources.');
      if (mode === 'region' && displayId === 0)
        throw new Error('Choose one display for region selection.');
      const targets =
        mode === 'display' && displayId === 0
          ? (await native<Sources>('list_sources')).displays
          : [display];
      let capture: Capture | undefined;
      try {
        for (const target of targets)
          capture = await native<Capture>('capture', { mode, sourceId: target.id });
      } finally {
        await reload();
      }
      if (capture) {
        setSelected(capture.id);
        setDirty(false);
        setPage('library');
        setNotice(
          targets.length > 1
            ? `${targets.length} displays added to your library as separate images.`
            : 'Screenshot added to your library.',
        );
      }
    });
  }
  async function persist() {
    if (!selected || !editor.current) throw new Error('Wait for the screenshot to load.');
    if (dirty) {
      const snapshot = editor.current.snapshot();
      await native('save_edit', { id: selected, ...snapshot });
      setDirty(false);
      await reload();
    }
  }
  async function save(saveAs: boolean) {
    await task(async () => {
      await persist();
      const path = await native<string | null>('export_image', {
        id: selected,
        format: data?.settings.format ?? 'png',
        saveAs,
      });
      if (path) {
        await reload();
        setNotice(`Saved to ${path}`);
      }
    });
  }
  async function recordAction(action: string) {
    if (!selected) return;
    await task(async () => {
      if (['copy', 'ocr', 'pin'].includes(action)) await persist();
      const result = await native<{ text?: string }>('library_action', { id: selected, action });
      if (action === 'ocr') setOcr(result.text ?? '');
      else
        setNotice(
          action === 'copy'
            ? 'Image copied to clipboard.'
            : action === 'pin'
              ? 'Screenshot pinned above other windows.'
              : 'Opened in Finder.',
        );
    });
  }
  useEffect(() => {
    function listener(event: KeyboardEvent) {
      if (
        modalOpen ||
        !(event.metaKey || event.ctrlKey) ||
        (event.target instanceof Element && event.target.matches('input, textarea, select')) ||
        !selected
      )
        return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save(event.shiftKey);
      }
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        void recordAction('copy');
      }
    }
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });
  async function navigate(next: Page) {
    if (await leave()) {
      setDirty(false);
      setSelected(undefined);
      setPage(next);
    }
  }
  const captures = (data?.captures ?? [])
    .filter((c) =>
      `${c.name} ${c.mode} ${c.createdAt} ${c.sourceId}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .toSorted((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'oldest'
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
    );
  const disabled = busy || !!prompt;
  return (
    <div className="app-shell">
      <aside className="sidebar" inert={modalOpen}>
        <a
          href="#"
          className="brand"
          aria-label="Iris home"
          onClick={(e) => {
            e.preventDefault();
            void navigate('library');
          }}
        >
          <span className="brand-mark">
            <Icon name="eye" size={25} />
          </span>
          <span>
            Iris<span className="brand-sub">CAPTURE, CLEARLY.</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {(['library', 'settings', 'diagnostics'] as Page[]).map((item) => (
            <button
              key={item}
              className={`nav-item ${page === item ? 'active' : ''}`}
              disabled={disabled}
              onClick={() => void navigate(item)}
            >
              <Icon name={item === 'diagnostics' ? 'info' : item} />
              <span>{item[0].toUpperCase() + item.slice(1)}</span>
              {item === 'library' && <span className="count">{data?.captures.length ?? 0}</span>}
            </button>
          ))}
        </nav>
      </aside>
      <main className="workspace" aria-busy={busy} inert={modalOpen}>
        <header className="topbar">
          <div>
            <p className="eyebrow">YOUR PRIVATE WORKSPACE</p>
            <h1>
              {row
                ? 'Screenshot editor'
                : page === 'library'
                  ? 'Your captures'
                  : page === 'settings'
                    ? 'Make it yours'
                    : 'Permissions & diagnostics'}
            </h1>
          </div>
          <button
            className="icon-button"
            aria-label="Minimize Iris"
            title="Minimize · area capture: ⇧⌘2"
            disabled={disabled}
            onClick={() =>
              void task(async () => {
                await getCurrentWindow().minimize();
              })
            }
          >
            <Icon name="minimize" />
          </button>
        </header>
        <section className="capture-bar" aria-label="Capture controls">
          <div className="capture-buttons">
            {modes.map(({ mode, label, icon, key }) => (
              <button
                key={mode}
                className={mode === 'display' ? 'capture-primary' : ''}
                disabled={disabled}
                onClick={() => void startCapture(mode)}
                title={data?.settings.shortcuts[Number(key) - 1]}
              >
                <Icon name={icon} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <button
            className={`icon-button ${recording.active ? 'recording-active' : ''}`}
            aria-label={recording.active ? 'Stop recording' : 'Record screen'}
            title={recording.active ? 'Stop and save recording' : 'Record display · MP4 · no audio'}
            disabled={disabled}
            onClick={() =>
              void task(async () => {
                if (recording.active) {
                  const status = await native<Recording>('stop_recording');
                  setRecording(status);
                  if (status.path) setNotice(`Recording saved to ${status.path}`);
                } else {
                  recordingStarting.current = true;
                  try {
                    setRecording(
                      await native<Recording>('start_recording', { sourceId: displayId ?? 0 }),
                    );
                  } finally {
                    recordingStarting.current = false;
                  }
                }
              })
            }
          >
            <Icon name={recording.active ? 'stop' : 'record'} />
          </button>
          <button
            disabled={disabled}
            onClick={() =>
              void (async () => {
                if (await leave())
                  await task(async () => {
                    const image = await native<Capture | null>('import_image');
                    if (image) {
                      await reload();
                      setSelected(image.id);
                      setPage('library');
                      setDirty(false);
                    }
                  });
              })()
            }
          >
            <Icon name="folder" size={17} />
            Open image
          </button>
          <div className="display-control">
            <Icon name="display" size={17} />
            <select
              aria-label="Capture display"
              disabled={disabled}
              value={displayId ?? ''}
              onChange={(e) => setDisplayId(Number(e.target.value))}
            >
              <option value="" disabled>
                Main display
              </option>
              {!!sources?.displays.length && (
                <option value={0}>All displays · separate images</option>
              )}
              {sources?.displays.map((d) => (
                <option key={d.id} value={d.id}>
                  Display {d.id} · {d.width} × {d.height}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              aria-label="Refresh displays and windows"
              title="Refresh sources"
              disabled={disabled}
              onClick={() =>
                void task(async () => {
                  await availableSources();
                })
              }
            >
              <Icon name="restore" size={16} />
            </button>
          </div>
        </section>
        <div className="feedback" aria-live="polite">
          {busy && (
            <span className="busy-status">
              <span className="spinner" />
              Working…
            </span>
          )}
          {error && (
            <div className="banner error" role="alert">
              <Icon name="info" />
              <span>{error}</span>
              <button
                aria-label="Dismiss error"
                className="icon-button"
                onClick={() => setError('')}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="banner success">
              <Icon name="check" />
              <span>{notice}</span>
              <button
                aria-label="Dismiss notice"
                className="icon-button"
                onClick={() => setNotice('')}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
        </div>
        {page === 'library' && !row && (
          <>
            <div className="library-heading">
              <div>
                <h2>A little less to remember.</h2>
                <p>Capture the details. Keep the context.</p>
              </div>
              <div className="library-filters">
                <label className="search">
                  <Icon name="search" size={16} />
                  <input
                    aria-label="Search captures"
                    placeholder="Search captures…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Sort captures"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="name">Name</option>
                </select>
              </div>
            </div>
            {!captures.length ? (
              <div className="empty-library">
                <span className="empty-symbol">
                  <Icon name="region" size={38} />
                </span>
                <h2>{search ? 'No matching captures' : 'Something worth keeping?'}</h2>
                <p>
                  {search
                    ? 'Try a different name, date, or capture mode.'
                    : 'Take your first screenshot using the controls above.'}
                </p>
                <span className="shortcut-hint">
                  {data?.settings.shortcuts[1] ? (
                    <ShortcutKeys value={data.settings.shortcuts[1]} />
                  ) : (
                    'Choose a shortcut in Settings'
                  )}
                  <span>for a region capture</span>
                </span>
              </div>
            ) : (
              <div className="capture-grid">
                {captures.map((c) => (
                  <article className="capture-card" key={c.id}>
                    <button
                      className="capture-open"
                      disabled={disabled || c.missing}
                      onClick={() => {
                        setSelected(c.id);
                        setDirty(false);
                      }}
                      aria-label={`Open ${c.name}`}
                    >
                      <div className="thumbnail">
                        {c.thumbnail && !c.missing ? (
                          <img src={c.thumbnail} alt="" loading="lazy" />
                        ) : (
                          <span>{c.missing ? 'File missing' : 'No thumbnail'}</span>
                        )}
                        <span className="mode-chip">
                          <Icon
                            name={
                              c.mode === 'display'
                                ? 'display'
                                : c.mode === 'region'
                                  ? 'region'
                                  : 'window'
                            }
                            size={13}
                          />
                          {c.mode}
                        </span>
                      </div>
                      <div className="capture-meta">
                        <strong>{c.name}</strong>
                        <span>{date(c.createdAt)}</span>
                        <span>
                          {c.width} × {c.height} · Display/source {c.sourceId}
                        </span>
                      </div>
                    </button>
                    {c.missing && (
                      <button
                        className="text-button"
                        disabled={disabled}
                        onClick={() =>
                          void task(async () => {
                            if (await confirm('Remove this missing capture from history?')) {
                              await native('library_action', { id: c.id, action: 'delete' });
                              await reload();
                            }
                          })
                        }
                      >
                        Remove entry
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        {page === 'library' && row && (
          <>
            <div className="editor-heading">
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => void navigate('library')}
              >
                ← Library
              </button>
              <button
                className="rename-button"
                disabled={disabled}
                onClick={() => setRename(row.name)}
              >
                {row.name}
                <Icon name="edit" size={14} />
              </button>
              <span className="muted">
                {dirty ? 'Unsaved edits' : row.edited ? 'Edited · original preserved' : 'Original'}{' '}
                · {date(row.createdAt)}
              </span>
            </div>
            {source ? (
              <Editor
                key={row.id}
                ref={editor}
                source={source}
                edits={row.edits}
                onChange={() => setDirty(true)}
                onError={setError}
              />
            ) : (
              <div className="empty">{busy ? 'Loading screenshot…' : 'Loading original…'}</div>
            )}
            <div className="editor-actions">
              <div className="action-group">
                <button disabled={disabled || !source} onClick={() => void recordAction('copy')}>
                  <Icon name="copy" />
                  Copy
                </button>
                <button disabled={disabled || !source} onClick={() => void recordAction('ocr')}>
                  <Icon name="scan" />
                  Extract text
                </button>
                <button
                  className="icon-button"
                  aria-label="Pin screenshot"
                  title="Pin above other windows"
                  disabled={disabled || !source}
                  onClick={() => void recordAction('pin')}
                >
                  <Icon name="pin" />
                </button>
                <button
                  className="icon-button"
                  aria-label="Reveal in Finder"
                  title="Reveal in Finder"
                  disabled={disabled}
                  onClick={() => void recordAction('reveal')}
                >
                  <Icon name="folder" />
                </button>
                <button
                  className="icon-button danger"
                  aria-label="Delete screenshot"
                  title="Delete from library"
                  disabled={disabled}
                  onClick={() =>
                    void task(async () => {
                      if (
                        await confirm(
                          'Delete this screenshot and its edits from your library? Exported files will be kept.',
                        )
                      ) {
                        await native('library_action', { id: selected, action: 'delete' });
                        setSelected(undefined);
                        setDirty(false);
                        await reload();
                      }
                    })
                  }
                >
                  <Icon name="trash" />
                </button>
              </div>
              <div className="action-group">
                <button
                  disabled={disabled}
                  onClick={() =>
                    void (async () => {
                      if (await leave()) {
                        setSelected(undefined);
                        setDirty(false);
                      }
                    })()
                  }
                >
                  {dirty ? 'Discard edits' : 'Close'}
                </button>
                <button disabled={disabled || !source} onClick={() => void save(true)}>
                  Save as…
                </button>
                <button
                  className="primary"
                  disabled={disabled || !source}
                  onClick={() => void save(false)}
                >
                  <Icon name="save" />
                  Save {data?.settings.format.toUpperCase()}
                </button>
              </div>
            </div>
            <details className="metadata">
              <summary>Image metadata</summary>
              <dl>
                <dt>Dimensions</dt>
                <dd>
                  {row.width} × {row.height} px
                </dd>
                <dt>Original</dt>
                <dd>
                  {row.originalWidth} × {row.originalHeight} px
                </dd>
                <dt>Mode / source</dt>
                <dd>
                  {row.mode} / {row.sourceId}
                </dd>
                <dt>Export</dt>
                <dd>{row.exportPath ?? 'Not exported yet'}</dd>
                <dt>Capture ID</dt>
                <dd>{row.id}</dd>
              </dl>
            </details>
          </>
        )}
        {page === 'settings' && data && (
          <SettingsPanel
            settings={data.settings}
            disabled={disabled}
            update={(settings) =>
              task(async () => {
                await native('update_settings', { settings });
                await reload();
                setNotice('Settings saved.');
              })
            }
            choose={() =>
              task(async () => {
                await native('choose_directory');
                await reload();
              })
            }
          />
        )}
        {page === 'diagnostics' && (
          <section className="settings-panel">
            <h2>Screen Recording access</h2>
            <p>
              Iris uses Apple’s ScreenCaptureKit. Permission is granted to this application
              separately from other screenshot tools.
            </p>
            <div className="action-group">
              <button
                disabled={disabled}
                onClick={() =>
                  void task(async () => {
                    await refreshPermission();
                  })
                }
              >
                Refresh diagnostics
              </button>
              <button
                disabled={disabled}
                onClick={() =>
                  void task(async () => {
                    await requestAccess();
                  })
                }
              >
                Request access
              </button>
              <button
                disabled={disabled}
                onClick={() =>
                  void task(async () => {
                    await native('open_permissions');
                  })
                }
              >
                Open System Settings
              </button>
            </div>
            {diagnostic && (
              <>
                <dl className="diagnostics-list">
                  <dt>Permission</dt>
                  <dd>
                    {diagnostic.permissionGranted
                      ? 'Granted to Iris'
                      : diagnostic.permissionState === 'denied'
                        ? 'Access unavailable to this running copy of Iris'
                        : 'Access not confirmed yet'}
                  </dd>
                  {!diagnostic.permissionGranted && (
                    <>
                      <dt>Next step</dt>
                      <dd>
                        If Iris is already enabled in System Settings, quit and reopen this copy,
                        then check again.
                      </dd>
                    </>
                  )}
                  <dt>App identity</dt>
                  <dd>{diagnostic.bundleIdentifier}</dd>
                  <dt>Running copy</dt>
                  <dd>{diagnostic.executablePath}</dd>
                  <dt>macOS</dt>
                  <dd>{diagnostic.macOS}</dd>
                </dl>
              </>
            )}
            {!!data?.startupErrors.length && (
              <div role="alert" className="banner error">
                {data.startupErrors.join('\n')}
              </div>
            )}
            <h3>Scrolling capture</h3>
            <p>
              Not included. Reliable cross-application scrolling requires application-specific
              behavior and testing. Standard screen, region, and window captures work independently.
            </p>
          </section>
        )}
      </main>
      {windowPicker && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="window-title">
            <h2 id="window-title">Capture a window</h2>
            <p>Only windows currently available to ScreenCaptureKit are listed.</p>
            <select
              autoFocus
              aria-label="Window to capture"
              value={windowId ?? ''}
              onChange={(e) => setWindowId(Number(e.target.value))}
            >
              {sources?.windows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.application} — {w.title} ({w.width} × {w.height})
                </option>
              ))}
            </select>
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setWindowPicker(false)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || !windowId}
                onClick={() =>
                  void task(async () => {
                    setWindowPicker(false);
                    const capture = await native<Capture>('capture', {
                      mode: 'window',
                      sourceId: windowId,
                    });
                    await reload();
                    setSelected(capture.id);
                    setDirty(false);
                    setPage('library');
                  })
                }
              >
                Capture window
              </button>
            </div>
          </section>
        </div>
      )}
      {ocr !== undefined && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="ocr-title">
            <h2 id="ocr-title">Extracted text</h2>
            <p>Recognized locally with Apple Vision.</p>
            <textarea
              autoFocus
              aria-label="Extracted text"
              value={ocr}
              onChange={(e) => setOcr(e.target.value)}
              placeholder="No text was recognized."
            />
            <div className="modal-actions">
              <button onClick={() => setOcr(undefined)}>Close</button>
              <button
                className="primary"
                disabled={busy || !ocr}
                onClick={() =>
                  void task(async () => {
                    await native('copy_text', { text: ocr });
                    setNotice('Text copied to clipboard.');
                    setOcr(undefined);
                  })
                }
              >
                <Icon name="copy" />
                Copy text
              </button>
            </div>
          </section>
        </div>
      )}
      {rename !== undefined && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-title"
            onSubmit={(e) => {
              e.preventDefault();
              void task(async () => {
                await native('library_action', { id: selected, action: 'rename', name: rename });
                await reload();
                setRename(undefined);
              });
            }}
          >
            <h2 id="rename-title">Rename screenshot</h2>
            <input
              autoFocus
              aria-label="Screenshot name"
              value={rename}
              maxLength={120}
              onChange={(e) => setRename(e.target.value)}
            />
            <div className="modal-actions">
              <button type="button" onClick={() => setRename(undefined)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Rename
              </button>
            </div>
          </form>
        </div>
      )}
      {prompt && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h2 id="confirm-title">{prompt.message}</h2>
            <div className="modal-actions">
              <button
                autoFocus
                onClick={() => {
                  prompt.resolve(false);
                  setPrompt(undefined);
                }}
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  prompt.resolve(true);
                  setPrompt(undefined);
                }}
              >
                Confirm
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
