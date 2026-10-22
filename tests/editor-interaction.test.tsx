import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Editor } from '../src/features/editor/Editor';
import type { EditorHandle } from '../src/features/editor/Editor';
vi.mock('../src/features/editor/model', async (original) => ({
  ...(await original<object>()),
  renderImage: () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 100;
    return canvas;
  },
}));
it('adds text through the canvas and supports keyboard undo and redo', async () => {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,rendered',
  );
  vi.stubGlobal(
    'Image',
    class {
      onload?: () => void;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  const handle = createRef<EditorHandle>();
  const changed = vi.fn();
  render(<Editor ref={handle} source="fixture" edits={[]} onChange={changed} onError={vi.fn()} />);
  await waitFor(() => expect(drawImage).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Text' }));
  fireEvent.change(screen.getByLabelText('Annotation text'), {
    target: { value: 'Internal note' },
  });
  const canvas = screen.getByLabelText('Screenshot canvas. Choose a tool and drag to annotate.');
  Object.assign(canvas, { setPointerCapture: vi.fn() });
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 100,
  } as DOMRect);
  // jsdom does not provide PointerEvent by default.
  vi.stubGlobal('PointerEvent', MouseEvent);
  fireEvent.pointerDown(canvas, { button: 0, clientX: 40, clientY: 30, pointerId: 1 });
  expect(handle.current!.snapshot().edits[0]).toMatchObject({
    type: 'text',
    text: 'Internal note',
    x: 40,
    y: 30,
  });
  act(() => fireEvent.keyDown(window, { key: 'z', metaKey: true }));
  expect(handle.current!.snapshot().edits).toEqual([]);
  act(() => fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true }));
  expect(handle.current!.snapshot().edits).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Restore original' }));
  expect(handle.current!.snapshot().edits).toEqual([]);
  expect(changed).toHaveBeenCalled();
  vi.unstubAllGlobals();
});
