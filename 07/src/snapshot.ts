// Download the balloon as a square PNG: the scene drawn once more and copied out in the same task, before the
// frame is handed to the screen (a WebGPU canvas is blank to read after that), cropped to a centred square.
// Only the scene: the ring and the bar are page elements, not in the canvas.
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

let snap: (() => void) | null = null;
export const downloadPng = () => snap?.();

export function Snapshot() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    snap = () => {
      gl.render(scene, camera);
      const src = gl.domElement, s = Math.min(src.width, src.height);
      const out = document.createElement('canvas');
      out.width = out.height = s;
      out.getContext('2d')!.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, s, s);
      out.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `hollow-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, 'image/png');
    };
    return () => { snap = null; };
  }, [gl, scene, camera]);
  return null;
}
