import { invoke, isTauri } from '@tauri-apps/api/core';

export type Mode = 'display' | 'region' | 'window';
export interface Recording {
  active: boolean;
  path?: string;
}
export interface Diagnostic {
  permissionGranted: boolean;
  macOS: string;
}
export interface Sources {
  displays: { id: number; width: number; height: number; x: number; y: number }[];
  windows: { id: number; title: string; application: string; width: number; height: number }[];
}
export interface Capture {
  id: string;
  name: string;
  createdAt: string;
  mode: Mode | 'import';
  sourceId: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  edited: boolean;
  edits: unknown;
  exportPath: string | null;
  thumbnail?: string;
  missing?: boolean;
}
export interface Settings {
  directory: string;
  filename: string;
  format: 'png' | 'jpeg';
  appearance: 'system' | 'light' | 'dark';
  shortcuts: [string, string, string];
  launchAtLogin: boolean;
}
export interface Library {
  settings: Settings;
  captures: Capture[];
  startupErrors: string[];
}
export interface CaptureError {
  code: string;
  message: string;
  domain?: string;
  nativeCode?: number;
}
export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const failure = error as CaptureError;
    return `${failure.code ?? 'ERROR'}: ${failure.message}${failure.domain ? ` (${failure.domain} ${failure.nativeCode})` : ''}`;
  }
  return String(error);
}
export type Command =
  | 'diagnose'
  | 'request_permission'
  | 'list_sources'
  | 'library'
  | 'library_image'
  | 'capture'
  | 'start_recording'
  | 'stop_recording'
  | 'recording_status'
  | 'import_image'
  | 'save_edit'
  | 'export_image'
  | 'library_action'
  | 'copy_text'
  | 'open_permissions'
  | 'choose_directory'
  | 'update_settings'
  | 'set_shortcut_capture';
export async function native<T>(command: Command, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri())
    throw {
      code: 'DESKTOP_REQUIRED',
      message:
        'Open the desktop app with pnpm app:dev. Browser previews cannot capture or access your library.',
    };
  return invoke<T>(command, args);
}
