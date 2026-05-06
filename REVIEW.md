# Fantasy World — Code Review

**Fecha:** 2026-05-06
**Alcance:** entrega completa de la "Zona de Observación" (spec + plan ejecutados).
**Verificación previa:** `pnpm typecheck` PASS · `pnpm build` PASS.
**Veredicto general:** la entrega está **funcional** y cumple el grueso del spec. El render pipeline ping-pong es correcto, el shader GLSL3 está bien adaptado, y no hay bugs que rompan la app. Hay sin embargo **varios defectos reales** (un leak de geometría, dos huecos de cumplimiento del spec, y un coste de re-renders innecesario en el HUD) que conviene arreglar.

---

## Resumen por severidad

| Severidad | Cantidad |
|---|---|
| CRITICAL | 0 |
| HIGH     | 2 |
| MEDIUM   | 5 |
| LOW      | 3 |
| NIT      | 7 |

---

## HIGH

### H1 · `PlaneGeometry` nunca se hace `dispose()` — leak de GPU en cada unmount
**Archivo:** `src/components/ShaderLandscape.tsx:57, 106-111`

En el `useMemo` de escenas se crea `const geom = new THREE.PlaneGeometry(2, 2)`, pero el `useEffect` de cleanup sólo libera los materiales:

```ts
useEffect(() => {
  return () => {
    landscapeMat.dispose();
    copyMat.dispose();
    // ← falta: geom.dispose()
  };
}, [landscapeMat, copyMat]);
```

Como ambos meshes comparten la misma geometría, basta con guardarla y disponerla. En **React 18 StrictMode (dev)** esto se materializa de inmediato: el componente monta-desmonta-monta y dejas un buffer de vértices sin liberar en GPU. En producción es una fuga única en el unmount de la página, pero sigue siendo un fix trivial.

**Fix:**
```tsx
const { sceneA, sceneB, fsCamera, geom } = useMemo(() => {
  const geom = new THREE.PlaneGeometry(2, 2);
  // ... resto igual
  return { sceneA, sceneB, fsCamera, geom };
}, [landscapeMat, copyMat]);

useEffect(() => {
  return () => {
    landscapeMat.dispose();
    copyMat.dispose();
    geom.dispose();
  };
}, [landscapeMat, copyMat, geom]);
```

Mismo problema con `THREE.Scene` (no necesita dispose pero conviene `clear()` para soltar referencias) y con `THREE.Camera` (idem). Lo único crítico es la geometría.

---

### H2 · StrictMode dispone recursos que la siguiente "fase" del doble-mount sigue usando
**Archivos:** `src/components/ShaderLandscape.tsx:106-111` y `src/hooks/usePingPongFBO.ts:58-63`

Patrón en ambos archivos:
```ts
const fbo = useMemo(() => /* crea targets */, []);
useEffect(() => () => { fbo.a.dispose(); fbo.b.dispose(); }, [fbo]);
```

En **dev** con `<StrictMode>`, React hace mount → unmount → remount. Secuencia:
1. Mount #1: `useMemo` crea targets `a`/`b`.
2. Unmount #1: cleanup llama `a.dispose()` y `b.dispose()` — Three.js dispara `'dispose'` y libera los recursos GPU subyacentes.
3. Remount #2: `useMemo([])` **devuelve la misma referencia memoizada** (no recrea). El `useEffect` se re-suscribe sobre los **targets ya dispuestos**.

Three.js sobrevive porque re-asigna los recursos GPU perezosamente la primera vez que se renderiza al target, así que en la práctica "funciona" pero:
- pierdes el contenido de `iChannel0` justo en el doble-mount,
- tiras el shader compilado y lo recompilas (jank al arrancar dev),
- es exactamente el clase de bug que el spec §6 pretende evitar ("Sin leaks").

**Fix recomendado:** crear los recursos dentro de `useEffect` (no `useMemo`) y guardarlos en un `useRef`. Así cada mount tiene su propio par de targets / materiales y cada cleanup libera los suyos:

```ts
const fboRef = useRef<{ a: WebGLRenderTarget, b: WebGLRenderTarget } | null>(null);
useEffect(() => {
  const a = makeTarget(); const b = makeTarget();
  fboRef.current = { a, b /* + read/write */ };
  return () => { a.dispose(); b.dispose(); fboRef.current = null; };
}, []);
```

