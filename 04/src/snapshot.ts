// Download the picture as a PNG: the scene drawn once more, with everything that is laid over it in the lens, and copied
// out in the same task, before the frame is handed to the screen (the WebGPU canvas of the lights is blank to read after
// that). Only the picture: the plate and the bars are page elements, not in the canvas.
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

let snap: (() => void) | null = null;
export const downloadPng = () => snap?.();

export function Snapshot() {
  const { gl, advance } = useThree();
  useEffect(() => {
    snap = () => {
      // a whole frame, as the page draws them: the traffic, the grade, the tilt shift, and the lights on their own canvas
      advance(performance.now() / 1000);
      const src = gl.domElement, out = document.createElement('canvas');
      out.width = src.width; out.height = src.height;
      const g = out.getContext('2d')!;
      g.drawImage(src, 0, 0);
      const glow = document.querySelector<HTMLCanvasElement>('canvas.glow');
      if (glow && glow.width && glow.style.display !== 'none') {
        // added to the picture, as the page lays it on
        g.globalCompositeOperation = 'lighter';
        g.drawImage(glow, 0, 0, out.width, out.height);
      }
      out.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `tangle-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, 'image/png');
    };
    return () => { snap = null; };
  }, [gl, advance]);
  return null;
}
