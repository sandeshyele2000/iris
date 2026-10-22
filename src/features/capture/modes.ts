import type { IconName } from '../../components/Icon';
import type { Mode } from './api';

export const modes: { mode: Mode; label: string; icon: IconName; key: string }[] = [
  { mode: 'display', label: 'Full screen', icon: 'display', key: '1' },
  { mode: 'region', label: 'Region', icon: 'region', key: '2' },
  { mode: 'window', label: 'Window', icon: 'window', key: '3' },
];
