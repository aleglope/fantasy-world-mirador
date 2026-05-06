# Fantasy World · Zona de Observación — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montar el shader de paisaje IQ adaptado a GLSL3 dentro de un proyecto React Three Fiber con experiencia cinemática fullscreen y HUD minimalista.

**Architecture:** Canvas R3F + dos escenas de fullscreen quad (landscape shader y copy shader) + ping-pong de dos FBO `HalfFloatType` para alimentar `iChannel0` con el frame anterior. `ShaderLandscape` toma el control del render loop con `useFrame(priority=1)`. HUD HTML fuera del Canvas.

**Tech Stack:** Vite + React 18 + TypeScript + Three.js (WebGL2) + React Three Fiber + drei.

**Decisiones tomadas en spec (no rediscutir):**
- Modo cinemático fullscreen, observación pura (sin control de cámara, sin sliders)
- DPR cap: `MAX_DPR = 1.5`
- Pausa congela `iTime` y `iFrame` (no consume GPU)
- Reset pone `iFrame=0` y limpia FBOs
- Sin tests automáticos (verificación visual + tsc + build)
- No es repo git todavía: los `git add/commit` están excluidos del plan; al final hay tarea opcional de `git init`

**Estado inicial (ya hecho):**
- `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `.gitignore`, `public/favicon.svg`
- `src/index.css`, `src/main.tsx`
- `src/shaders/landscape.frag.ts` (shader principal completo, GLSL3, con wrapper `main()`)

---

## Task 1: Instalar dependencias

**Files:** ninguno (sólo side-effect en `node_modules/` y `pnpm-lock.yaml`).

- [ ] **Step 1.1: Instalar paquetes**

Run desde la raíz del proyecto:
```bash
pnpm install
```

Expected: lockfile creado, `node_modules/` poblado, sin errores de peer dependency bloqueantes (los warnings de three peer son aceptables; r3f 8.x es compatible con three 0.170).

- [ ] **Step 1.2: Verificar que el typecheck arranca**

```bash
pnpm typecheck
```

Expected: tsc compila los archivos existentes (`main.tsx` y los configs). Puede haber error porque `App` se importa pero no existe. Eso se resuelve en Task 7. No bloquea.

---

## Task 2: Vertex shader passthrough

**Files:**
- Create: `src/shaders/fullscreen.vert.ts`

- [ ] **Step 2.1: Escribir el vertex shader**

Contenido exacto del archivo:
```ts
// Vertex shader passthrough para fullscreen quads (GLSL ES 3.00).
// El plano se posiciona en NDC (-1..1) directamente, sin matrices.
// Three.js inyecta `in vec3 position;` y `in vec2 uv;` cuando se usa
// ShaderMaterial con glslVersion = THREE.GLSL3.

const vertexShader = /* glsl */ `precision highp float;

out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

export default vertexShader;
```

---

## Task 3: Copy fragment shader (display pass)

**Files:**
- Create: `src/shaders/copy.frag.ts`

- [ ] **Step 3.1: Escribir el copy shader**

Contenido exacto:
```ts
// Copy fragment shader: muestrea uTexture y la escribe a pantalla.
// Se usa en el segundo pase de render (FBO -> canvas).

const copyShader = /* glsl */ `precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;

void main() {
  outColor = texture(uTexture, vUv);
}
`;

export default copyShader;
```

---

## Task 4: Hook `usePingPongFBO`

**Files:**
- Create: `src/hooks/usePingPongFBO.ts`

- [ ] **Step 4.1: Escribir el hook**

