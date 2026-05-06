import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useControls } from 'leva';
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

  // Controles de performance (leva). Ambos persisten en localStorage.
  //   dprCap   = techo del devicePixelRatio efectivo. 1.0 = no retina;
  //              2.0 = retina nativo (más nítido pero 4× píxeles).
  //   resScale = factor de resolución del FBO landscape (el más caro).
  //              0.65 default; subir si quieres más detalle de montañas,
  //              bajar a 0.45-0.5 en PCs lentos.
  const { dprCap, resScale } = useControls('Performance', {
    dprCap: {
      label: 'DPR cap',
      value: 1.0,
      min: 0.5,
      max: 2.0,
      step: 0.1,
    },
    resScale: {
      label: 'res scale',
      value: 0.65,
      min: 0.4,
      max: 1.0,
      step: 0.05,
    },
  });

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
        dpr={dprCap}
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
          dprCap={dprCap}
          resScale={resScale}
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