Misma estrategia para `landscapeMat`, `copyMat`, `geom`, `sceneA`, `sceneB`. Es más código pero es el patrón canónico para recursos GPU bajo StrictMode.

Severidad **HIGH** porque:
- el spec lo lista explícitamente como criterio (§6 "Strict Mode … sin leaks"),
- afecta a la fiabilidad del primer frame en dev,
- es la causa potencial de futuros "esto sólo falla en dev" reports.

---

## MEDIUM

### M1 · El contador `frame` del HUD provoca re-render del `<Overlay/>` en cada RAF
**Archivo:** `src/components/Overlay.tsx:32, 38-44`

```tsx
const tick = () => {
  setElapsed((performance.now() - startTime) / 1000);
  setFrame((f) => f + 1);
  raf = requestAnimationFrame(tick);
};
```

`setFrame` se llama cada animation frame → React reconcilia el árbol completo del Overlay 60 veces por segundo (≈10 spans, dos botones, cálculos de className). Esto contradice el comentario del propio `useFps` ("no causa re-render por frame"), que se diseñó para cambiar el state sólo cuando el FPS entero cambia. Aquí se tira ese diseño por la borda.

Además, **este `frame` no es el `iFrame` del shader**: es un contador de RAFs del thread de UI desde que se montó el Overlay. Si la GPU baja a 30 fps, el HUD sigue contando a 60. Si pones `dpr=1` y la GPU va sobrada, sigue contando a 60. Es decorativo, no informativo. Y el spec §4 lo definió como `frame · 1234` esperando que reflejara el frame del render.

**Fix:** elevar `frame`/`time` a un mecanismo `imperative` desde `ShaderLandscape` (un `ref` compartido o un event emitter) y muestrearlo en el HUD a 4–10 Hz, no a 60. O bien, si te conformas con el contador de RAFs, throttlearlo a integer-cambia (como hace `useFps`):

```tsx
const tick = () => {
  const next = (performance.now() - startTime) / 1000;
  if (Math.floor(next) !== Math.floor(elapsedRef.current)) {
    elapsedRef.current = next;
    setElapsed(next);
  }
  raf = requestAnimationFrame(tick);
};
```

Y en el caso de `frame`, eliminarlo o leerlo del shader real (mejor opción: registrar el `iFrame` en un ref expuesto desde `ShaderLandscape` y muestrearlo a 4 Hz).

---

### M2 · El "time" del HUD no refleja el `iTime` real al pausar
**Archivo:** `src/components/Overlay.tsx:38, src/components/ShaderLandscape.tsx:115-117`

El spec §5 dice claramente: *"`iTime` se mantiene en el componente, no se lee de `clock.elapsedTime`, para que la pausa congele de verdad el tiempo del shader sin saltos al reanudar."*

`ShaderLandscape` cumple eso (`s.time += delta` sólo si `!paused`). Pero el HUD calcula `elapsed = (performance.now() - startTime) / 1000`, que es **wall-clock**. Si pausas 10 s y reanudas, el HUD pega un salto de 10 s, mientras que el `iTime` del shader continúa sin saltos. Inconsistencia visible: la imagen no avanza pero el "time" sí.

El parche actual en pausa es que el `useEffect` con `if (paused) return` impide actualizar `elapsed` mientras está pausado, pero al reanudar recalcula desde `startTime` original → salta. El verdadero arreglo es sumar deltas como hace el shader:

```tsx
useEffect(() => {
  if (paused) return;
  let raf = 0; let last = performance.now();
  const tick = () => {
    const now = performance.now();
    setElapsed(e => e + (now - last) / 1000);
    last = now;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}, [paused]);
```

(Ya no necesitas `startTime` como prop si haces esto.)

---

### M3 · No hay fallback a `NearestFilter` si el GPU no soporta linear sobre float
**Archivo:** `src/hooks/usePingPongFBO.ts:38-47`, spec §6

El spec lo lista explícitamente: *"Filtro lineal en float texture no soportado → fallback a `NearestFilter`. Aceptamos pérdida menor en la reproyección, evitamos crash en GPUs viejas."*

En WebGL2, `OES_texture_half_float_linear` está casi siempre disponible, pero **no garantizado** (especialmente Mac antiguos, Linux con drivers libres). El código asume soporte. Si una GPU no lo soporta, three.js loggeará un warning y el sampling devolverá ceros / valores no filtrados — fallo silencioso de calidad, no crash, pero el contrato del spec no se cumple.

