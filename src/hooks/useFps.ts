import { useEffect, useState, useRef } from 'react';

/**
 * Devuelve un FPS suavizado (media móvil exponencial).
 * Pensado para mostrarse en un HUD; no causa re-render por frame
 * (sólo cuando cambia el valor entero).
 */
export function useFps(smoothing = 0.92): number {
  const [fps, setFps] = useState(0);
  const lastRef = useRef(performance.now());
  const avgRef = useRef(60);
  const lastReportedRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const tick = () => {
      const now = performance.now();
      const dt = now - lastRef.current;
      lastRef.current = now;
      if (dt > 0) {
        const instant = 1000 / dt;
        avgRef.current = avgRef.current * smoothing + instant * (1 - smoothing);
        const rounded = Math.round(avgRef.current);
        if (rounded !== lastReportedRef.current) {
          lastReportedRef.current = rounded;
          setFps(rounded);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [smoothing]);

  return fps;
}
