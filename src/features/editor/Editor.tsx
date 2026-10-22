import { forwardRef, useEffect, useImperativeHandle, useReducer, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { parseEdits, rectangle, renderImage, timeline } from './model';
import type { Edit, Tool } from './model';
export interface EditorHandle {
  snapshot: () => { image: string; edits: Edit[] };
}
interface Props {
  source: string;
  edits: unknown;
  onChange: () => void;
  onError: (message: string) => void;
}
const tools: Tool[] = ['crop', 'arrow', 'rectangle', 'ellipse', 'text', 'pixelate'];
export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { source, edits, onChange, onError },
  ref,
) {
  const [history, dispatch] = useReducer(timeline, {
    past: [],
    present: parseEdits(edits),
    future: [],
  });
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState('#ff5c55');
  const [weight, setWeight] = useState(4);
  const [fontSize, setFontSize] = useState(32);
  const [text, setText] = useState('Text');
  const [image, setImage] = useState<HTMLImageElement>();
  const [draft, setDraft] = useState<Edit>();
  const [dimensions, setDimensions] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Edit | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (alive) setImage(image);
    };
    image.onerror = () => onError('The original image could not be decoded.');
    image.src = source;
    return () => {
      alive = false;
    };
  }, [source]);
  function change(action: Parameters<typeof timeline>[1]) {
    dispatch(action);
    onChange();
  }
  useEffect(() => {
    if (!image || !canvas.current) return;
    try {
      const rendered = renderImage(
        image,
        draft && draft.type !== 'crop' ? [...history.present, draft] : history.present,
      );
      const visible = canvas.current;
      visible.width = rendered.width;
      visible.height = rendered.height;
      const context = visible.getContext('2d')!;
      context.drawImage(rendered, 0, 0);
      setDimensions(`${rendered.width} × ${rendered.height}`);
      if (draft?.type === 'crop') {
        const r = rectangle(draft, rendered.width, rendered.height);
        context.strokeStyle = '#fff';
        context.lineWidth = 2;
        context.setLineDash([8, 5]);
        context.strokeRect(r.x, r.y, r.w, r.h);
      }
    } catch (error) {
      onError(String(error));
    }
  }, [image, history.present, draft]);
  useImperativeHandle(
    ref,
    () => ({
      snapshot() {
        if (!image) throw new Error('Image is still loading');
        return {
          image: renderImage(image, history.present).toDataURL('image/png'),
          edits: history.present,
        };
      },
    }),
    [image, history.present],
  );
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      if (event.target instanceof Element && event.target.matches('input, textarea, select'))
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        change({ type: event.shiftKey ? 'redo' : 'undo' });
      }
      if (event.key === 'Escape') {
        drag.current = undefined;
        setDraft(undefined);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const element = event.currentTarget,
      rect = element.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(element.width, ((event.clientX - rect.left) * element.width) / rect.width),
      ),
      y: Math.max(
        0,
        Math.min(element.height, ((event.clientY - rect.top) * element.height) / rect.height),
      ),
    };
  }
  return (
    <section className="editor" aria-label="Screenshot editor">
      <div className="editor-toolbar" role="toolbar" aria-label="Annotation tools">
        {tools.map((name) => (
          <button
            key={name}
            className={tool === name ? 'selected icon-button' : 'icon-button'}
            aria-label={name === 'pixelate' ? 'Pixelate' : name[0].toUpperCase() + name.slice(1)}
            aria-pressed={tool === name}
            title={name}
            onClick={() => setTool(name)}
          >
            <Icon name={name} />
          </button>
        ))}
        <span className="separator" />
        <button
          className="icon-button"
          aria-label="Undo"
          title="Undo (⌘Z)"
          disabled={!history.past.length}
          onClick={() => change({ type: 'undo' })}
        >
          <Icon name="undo" />
        </button>
        <button
          className="icon-button"
          aria-label="Redo"
          title="Redo (⇧⌘Z)"
          disabled={!history.future.length}
          onClick={() => change({ type: 'redo' })}
        >
          <Icon name="redo" />
        </button>
        <button
          className="icon-button"
          aria-label="Restore original"
          title="Restore original"
          disabled={!history.present.length}
          onClick={() => change({ type: 'restore' })}
        >
          <Icon name="restore" />
        </button>
        <span className="toolbar-spacer" />
        <output>{dimensions} px</output>
      </div>
      <div className="editor-properties">
        <label>
          Color{' '}
          <input
            aria-label="Annotation color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          Stroke{' '}
          <input
            aria-label="Stroke width"
            type="range"
            min="1"
            max="24"
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
          <span>{weight}</span>
        </label>
        {tool === 'text' && (
          <>
            <label>
              Text{' '}
              <input
                aria-label="Annotation text"
                value={text}
                maxLength={1000}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label>
              Size{' '}
              <input
                aria-label="Font size"
                type="number"
                min="8"
                max="240"
                value={fontSize}
                onChange={(e) => setFontSize(Math.max(8, Math.min(240, Number(e.target.value))))}
              />
            </label>
          </>
        )}
        {tool === 'crop' && <span>Drag to crop · Escape to cancel</span>}
        {tool === 'pixelate' && <span>Drag over the area to pixelate</span>}
      </div>
      <div className="canvas-stage">
        {!image && (
          <div className="empty">
            <span className="spinner" />
            Loading image…
          </div>
        )}
        <canvas
          ref={canvas}
          aria-label="Screenshot canvas. Choose a tool and drag to annotate."
          tabIndex={0}
          onPointerDown={(event) => {
            if (!image || event.button !== 0) return;
            const start = point(event);
            event.currentTarget.setPointerCapture(event.pointerId);
            const edit: Edit = { type: tool, ...start, w: 0, h: 0, color, weight, text, fontSize };
            if (tool === 'text') {
              change({ type: 'add', edit });
              return;
            }
            drag.current = edit;
            setDraft(edit);
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            const end = point(event);
            const edit = { ...drag.current, w: end.x - drag.current.x, h: end.y - drag.current.y };
            drag.current = edit;
            setDraft(edit);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            const edit = drag.current;
            drag.current = undefined;
            setDraft(undefined);
            if (edit && (Math.abs(edit.w) >= 2 || Math.abs(edit.h) >= 2))
              change({ type: 'add', edit });
          }}
          onPointerCancel={() => {
            drag.current = undefined;
            setDraft(undefined);
          }}
        />
      </div>
      <div className="editor-hint">
        Original preserved · {history.present.length} edit{history.present.length === 1 ? '' : 's'}{' '}
        · ⌘Z undo
      </div>
    </section>
  );
});
