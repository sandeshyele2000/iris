const paths = {
  record: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  stop: 'M5 5h14v14H5z',
  minimize: 'M5 16h14',
  camera:
    'M14.5 5h-5L8 7H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  display: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  region: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M8 8h8v8H8z',
  window: 'M3 4h18v16H3z M3 9h18 M7 6.5h.1 M10 6.5h.1',
  library: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  settings:
    'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  info: 'M12 8h.01 M12 11v6 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  crop: 'M6 3v15h15 M3 6h15v15',
  arrow: 'M4 20 20 4 M10 4h10v10',
  rectangle: 'M4 5h16v14H4z',
  ellipse: 'M21 12a9 7 0 1 1-18 0 9 7 0 0 1 18 0',
  text: 'M4 6V3h16v3 M12 3v18 M8 21h8',
  pixelate: 'M4 4h5v5H4z M15 4h5v5h-5z M9 9h6v6H9z M4 15h5v5H4z M15 15h5v5h-5z',
  undo: 'M9 5 4 10l5 5 M4 10h10a6 6 0 0 1 0 12',
  redo: 'm15 5 5 5-5 5 M20 10H10a6 6 0 0 0 0 12',
  restore: 'M3 10V4 M3 10h6 M3 10a9 9 0 1 1 1 8',
  copy: 'M8 8h12v13H8z M16 8V3H3v13h5',
  save: 'M4 3h13l3 3v15H4z M8 3v6h8V3 M8 21v-8h8v8',
  pin: 'm9 3 10 10 M12 6 6 12 M16 10l-6 6 M6 12l4 4 M8 14l-6 8 M8 4l12 12',
  scan: 'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 8h8 M8 12h8 M8 16h5',
  trash: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  folder: 'M3 6V4h6l3 3h9v13H3z',
  search: 'M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14 M15 15l6 6',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12 M18 6 6 18',
  edit: 'm4 16 12-12 4 4L8 20H4z M14 6l4 4',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