Contenido exacto:
```ts
import { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';

export interface PingPongFBO {
  read: THREE.WebGLRenderTarget;
  write: THREE.WebGLRenderTarget;
  swap: () => void;
  setSize: (w: number, h: number) => void;
}

interface Options {
  width: number;
  height: number;
  type?: THREE.TextureDataType;
}

/**
 * Crea dos render targets y los rota (read/write).
 * - HalfFloat por defecto (suficiente rango/precisión para HDR + matriz cámara).
 * - LinearFilter (necesario para textureLod en la reproyección).
 * - ClampToEdge.
 * - Sin depth/stencil (es un quad 2D).
 */
export function usePingPongFBO({
  width,
  height,
  type = THREE.HalfFloatType,
}: Options): PingPongFBO {
  const ref = useRef<{
    a: THREE.WebGLRenderTarget;
    b: THREE.WebGLRenderTarget;
    read: THREE.WebGLRenderTarget;
    write: THREE.WebGLRenderTarget;
  } | null>(null);

  const fbo = useMemo(() => {
    const make = () =>
      new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
        format: THREE.RGBAFormat,
        type,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
      });
    const a = make();
    const b = make();
    const obj = { a, b, read: a, write: b };
    ref.current = obj;
    return obj;
    // size and type updates are handled imperatively via setSize; do not
    // recreate on resize (would lose the iChannel0 content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      fbo.a.dispose();
      fbo.b.dispose();
    };
  }, [fbo]);

  return {
    get read() {
      return fbo.read;
    },
    get write() {
      return fbo.write;
    },
    swap() {
      const tmp = fbo.read;
      fbo.read = fbo.write;
      fbo.write = tmp;
    },
    setSize(w, h) {
      const ww = Math.max(1, Math.floor(w));
      const hh = Math.max(1, Math.floor(h));
      fbo.a.setSize(ww, hh);
      fbo.b.setSize(ww, hh);
    },
  };
}
```

- [ ] **Step 4.2: Verificar que tipa**

```bash
pnpm typecheck
```

Expected: ningún error nuevo proveniente de `usePingPongFBO.ts`. (Los errores por componentes faltantes siguen ahí, los resolveremos en tareas siguientes.)

---

## Task 5: Hook `useFps`

**Files:**
- Create: `src/hooks/useFps.ts`

- [ ] **Step 5.1: Escribir el hook**

Contenido exacto:
```ts
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
```

---

## Task 6: Componente `ShaderLandscape`

**Files:**
- Create: `src/components/ShaderLandscape.tsx`

Este es el corazón. Toma control del render loop, hace el ping-pong, alimenta uniforms.

- [ ] **Step 6.1: Escribir el componente**

Contenido exacto:
```tsx
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import landscapeFrag from '../shaders/landscape.frag';
import copyFrag from '../shaders/copy.frag';
import fullscreenVert from '../shaders/fullscreen.vert';
import { usePingPongFBO } from '../hooks/usePingPongFBO';

const MAX_DPR = 1.5;

interface Props {
  paused: boolean;
  resetSignal: number;
  onFirstFrame?: () => void;
}

export function ShaderLandscape({ paused, resetSignal, onFirstFrame }: Props) {
  const { gl, size } = useThree();

  // Resolución efectiva
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const initW = Math.max(1, Math.floor(size.width * dpr));
  const initH = Math.max(1, Math.floor(size.height * dpr));

  const fbo = usePingPongFBO({ width: initW, height: initH });

  // Materiales
  const landscapeMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVert,
      fragmentShader: landscapeFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        iResolution: { value: new THREE.Vector3(initW, initH, 1) },
        iTime: { value: 0 },
        iFrame: { value: 0 },
        iChannel0: { value: null },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVert,
      fragmentShader: copyFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTexture: { value: null },
      },
    });
  }, []);

  // Escenas + cámara ortográfica trivial
  const { sceneA, sceneB, fsCamera } = useMemo(() => {
    const geom = new THREE.PlaneGeometry(2, 2);
    const sceneA = new THREE.Scene();
    const meshA = new THREE.Mesh(geom, landscapeMat);
    meshA.frustumCulled = false;
    sceneA.add(meshA);
    const sceneB = new THREE.Scene();
    const meshB = new THREE.Mesh(geom, copyMat);
    meshB.frustumCulled = false;
    sceneB.add(meshB);
    const fsCamera = new THREE.Camera();
    return { sceneA, sceneB, fsCamera };
  }, [landscapeMat, copyMat]);

  // Estado interno (no React state — evita re-renders por frame)
  const stateRef = useRef({
    time: 0,
    frame: 0,
    lastReportedFrame: -1,
    notifiedFirst: false,
  });

  // Resize debounced
  useEffect(() => {
    const handle = setTimeout(() => {
      const w = Math.max(1, Math.floor(size.width * dpr));
      const h = Math.max(1, Math.floor(size.height * dpr));
      fbo.setSize(w, h);
      landscapeMat.uniforms.iResolution.value.set(w, h, 1);
      stateRef.current.frame = 0; // invalida reproyección
    }, 100);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  // Reset
  useEffect(() => {
    if (resetSignal === 0) return;
    stateRef.current.frame = 0;
    stateRef.current.time = 0;
    const prev = gl.getRenderTarget();
    const clearColor = new THREE.Color();
    gl.getClearColor(clearColor);
    const clearAlpha = gl.getClearAlpha();
    gl.setClearColor(0x000000, 0);
    gl.setRenderTarget(fbo.read);
    gl.clear(true, true, true);
    gl.setRenderTarget(fbo.write);
    gl.clear(true, true, true);
    gl.setRenderTarget(prev);
    gl.setClearColor(clearColor, clearAlpha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  // Cleanup
  useEffect(() => {
    return () => {
      landscapeMat.dispose();
      copyMat.dispose();
    };
  }, [landscapeMat, copyMat]);

  // Render loop manual: priority=1 hace que R3F NO auto-renderice
  useFrame((_, delta) => {
    const s = stateRef.current;

    if (!paused) {
      s.time += delta;

      // Pase 1: landscape -> writeFBO
      landscapeMat.uniforms.iTime.value = s.time;
      landscapeMat.uniforms.iFrame.value = s.frame;
      landscapeMat.uniforms.iChannel0.value = fbo.read.texture;

      gl.setRenderTarget(fbo.write);
      gl.render(sceneA, fsCamera);

      // Pase 2: copia writeFBO -> canvas
      copyMat.uniforms.uTexture.value = fbo.write.texture;
      gl.setRenderTarget(null);
      gl.render(sceneB, fsCamera);

      fbo.swap();
      s.frame += 1;

      if (!s.notifiedFirst && s.frame > 1) {
        s.notifiedFirst = true;
        onFirstFrame?.();
      }
    } else {
      // En pausa: sólo redibujar la última textura al canvas
      copyMat.uniforms.uTexture.value = fbo.read.texture;
      gl.setRenderTarget(null);
      gl.render(sceneB, fsCamera);
    }
  }, 1);

  // Componente "presencial" — no añade ningún mesh a la escena de R3F
  return null;
}
```