**Fix:**
```ts
import { useThree } from '@react-three/fiber';

const gl = useThree(s => s.gl);
const ext = gl.extensions.get('OES_texture_float_linear')
        || gl.extensions.get('OES_texture_half_float_linear');
const filter = ext ? THREE.LinearFilter : THREE.NearestFilter;
// pasar filter al hook
```

(WebGL2 tiene la API a través de `gl.getExtension(...)` igual que WebGL1; el chequeo con `gl.capabilities` no cubre este caso porque depende de la implementación.)

---

### M4 · No hay manejo de error de compilación de shader (spec §6)
**Archivo:** `src/components/ShaderLandscape.tsx`, `src/App.tsx`

Spec §6: *"Compilación shader falla → onError captura, log a consola y panel rojo discreto con la primera línea de error. No rompe la app."*

No existe ningún `try/catch`, `ErrorBoundary` o suscripción a eventos del renderer. Si alguien rompe el shader (cosa probable en un proyecto de visualización donde se itera el GLSL), el resultado es: log oscuro en la consola de Three.js + canvas en negro sin indicación al usuario. Con `<StrictMode>` además se loggea dos veces.

**Fix mínimo:** envolver `<Canvas>` en un React `ErrorBoundary` (R3F suele propagar el shader-error como excepción) y mostrar un overlay rojo con `error.message.split('\n')[0]`. Three.js también acepta un onError en `gl.debug.checkShaderErrors`, pero el patrón estándar en R3F es el ErrorBoundary.

---

### M5 · `useRef` declarado y nunca leído en `usePingPongFBO`
**Archivo:** `src/hooks/usePingPongFBO.ts:29-34, 51`

```ts
const ref = useRef<{ a: ..., b: ..., read: ..., write: ... } | null>(null);
// ...
ref.current = obj;  // se escribe
return obj;          // ← se devuelve el obj, no el ref
```

`ref` se asigna pero nunca se lee fuera del `useMemo`. Es código muerto que confunde. Probablemente quedó de un refactor a medias. Es además **el patrón correcto para arreglar H2**: si en lugar de `useMemo` se moviera la creación a un `useEffect` que escribe en `ref.current` y lo destruye en cleanup, se solucionaría StrictMode. Como está ahora, no aporta nada y debería borrarse o convertirse en la solución real.

---

## LOW

### L1 · `aria-hidden={!visible}` no considera `ready`
**Archivo:** `src/components/Overlay.tsx:56`

```tsx
const cls = [styles.root, ready && visible ? styles.visible : styles.hidden]...
return <div className={cls} aria-hidden={!visible}>...
```

Mientras el shader compila (`ready=false`, `visible=true`), el HUD está visualmente oculto via `.hidden` (opacity 0) pero `aria-hidden` es `false`. Lectores de pantalla anuncian el contenido vacío. Trivial:

```tsx
aria-hidden={!ready || !visible}
```

### L2 · `gl.clear(true, true, true)` limpia depth/stencil que no existen
**Archivo:** `src/components/ShaderLandscape.tsx:98, 100`

Los FBO tienen `depthBuffer: false, stencilBuffer: false`. `gl.clear(color, depth, stencil)` con depth=true/stencil=true sobre targets sin esos buffers es no-op pero ruidoso. Cambiar a `gl.clear(true, false, false)`.

### L3 · El bundle es 273 KB gzip, no <200 KB como decía el plan
**Archivo:** `package.json`, `dist/`

El plan §11.2 esperaba "<200 KB gzip"; el real es 273 KB. Vite tira un warning de ">500 KB sin gzip". No es un bug pero el plan tenía una expectativa optimista. Si quieres bajarlo, el camino estándar es `manualChunks` separando three/r3f. No urgente.

---

## NIT

### N1 · `THREE.Camera` base en lugar de `OrthographicCamera`
**Archivo:** `src/components/ShaderLandscape.tsx:66`

`new THREE.Camera()` es la clase base. El código funciona porque el vertex shader bypasea matrices, pero `new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)` sería más explícito sobre la intención.

### N2 · `frustumCulled = false` es innecesario porque el quad está en NDC
**Archivo:** `src/components/ShaderLandscape.tsx:60, 64`

