import { describe, expect, it } from 'vitest';
import { parseEdits, rectangle, timeline } from '../src/features/editor/model';
import type { Edit, Timeline } from '../src/features/editor/model';
const arrow: Edit = {
  type: 'arrow',
  x: 10,
  y: 10,
  w: 20,
  h: 30,
  color: '#ff0000',
  weight: 4,
  text: '',
  fontSize: 32,
};
const initial: Timeline = { past: [], present: [], future: [] };
describe('non-destructive editor', () => {
  it('supports undo, redo, restoration and branching without changing original operations', () => {
    const first = timeline(initial, { type: 'add', edit: arrow });
    const second = timeline(first, { type: 'add', edit: { ...arrow, type: 'crop' } });
    const undone = timeline(second, { type: 'undo' });
    expect(undone.present).toEqual([arrow]);
    expect(timeline(undone, { type: 'redo' }).present).toEqual(second.present);
    const branch = timeline(undone, {
      type: 'add',
      edit: { ...arrow, type: 'text', text: 'Private' },
    });
    expect(branch.future).toEqual([]);
    expect(first.present).toEqual([arrow]);
    expect(initial.present).toEqual([]);
    const restored = timeline(branch, { type: 'restore' });
    expect(restored.present).toEqual([]);
    expect(timeline(restored, { type: 'undo' }).present).toEqual(branch.present);
  });
  it('normalizes reversed drags and clips regions to image pixels', () => {
    expect(rectangle({ x: 90, y: 80, w: -70, h: -50 }, 100, 100)).toEqual({
      x: 20,
      y: 30,
      w: 70,
      h: 50,
    });
    expect(rectangle({ x: -10, y: -20, w: 200, h: 300 }, 100, 80)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
  });
  it('rejects malformed persisted annotations', () => {
    expect(
      parseEdits([
        arrow,
        { ...arrow, x: Infinity },
        { ...arrow, color: 'url(x)' },
        { type: 'script' },
      ]),
    ).toEqual([arrow]);
    expect(parseEdits({})).toEqual([]);
  });
});
