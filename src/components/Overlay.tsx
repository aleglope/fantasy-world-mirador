import { useEffect, useState } from 'react';
import { useFps } from '../hooks/useFps';
import styles from './Overlay.module.css';

interface Props {
  paused: boolean;
  visible: boolean;
  ready: boolean;
  timeRef: { current: number };
  frameRef: { current: number };
  onTogglePause: () => void;
  onReset: () => void;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function Overlay({
  paused,
  visible,
  ready,
  timeRef,
  frameRef,
  onTogglePause,
  onReset,
}: Props) {
  const fps = useFps();
  const [shaderTime, setShaderTime] = useState(0);
  const [frame, setFrame] = useState(0);

  // Lee los refs cada 250 ms (4 Hz) — suficiente para HUD,
  // sin re-renderizar el árbol React a 60 Hz.
  useEffect(() => {
    const id = window.setInterval(() => {
      setShaderTime(timeRef.current);
      setFrame(frameRef.current);
    }, 250);
    return () => window.clearInterval(id);
  }, [timeRef, frameRef]);

  const cls = [styles.root, ready && visible ? styles.visible : styles.hidden]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} aria-hidden={!visible || !ready}>
      <div className={styles.title}>
        <strong>FANTASY WORLD</strong>
        <em>· mirador del valle ·</em>
      </div>

      <div className={styles.panel}>
        <div className={styles.row}>
          <span>
            <span
              className={`${styles.dot} ${
                paused ? styles.dotPaused : styles.dotLive
              }`}
            />
            {paused ? 'paused' : 'live'}
          </span>
        </div>
        <div className={styles.row}>
          <span>fps</span>
          <span>{fps}</span>
        </div>
        <div className={styles.row}>
          <span>frame</span>
          <span>{frame}</span>
        </div>
        <div className={styles.row}>
          <span>time</span>
          <span>{formatTime(shaderTime)}</span>
        </div>
      </div>

      <div className={styles.controls}>
        <button
          className={styles.btn}
          onClick={onTogglePause}
          aria-label={paused ? 'Reanudar' : 'Pausar'}
          title={paused ? 'Reanudar (Space)' : 'Pausar (Space)'}
        >
          {paused ? '▶' : '⏸'}
        </button>
        <button
          className={styles.btn}
          onClick={onReset}
          aria-label="Reset"
          title="Reset (R)"
        >
          ↺
        </button>
      </div>

      <div className={styles.hint}>space · pausa  ·  r · reset  ·  h · hud</div>
    </div>
  );
}
