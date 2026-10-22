import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
const native = vi.hoisted(() => vi.fn());
vi.mock('../src/features/capture/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  native,
}));
const desktop = vi.hoisted(() => ({
  enabled: false,
  minimize: vi.fn(),
  close: undefined as undefined | ((event: { preventDefault: () => void }) => void),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => desktop.enabled }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: desktop.minimize,
    onCloseRequested: async (handler: (event: { preventDefault: () => void }) => void) => {
      desktop.close = handler;
      return () => {
        desktop.close = undefined;
      };
    },
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
    desktop.listeners.set(event, handler);
    return () => desktop.listeners.delete(event);
  },
}));
const settings = {
  directory: '/Pictures/IrisCaptures',
  filename: 'Capture-{date}',
  format: 'png',
  appearance: 'system',
  shortcuts: ['', '', ''],
  launchAtLogin: false,
};
const sources = { displays: [{ id: 1, x: 0, y: 0, width: 1920, height: 1080 }], windows: [] };
beforeEach(() => {
  native.mockReset();
  desktop.enabled = false;
  desktop.minimize.mockReset();
  desktop.listeners.clear();
  desktop.close = undefined;
  native.mockImplementation(async (command) => {
    if (command === 'library') return { settings, captures: [], startupErrors: [] };
    if (command === 'list_sources') return sources;
    return {};
  });
});
it('shows an accessible empty library and settings', async () => {
  render(<App />);
  await screen.findByText('Something worth keeping?');
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(await screen.findByText('Saving & exports')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Filename format'), { target: { value: 'Team-{mode}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() =>
    expect(native).toHaveBeenCalledWith('update_settings', {
      settings: { ...settings, filename: 'Team-{mode}' },
    }),
  );
});
it('shows a denied capture without repeatedly requesting permission', async () => {
  native.mockImplementation(async (command) => {
    if (command === 'library') return { settings, captures: [], startupErrors: [] };
    if (command === 'list_sources') throw { code: 'PERMISSION_REQUIRED', message: 'Denied' };
    if (command === 'request_permission') return { permissionGranted: false };
  });
  render(<App />);
  await screen.findByText('Something worth keeping?');
  fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Denied');
  expect(native).not.toHaveBeenCalledWith('request_permission');
  expect(native.mock.calls.some(([command]) => command === 'capture')).toBe(false);
});
it('reports capture API failure with native diagnostics', async () => {
  native.mockImplementation(async (command) => {
    if (command === 'library') return { settings, captures: [], startupErrors: [] };
    if (command === 'list_sources') return sources;
    if (command === 'capture')
      throw {
        code: 'NATIVE_ERROR',
        message: 'Capture rejected',
        domain: 'SCStreamErrorDomain',
        nativeCode: -3801,
      };
  });
  render(<App />);
  await screen.findByText('Something worth keeping?');
  fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('SCStreamErrorDomain -3801');
  expect(native).toHaveBeenCalledWith('capture', { mode: 'display', sourceId: 1 });
});
it('window selection can be cancelled with Escape without capture', async () => {
  render(<App />);
  await screen.findByText('Something worth keeping?');
  fireEvent.click(screen.getByRole('button', { name: 'Window' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Capture a window')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(native.mock.calls.some(([command]) => command === 'capture')).toBe(false);
});

it('minimizes Iris without requesting permission or triggering capture', async () => {
  desktop.enabled = true;
  desktop.minimize.mockResolvedValue(undefined);
  render(<App />);
  await screen.findByText('Something worth keeping?');
  const minimize = screen.getByRole('button', { name: 'Minimize Iris' });
  await waitFor(() => expect(minimize).toBeEnabled());
  fireEvent.click(minimize);
  await waitFor(() => expect(desktop.minimize).toHaveBeenCalledOnce());
  expect(
    native.mock.calls.some(
      ([command]) => command === 'capture' || command === 'request_permission',
    ),
  ).toBe(false);
});
it('opens a completed background capture from the backend without invoking capture again', async () => {
  desktop.enabled = true;
  let completed = false;
  const capture = {
    id: 'capture-id',
    name: 'Background area',
    mode: 'region',
    sourceId: 1,
    createdAt: new Date().toISOString(),
    width: 400,
    height: 200,
    originalWidth: 400,
    originalHeight: 200,
    edits: [],
    edited: false,
    exportPath: null,
  };
  native.mockImplementation(async (command) => {
    if (command === 'library')
      return { settings, captures: completed ? [capture] : [], startupErrors: [] };
    if (command === 'library_image') return 'data:image/png;base64,fixture';
    if (command === 'recording_status') return { active: false };
  });
  render(<App />);
  await screen.findByText('Something worth keeping?');
  completed = true;
  await act(async () => {
    desktop.listeners.get('capture-completed')!({ payload: capture.id });
  });
  expect(await screen.findByText('Background area')).toBeInTheDocument();
  expect(
    native.mock.calls.some(
      ([command]) => command === 'capture' || command === 'request_permission',
    ),
  ).toBe(false);
});

it('starts recording the selected display and stops to save the MP4', async () => {
  native.mockImplementation(async (command) => {
    if (command === 'library') return { settings, captures: [], startupErrors: [] };
    if (command === 'list_sources') return sources;
    if (command === 'start_recording') return { active: true };
    if (command === 'stop_recording') return { active: false, path: '/Pictures/Recording.mp4' };
  });
  render(<App />);
  await screen.findByText('Something worth keeping?');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh displays and windows' }));
  await waitFor(() => expect(native).toHaveBeenCalledWith('list_sources'));
  fireEvent.change(screen.getByLabelText('Capture display'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record screen' }));
  const stop = await screen.findByRole('button', { name: 'Stop recording' });
  expect(native).toHaveBeenCalledWith('start_recording', { sourceId: 1 });
  await waitFor(() => expect(stop).toBeEnabled());
  fireEvent.click(stop);
  expect(await screen.findByText('Recording saved to /Pictures/Recording.mp4')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record screen' })).toBeInTheDocument();
  expect(native).not.toHaveBeenCalledWith('request_permission');
});

it('keeps recording controls usable after a failed start and receives tray stop updates', async () => {
  desktop.enabled = true;
  native.mockImplementation(async (command) => {
    if (command === 'library') return { settings, captures: [], startupErrors: [] };
    if (command === 'recording_status') return { active: false };
    if (command === 'start_recording')
      throw { code: 'PERMISSION_REQUIRED', message: 'Recording denied' };
  });
  render(<App />);
  await screen.findByText('Something worth keeping?');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Record screen' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Record screen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Recording denied');
  expect(screen.getByRole('button', { name: 'Record screen' })).toBeEnabled();
  await act(async () => {
    desktop.listeners.get('recording-changed')!({ payload: { active: true } });
  });
  expect(screen.getByRole('button', { name: 'Stop recording' })).toBeInTheDocument();
  await act(async () => {
    desktop.listeners.get('recording-changed')!({
      payload: { active: false, path: '/Pictures/From-tray.mp4' },
    });
  });
  expect(screen.getByRole('button', { name: 'Record screen' })).toBeInTheDocument();
  expect(await screen.findByText('Recording saved to /Pictures/From-tray.mp4')).toBeInTheDocument();
});

it('preserves the recording webview when the native close button is pressed', async () => {
  desktop.enabled = true;
  native.mockImplementation(async (command) => {
    if (command === 'library') return { settings, captures: [], startupErrors: [] };
    if (command === 'recording_status') return { active: true };
  });
  render(<App />);
  await screen.findByRole('button', { name: 'Stop recording' });
  const preventDefault = vi.fn();
  await act(async () => {
    desktop.close!({ preventDefault });
  });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('captures shortcut keys, supports cancellation and clearing, and removes the theme selector', async () => {
  render(<App />);
  await screen.findByText('Something worth keeping?');
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.queryByLabelText('Appearance')).not.toBeInTheDocument();
  const recorder = await screen.findByRole('button', { name: 'Full screen shortcut' });
  fireEvent.click(recorder);
  await screen.findByText('Press shortcut…');
  fireEvent.keyDown(recorder, { code: 'KeyK', key: 'k', metaKey: true, shiftKey: true });
  expect(within(recorder).getByText('⌘')).toBeInTheDocument();
  expect(within(recorder).getByText('⇧')).toBeInTheDocument();
  expect(within(recorder).getByText('K')).toBeInTheDocument();
  fireEvent.click(recorder);
  await screen.findByText('Press shortcut…');
  fireEvent.keyDown(recorder, { key: 'Escape', code: 'Escape' });
  expect(within(recorder).getByText('K')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() =>
    expect(native).toHaveBeenCalledWith('update_settings', {
      settings: { ...settings, shortcuts: ['Shift+Super+KeyK', '', ''] },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Clear full screen shortcut' }));
  expect(within(recorder).getByText('Set shortcut')).toBeInTheDocument();
});

it('releases global shortcuts while editing and restores them when leaving the recorder', async () => {
  desktop.enabled = true;
  render(<App />);
  await screen.findByText('Something worth keeping?');
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  const recorder = await screen.findByRole('button', { name: 'Region shortcut' });
  fireEvent.click(recorder);
  await screen.findByText('Press shortcut…');
  expect(native).toHaveBeenCalledWith('set_shortcut_capture', { active: true });
  fireEvent.blur(window);
  await waitFor(() =>
    expect(native).toHaveBeenCalledWith('set_shortcut_capture', { active: false }),
  );
});