- [ ] **Step 6.2: Crear los module declarations para los .ts shaders**

(No hace falta — son módulos `.ts` normales que exportan strings. TypeScript los resuelve sin shims.)

- [ ] **Step 6.3: Verificar typecheck**

```bash
pnpm typecheck
```

Expected: errores sólo por `App.tsx`/`Overlay.tsx` faltantes; nada de `ShaderLandscape.tsx`.

---

## Task 7: Estilos del Overlay

**Files:**
- Create: `src/components/Overlay.module.css`

- [ ] **Step 7.1: Escribir el CSS**

Contenido exacto:
```css
.root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Inter', system-ui, sans-serif;
  color: #e8eaee;
  user-select: none;
  opacity: 0;
  transition: opacity 600ms ease;
}

.root.visible {
  opacity: 1;
}

.root.hidden {
  opacity: 0;
  pointer-events: none;
}

.title {
  position: absolute;
  top: 28px;
  left: 32px;
  letter-spacing: 0.32em;
  font-size: 13px;
  font-weight: 300;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.title strong {
  display: block;
  font-weight: 300;
  font-size: 18px;
  letter-spacing: 0.42em;
  margin-bottom: 6px;
}

.title em {
  font-style: normal;
  opacity: 0.55;
  font-size: 11px;
  letter-spacing: 0.28em;
}

.panel {
  position: absolute;
  bottom: 28px;
  left: 32px;
  padding: 12px 16px;
  background: rgba(10, 14, 18, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.7;
  letter-spacing: 0.08em;
  font-variant-numeric: tabular-nums;
  pointer-events: auto;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.row span:first-child {
  opacity: 0.5;
  min-width: 48px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 8px;
  vertical-align: middle;
}

.dotLive {
  background: #7cb1ff;
  box-shadow: 0 0 8px #7cb1ff;
}

.dotPaused {
  background: #d6a37b;
}

.controls {
  position: absolute;
  bottom: 28px;
  right: 32px;
  display: flex;
  gap: 10px;
  pointer-events: auto;
}

.btn {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(10, 14, 18, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #e8eaee;
  font-size: 14px;
  cursor: pointer;
  transition: background 180ms ease, transform 180ms ease,
    border-color 180ms ease;
  display: grid;
  place-items: center;
}

.btn:hover {
  background: rgba(124, 177, 255, 0.18);
  border-color: rgba(124, 177, 255, 0.4);
  transform: translateY(-1px);
}

.btn:active {
  transform: translateY(0);
}

.hint {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  letter-spacing: 0.32em;
  opacity: 0.4;
  text-transform: uppercase;
}
```

