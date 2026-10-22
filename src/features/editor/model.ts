export type Tool = 'crop' | 'arrow' | 'rectangle' | 'ellipse' | 'text' | 'pixelate';
export interface Edit {
  type: Tool;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  weight: number;
  text: string;
  fontSize: number;
}
export interface Timeline {
  past: Edit[][];
  present: Edit[];
  future: Edit[][];
}
export type Action =
  { type: 'add'; edit: Edit } | { type: 'undo' } | { type: 'redo' } | { type: 'restore' };
export function timeline(state: Timeline, action: Action): Timeline {
  if (action.type === 'undo') {
    if (!state.past.length) return state;
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1)!,
      future: [state.present, ...state.future],
    };
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state;
    return {
      past: [...state.past, state.present],
      present: state.future[0],
      future: state.future.slice(1),
    };
  }
  const present = action.type === 'restore' ? [] : [...state.present, action.edit];
  return { past: [...state.past.slice(-99), state.present], present, future: [] };
}
export function parseEdits(value: unknown): Edit[] {
  if (!Array.isArray(value) || value.length > 1000) return [];
  return value.filter(
    (e): e is Edit =>
      e &&
      ['crop', 'arrow', 'rectangle', 'ellipse', 'text', 'pixelate'].includes(e.type) &&
      ['x', 'y', 'w', 'h', 'weight', 'fontSize'].every(
        (k) => typeof e[k] === 'number' && Number.isFinite(e[k]) && Math.abs(e[k]) <= 32768,
      ) &&
      e.weight >= 1 &&
      e.fontSize >= 1 &&
      typeof e.text === 'string' &&
      e.text.length <= 10000 &&
      /^#[0-9a-f]{6}$/i.test(e.color),
  );
}
export function rectangle(edit: Pick<Edit, 'x' | 'y' | 'w' | 'h'>, width: number, height: number) {
  const x = Math.max(0, Math.min(width - 1, Math.floor(Math.min(edit.x, edit.x + edit.w))));
  const y = Math.max(0, Math.min(height - 1, Math.floor(Math.min(edit.y, edit.y + edit.h))));
  const right = Math.min(width, Math.ceil(Math.max(edit.x, edit.x + edit.w)));
  const bottom = Math.min(height, Math.ceil(Math.max(edit.y, edit.y + edit.h)));
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}
export function renderImage(image: HTMLImageElement, edits: Edit[]): HTMLCanvasElement {
  let canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const initial = canvas.getContext('2d');
  if (!initial) throw new Error('Canvas rendering is unavailable');
  initial.drawImage(image, 0, 0);
  for (const edit of edits) {
    const context = canvas.getContext('2d')!;
    const rect = rectangle(edit, canvas.width, canvas.height);
    if (edit.type === 'crop') {
      const cropped = document.createElement('canvas');
      cropped.width = rect.w;
      cropped.height = rect.h;
      cropped
        .getContext('2d')!
        .drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
      canvas = cropped;
      continue;
    }
    context.save();
    context.strokeStyle = edit.color;
    context.fillStyle = edit.color;
    context.lineWidth = edit.weight;
    context.lineCap = 'round';
    switch (edit.type) {
      case 'rectangle':
        context.strokeRect(rect.x, rect.y, rect.w, rect.h);
        break;
      case 'ellipse':
        context.beginPath();
        context.ellipse(
          rect.x + rect.w / 2,
          rect.y + rect.h / 2,
          rect.w / 2,
          rect.h / 2,
          0,
          0,
          Math.PI * 2,
        );
        context.stroke();
        break;
      case 'arrow': {
        const x2 = edit.x + edit.w,
          y2 = edit.y + edit.h;
        const angle = Math.atan2(edit.h, edit.w),
          head = Math.max(12, edit.weight * 4);
        context.beginPath();
        context.moveTo(edit.x, edit.y);
        context.lineTo(x2, y2);
        context.moveTo(x2 - head * Math.cos(angle - 0.5), y2 - head * Math.sin(angle - 0.5));
        context.lineTo(x2, y2);
        context.lineTo(x2 - head * Math.cos(angle + 0.5), y2 - head * Math.sin(angle + 0.5));
        context.stroke();
        break;
      }
      case 'text':
        context.font = `600 ${edit.fontSize}px -apple-system, sans-serif`;
        context.textBaseline = 'top';
        edit.text
          .split('\n')
          .forEach((line, i) => context.fillText(line, edit.x, edit.y + i * edit.fontSize * 1.2));
        break;
      case 'pixelate': {
        const tiny = document.createElement('canvas');
        tiny.width = Math.max(1, Math.floor(rect.w / 16));
        tiny.height = Math.max(1, Math.floor(rect.h / 16));
        tiny
          .getContext('2d')!
          .drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, tiny.width, tiny.height);
        context.imageSmoothingEnabled = false;
        context.drawImage(tiny, 0, 0, tiny.width, tiny.height, rect.x, rect.y, rect.w, rect.h);
        break;
      }
    }
    context.restore();
  }
  return canvas;
}
