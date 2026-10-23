import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { native } from './api';
import type { Diagnostic } from './api';

export function useScreenRecordingPermission() {
  const [diagnostic, setDiagnostic] = useState<Diagnostic>();
  const mounted = useRef(false);
  const version = useRef(0);
  const focused = useRef(document.hasFocus());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stopRetries = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  const accept = useCallback(
    (status: Diagnostic, request: number) => {
      if (mounted.current && request === version.current) {
        setDiagnostic(status);
        if (status.permissionGranted) stopRetries();
      }
      return status;
    },
    [stopRetries],
  );
  const refresh = useCallback(
    async (verifyAccess = true) => {
      const request = ++version.current;
      return accept(await native<Diagnostic>('diagnose', { verifyAccess }), request);
    },
    [accept],
  );
  const recheckAfterSettings = useCallback(() => {
    stopRetries();
    ++version.current;
    if (!mounted.current || !focused.current) return;
    // A grant can propagate after Iris regains focus. Never repeat the permission request.
    for (const delay of [0, 750, 1500, 3000]) {
      timers.current.push(
        setTimeout(() => {
          void refresh().catch(() => {});
        }, delay),
      );
    }
  }, [refresh, stopRetries]);
  const requestAccess = useCallback(async () => {
    const request = ++version.current;
    const status = accept(await native<Diagnostic>('request_permission'), request);
    if (!status.permissionGranted) recheckAfterSettings();
    return status;
  }, [accept, recheckAfterSettings]);
  useEffect(() => {
    mounted.current = true;
    if (!isTauri())
      return () => {
        mounted.current = false;
        stopRetries();
      };
    void refresh(false).catch(() => {});
    const gainedFocus = () => {
      focused.current = true;
      recheckAfterSettings();
    };
    const lostFocus = () => {
      focused.current = false;
      stopRetries();
    };
    const focus = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) gainedFocus();
      else lostFocus();
    });
    // Startup may finish after a newer focus check; revalidate instead of applying an old snapshot.
    const changed = listen('permission-changed', () => recheckAfterSettings());
    const visible = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) gainedFocus();
      else lostFocus();
    };
    window.addEventListener('focus', gainedFocus);
    window.addEventListener('blur', lostFocus);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      ++version.current;
      stopRetries();
      window.removeEventListener('focus', gainedFocus);
      window.removeEventListener('blur', lostFocus);
      document.removeEventListener('visibilitychange', visible);
      for (const subscription of [focus, changed]) void subscription.then((unlisten) => unlisten());
    };
  }, [accept, recheckAfterSettings, refresh, stopRetries]);
  return { diagnostic, refresh, requestAccess };
}