---

## Task 8: Componente `Overlay`

**Files:**
- Create: `src/components/Overlay.tsx`

- [ ] **Step 8.1: Escribir el componente**

Contenido exacto:
```tsx
import { useEffect, useState } from 'react';
import { useFps } from '../hooks/useFps';
import styles from './Overlay.module.css';

interface Props {
  paused: boolean;
  visible: boolean;
  ready: boolean;
  startTime: number;
  resetCounter: number;
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
  startTime,
  resetCounter,
  onTogglePause,
  onReset,
}: Props) {
  const fps = useFps();
  const [elapsed, setElapsed] = useState(0);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (paused) return;
    let raf = 0;
    const tick = () => {
      setElapsed((performance.now() - startTime) / 1000);
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, startTime]);

  useEffect(() => {
    setElapsed(0);
    setFrame(0);
  }, [resetCounter]);

  const cls = [styles.root, ready && visible ? styles.visible : styles.hidden]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} aria-hidden={!visible}>
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
          <span>{formatTime(elapsed)}</span>
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
```

---

## Task 9: `App.tsx` (glue)

**Files:**
- Create: `src/App.tsx`

- [ ] **Step 9.1: Escribir App**

Contenido exacto:
```tsx
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
  const startTimeRef = useRef(performance.now());

  const togglePause = useCallback(() => setPaused((p) => !p), []);
  const reset = useCallback(() => {
    setResetCounter((c) => c + 1);
    startTimeRef.current = performance.now();
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
        />
      </Canvas>
      <Overlay
        paused={paused}
        visible={hudVisible}
        ready={ready}
        startTime={startTimeRef.current}
        resetCounter={resetCounter}
        onTogglePause={togglePause}
        onReset={reset}
      />
    </>
  );
}
```

- [ ] **Step 9.2: Verificar typecheck completo**

```bash
pnpm typecheck
```

Expected: PASS sin errores.

---

## Task 10: README en castellano

**Files:**
- Create: `README.md`

- [ ] **Step 10.1: Escribir README**

Contenido exacto:
```markdown
# Fantasy World · Mirador del Valle

Observatorio cinemático de un shader de paisaje fantástico (estilo Inigo
Quilez "Selva") montado en React Three Fiber.

## Stack

Vite · React 18 · TypeScript · Three.js (WebGL2) · React Three Fiber · drei.

## Ejecutar

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # build de producción
pnpm preview      # sirve el build
pnpm typecheck    # tsc --noEmit
```

## Controles

- `Space` — pausa / reanuda
- `R` — reset (limpia la reproyección temporal)
- `H` — oculta / muestra el HUD

## Cómo está montado

El shader necesita su propia salida del frame anterior como input
(`iChannel0`) para hacer **reproyección temporal** y para almacenar la
matriz de cámara en los píxeles `(0..2, 0)`. Por eso usamos un
**ping-pong** de dos `WebGLRenderTarget`:

```
useFrame(priority=1):
  iChannel0 ← readFBO.texture
  render(landscape  → writeFBO)   // pase 1: el shader IQ
  render(copy       → canvas)     // pase 2: muestra writeFBO
  swap(read, write); iFrame++
```

`priority=1` desactiva el auto-render de R3F y nos cede el control total
del loop. La cámara y la animación están baked dentro del propio shader
(`ro`/`ta` con un sin(0.01·t)).

### Por qué dos FBO `HalfFloatType`

- La fila inferior del framebuffer guarda la matriz de cámara como floats
  con signo (negativos del orden de -400). `UnsignedByte` no llega.