Con vertex shader que escribe directamente `gl_Position`, three.js no puede calcular la AABB. El `frustumCulled = false` es defensivo y correcto, sólo un comentario del por qué ayudaría.

### N3 · `useMemo([])` para crear materiales no garantiza identidad permanente
**Archivo:** `src/components/ShaderLandscape.tsx:26-54`

React docs: *"useMemo is purely a performance optimization, not a semantic guarantee."* En la práctica React 18 actual respeta la memoización con deps vacías, pero el patrón canónico para recursos imperativos es `useRef + useEffect`. Esto está relacionado con H2.

### N4 · El check de teclas ignora `<textarea>`, `<select>`, `contenteditable`
**Archivo:** `src/App.tsx:69`

```ts
if (e.target instanceof HTMLInputElement) return;
```

No hay inputs en el proyecto, así que es académico. Si se añade un input en el futuro, ampliar el check.

### N5 · Reset effect no resetea `notifiedFirst`
**Archivo:** `src/components/ShaderLandscape.tsx:88-104`

`notifiedFirst` se queda `true` tras un reset, así que `onFirstFrame` no vuelve a dispararse. Probablemente intencional (no quieres que el HUD haga fade-in cada vez que pulsas R), pero conviene comentarlo o nombrarlo `notifiedFirstEver`.

### N6 · `ref` nunca leído en `usePingPongFBO` (ya cubierto en M5, listado aquí también como dead code)
Ver M5.

### N7 · Comentarios en español + identificadores en inglés
Estilo coherente con el proyecto, pero mezcla. NIT puro, ignora si te gusta.

---

## Lo que está bien (no esperabas no encontrar nada)

- **Pipeline ping-pong correcto.** Tras `swap()`, `read` apunta al frame recién renderizado; el siguiente frame lo usa como `iChannel0`, lo que es exactamente lo que quiere el shader. El render durante pausa muestra `read.texture` (último frame) — correcto.
- **`iTime` y `iFrame` controlados por el componente, no por el clock de R3F.** Pausa congela de verdad. Spec §5 cumplido.
- **`priority=1` en `useFrame` cede el control de render**: R3F no auto-renderiza y los dos pases salen en orden (FBO → canvas). Correcto.
- **Reset limpia ambos FBO a (0,0,0,0)** preservando el clearColor previo del renderer. Bien.
- **GLSL3 wrapper bien hecho.** `out vec4 outColor`, `in vec2 vUv`, `texture(...)`/`texelFetch(...)`/`textureLod(...)` correctos. `mat3x4` constructor válido.
- **Tipado estricto en TS.** Cero `any`, cero `as`, cero `console.log`/`TODO`/`FIXME`. `tsc -b` pasa sin warnings.
- **DPR cap = 1.5** + resize debounced 100 ms + reset de `iFrame` al cambiar tamaño. Bien.
- **Detección de WebGL2 con fallback HTML.** Spec §6 cumplido en ese punto.
- **`useFps` con media móvil exponencial y `setState` sólo cuando cambia el entero.** Diseño limpio (lástima que el resto del Overlay lo arruina con `setFrame` por RAF — ver M1).

---

## Acciones recomendadas (orden de prioridad)

1. **H1** — añadir `geom.dispose()` en cleanup. (5 min)
2. **M1** — eliminar/throttlear `setFrame` en Overlay; el HUD se re-renderiza 60×/s para nada. (15 min)
3. **M2** — calcular `elapsed` por delta acumulado, no wall-clock. (10 min)
4. **M5** — borrar el `useRef` muerto en `usePingPongFBO`, o convertirlo en la solución de H2. (5 min o 30 min según ruta)
5. **H2** — refactor de creación de recursos a `useEffect` para StrictMode. (1–2 h, sólo si te molesta el reload jank en dev)
6. **M3, M4** — implementar fallback de filter y ErrorBoundary del shader. (30 min cada uno; opcionales para un proyecto personal pero el spec los lista)
7. **L1, L2, NIT** — limpieza cosmética cuando pases por el código.

Para un **proyecto personal de visualización**, con que arregles **H1 + M1 + M2** ya queda en muy buen estado. **H2** es importante sólo si el flicker de StrictMode al recargar te molesta. **M3/M4** son cumplimiento literal del spec, no afectan a la experiencia mientras compile el shader.

---

_Reviewer: Claude (gsd-code-reviewer) · Depth: deep · 2026-05-06_
