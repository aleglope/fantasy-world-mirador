import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ShaderLandscape } from './components/ShaderLandscape';
import { Overlay } from './components/Overlay';

function detectWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

export default function App() {
  const webgl2 = useMemo(() => detectWebGL2(), []);

  if (!webgl2) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          padding: 32,
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#e8eaee',
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <h1 style={{ fontWeight: 300, letterSpacing: '0.2em' }}>
            FANTASY WORLD
          </h1>
          <p style={{ opacity: 0.7, lineHeight: 1.6 }}>
            Este mirador necesita un navegador con soporte de{' '}
            <strong>WebGL2</strong>. Probablemente funciona en Chrome,
            Firefox o Safari recientes.{' '}
            <a
              href="https://caniuse.com/webgl2"
              style={{ color: '#7cb1ff' }}
            >
              caniuse · webgl2
            </a>
          </p>
        </div>
      </div>
    );
  }
  return <Scene />;
}

function Scene() {
  const [paused, setPaused] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [resetCounter, setResetCounter] = useState(0);
  const timeRef = useRef(0);
  const frameRef = useRef(0);

  const togglePause = useCallback(() => setPaused((p) => !p), []);
  const reset = useCallback(() => {
    setResetCounter((c) => c + 1);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePause();
      } else if (e.key === 'r' || e.key === 'R') {
        reset();
      } else if (e.key === 'h' || e.key === 'H') {
        setHudVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause, reset]);

  return (
    <>
      <Canvas
        gl={{
          antialias: false,
          powerPreference: 'high-performance',
          alpha: false,
          stencil: false,
          depth: false,
        }}
        dpr={[1, 1.5]}
        flat
        frameloop="always"
        style={{ position: 'absolute', inset: 0 }}
      >
        <ShaderLandscape
          paused={paused}
          resetSignal={resetCounter}
          onFirstFrame={() => setReady(true)}
          timeRef={timeRef}
          frameRef={frameRef}
        />
      </Canvas>
      <Overlay
        paused={paused}
        visible={hudVisible}
        ready={ready}
        timeRef={timeRef}
        frameRef={frameRef}
        onTogglePause={togglePause}
        onReset={reset}
      />
    </>
  );
}