- Los colores intermedios del cielo y las nubes son HDR antes del tone
  mapping. `HalfFloat` es el sweet spot rango/precisión/ancho de banda.

### DPR cap

`MAX_DPR = 1.5`. El shader es muy pesado: en retina puro (DPR 2 o 3) el
fps cae bajo 30 incluso en GPUs decentes. Si tu equipo va sobrado, sube
el cap en `src/components/ShaderLandscape.tsx`.

## Estructura

```
src/
  shaders/             # GLSL (como string templates en .ts)
  hooks/               # usePingPongFBO, useFps
  components/          # ShaderLandscape, Overlay
  App.tsx              # glue
docs/superpowers/      # spec y plan de la zona de observación
```

## Créditos

Algoritmo del shader basado en el trabajo de Inigo Quilez
(<https://iquilezles.org>). Adaptación a GLSL ES 3.00 + ping-pong manual
de FBOs hecha para este proyecto.
```

---

## Task 11: Verificación

**Files:** ninguno (sólo correr comandos).

- [ ] **Step 11.1: Typecheck final**

```bash
pnpm typecheck
```

Expected: PASS sin errores.

- [ ] **Step 11.2: Build de producción**

```bash
pnpm build
```

Expected: vite genera `dist/` sin errores. Tamaño esperado: bundle JS < 200 KB gzip (R3F + three).

- [ ] **Step 11.3: Dev server y comprobación visual**

```bash
pnpm dev
```

Expected: server arranca en `http://localhost:5173`. Abrir en navegador.

**Checklist visual (manual):**
- El paisaje aparece tras un fade in de ~600 ms (sin flash negro permanente).
- El HUD muestra título arriba-izquierda, panel abajo-izquierda, botones abajo-derecha.
- El FPS cambia (no se queda clavado en 0).
- Pulsar `Space` → cambia "live" → "paused", el paisaje se congela, fps sube (no hay render).
- Pulsar `Space` otra vez → reanuda sin saltos perceptibles.
- Pulsar `R` → la imagen pierde brevemente el smoothing temporal y se reconstruye.
- Pulsar `H` → desaparece el HUD; otra vez `H` → reaparece.
- Redimensionar la ventana del navegador → la imagen se reescala sin romperse ni stretchearse.
- Consola (F12): sin errores de WebGL ni warnings de three.js relevantes.

Si algo falla, abrir la consola y revisar:
- `THREE.WebGLProgram: Shader Error` → el shader no compila. Mirar la línea reportada en `landscape.frag.ts`.
- `null` en `iChannel0` la primera vez → ignorable; el shader maneja `iFrame==0`.

---

## Task 12 (opcional): Inicializar git

**Files:** ninguno.

- [ ] **Step 12.1: git init + first commit**

```bash
git init
git add -A
git commit -m "feat: initial Fantasy World observation zone

- vite + react + ts scaffolding
- IQ landscape shader adapted to GLSL3 with feedback iChannel0
- ping-pong FBO render pipeline in r3f
- minimalistic glassmorphism HUD with pause/reset/hud-toggle"
```

Saltar si no quieres tracking aún.

---

## Notas para ejecución paralela con subagentes

Las siguientes tareas son **independientes** y se pueden lanzar en
paralelo (cada una crea archivos sin conflicto):

- Task 2 (`fullscreen.vert.ts`)
- Task 3 (`copy.frag.ts`)
- Task 4 (`usePingPongFBO.ts`)
- Task 5 (`useFps.ts`)
- Task 7 (`Overlay.module.css`)
- Task 10 (`README.md`)

Tasks **dependientes** (lanzar después de las anteriores):
- Task 6 (`ShaderLandscape.tsx`) depende de 2, 3, 4 y del shader ya escrito.
- Task 8 (`Overlay.tsx`) depende de 5 y 7.
- Task 9 (`App.tsx`) depende de 6 y 8.

Task 1 (install) es estrictamente la primera. Task 11 (verificación) es
estrictamente la última.

Plan de despacho recomendado:
1. Task 1 (secuencial)
2. Wave A en paralelo: Tasks 2, 3, 4, 5, 7, 10
3. Wave B en paralelo: Tasks 6, 8
4. Task 9 (necesita 6 y 8)
5. Task 11 (verificación)
6. Task 12 (opcional)
