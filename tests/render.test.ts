import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect, it, vi } from 'vitest';
import { renderImage } from '../src/features/editor/model';
import type { Edit } from '../src/features/editor/model';
const edit: Edit = {
  type: 'crop',
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  color: '#ff0000',
  weight: 2,
  fontSize: 16,
  text: 'A',
};
async function fixture() {
  const canvas = createCanvas(40, 30);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 40, 30);
  context.fillStyle = '#000000';
  context.fillRect(0, 0, 20, 30);
  const image = await loadImage(canvas.toBuffer('image/png'));
  // The browser renderer uses naturalWidth/Height, while the native test Image uses width/height.
  Object.defineProperties(image, {
    naturalWidth: { value: image.width },
    naturalHeight: { value: image.height },
  });
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? createCanvas(1, 1) : original(tag)) as typeof document.createElement);
  return image as unknown as HTMLImageElement;
}
it('crops actual image pixels and leaves the original untouched', async () => {
  const image = await fixture();
  const output = renderImage(image, [{ ...edit, x: 20, y: 5, w: 10, h: 10 }]);
  expect([output.width, output.height]).toEqual([10, 10]);
  expect([...output.getContext('2d')!.getImageData(5, 5, 1, 1).data]).toEqual([255, 255, 255, 255]);
  const original = renderImage(image, []);
  expect([original.width, original.height]).toEqual([40, 30]);
  expect([...original.getContext('2d')!.getImageData(5, 5, 1, 1).data]).toEqual([0, 0, 0, 255]);
});
it('pixelation changes high-frequency content only inside the selected area', async () => {
  const image = await fixture();
  const output = renderImage(image, [{ ...edit, type: 'pixelate', x: 10, y: 0, w: 20, h: 30 }]);
  const context = output.getContext('2d')!;
  const changed = context.getImageData(12, 15, 1, 1).data;
  expect(changed[0]).toBeGreaterThan(0);
  expect(changed[0]).toBeLessThan(255);
  expect([...context.getImageData(2, 2, 1, 1).data]).toEqual([0, 0, 0, 255]);
  expect([...context.getImageData(38, 2, 1, 1).data]).toEqual([255, 255, 255, 255]);
});
it('renders arrows, rectangles, ellipses and text to flattened pixels', async () => {
  const image = await fixture();
  const output = renderImage(
    image,
    ['arrow', 'rectangle', 'ellipse', 'text'].map((type, i) => ({
      ...edit,
      type: type as Edit['type'],
      x: 3 + i * 6,
      y: 3,
      w: 12,
      h: 18,
    })),
  );
  const bytes = output.getContext('2d')!.getImageData(0, 0, 40, 30).data;
  expect(
    [...bytes].filter((_, i) => i % 4 === 0 && bytes[i] > bytes[i + 1] + 50).length,
  ).toBeGreaterThan(20);
});
