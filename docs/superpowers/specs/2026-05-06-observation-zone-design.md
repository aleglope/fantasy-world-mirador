# Fantasy World — Zona de Observación · Diseño

**Fecha:** 2026-05-06
**Estado:** aprobado por usuario, listo para plan de implementación
**Stack:** Vite + React 18 + TypeScript + React Three Fiber + Three.js (WebGL2)

---

## 1. Objetivo

Montar el shader de paisaje fantástico (estilo Inigo Quilez "Selva", ya
adaptado a GLSL ES 3.00 con feedback temporal vía `iChannel0`) dentro de un
proyecto React Three Fiber, presentándolo como una **zona cinemática
fullscreen** donde el usuario simplemente observa el vuelo automático sobre el
valle.

Modo elegido: **A · Cinemático fullscreen, pura observación**. Sin control de
cámara, sin sliders. La cámara y la animación están baked dentro del shader
(`ro`/`ta` en `mainImage`).

## 2. Arquitectura

```
React <Canvas frameloop="always">
└─ <ShaderLandscape/>           // toma control del render con priority=1
   ├─ Scene A: fullscreen quad + landscape ShaderMaterial (GLSL3)
   ├─ Scene B: fullscreen quad + copy ShaderMaterial (display)
   ├─ FBO read  ↔  FBO write    // ping-pong (HalfFloatType, NearestFilter)
   └─ useFrame(priority=1):
        1. iChannel0 ← readFBO.texture
        2. render(SceneA → writeFBO)   // shader principal
        3. render(SceneB → null)       // copia writeFBO al canvas
        4. swap(read, write); iFrame++
└─ <Overlay/>                    // HTML fuera del Canvas
```

**Justificación del doble pase:** el shader necesita su propia salida del
frame N como input del frame N+1 (reproyección temporal y cámara almacenada
en los píxeles `(0,0)`, `(1,0)`, `(2,0)` de la fila inferior). Renderizamos a
FBO y luego copiamos al canvas con un shader trivial.

## 3. Estructura de archivos

```
src/
  main.tsx                   entrypoint React
  App.tsx                    <Canvas/> + <Overlay/>
  index.css                  reset global
  components/
    ShaderLandscape.tsx      lógica de ping-pong + uniforms (~120 LOC)
    Overlay.tsx              HUD: título, FPS, pausa, info
    Overlay.module.css       estilos del HUD (glassmorphism sutil)
  shaders/
    landscape.frag.ts        shader IQ adaptado (ya escrito)
    fullscreen.vert.ts       passthrough NDC para ambos quads
    copy.frag.ts             sampler2D → outColor
  hooks/
    usePingPongFBO.ts        { read, write, swap, resize }
    useFps.ts                media móvil para el HUD
```

Cada unidad tiene una responsabilidad y comunica por props o uniforms
explícitos. `ShaderLandscape` no conoce el HUD; el HUD no conoce el FBO.

## 4. UI / HUD

Minimalista, en las esquinas, sin tapar el paisaje.

- **Esquina superior izquierda** — título tipográfico:
  - `FANTASY WORLD` (peso 300, tracking amplio)
  - `· mirador del valle ·` (subtítulo tenue)
- **Esquina inferior izquierda** — panel "vidrio" plegable:
  - `paused / live` con punto de estado coloreado
  - `fps · 58`
  - `frame · 1234`
  - `time · 0:42`
- **Esquina inferior derecha** — controles circulares:
  - `▶ / ⏸` pausa
  - `↺` reset
- **Atajos de teclado**:
  - `Space` → pausa/reanuda
  - `R` → reset
  - `H` → ocultar/mostrar HUD
- **Aparición** — fade-in 600 ms en el primer frame válido del shader, para
  evitar el flash negro mientras compila.

**Paleta** tomada del shader: verdes oliva profundos para fondos, azul cielo
`#7cb1ff` para acentos. `backdrop-filter: blur(12px)`, borde `1px
rgba(255,255,255,0.06)`.

## 5. Flujo de datos

### Uniforms del landscape shader

| nombre | tipo | origen |
|---|---|---|
| `iResolution` | `vec3` | tamaño real del FBO en píxeles |
| `iTime` | `float` | acumulado interno (controlado por pausa) |
| `iFrame` | `int` | contador interno |
| `iChannel0` | `sampler2D` | `readFBO.texture` (frame anterior) |

`iTime` se mantiene en el componente, no se lee de `clock.elapsedTime`, para
que la pausa congele de verdad el tiempo del shader sin saltos al reanudar.

### Configuración del FBO

- `format: RGBAFormat`
- `type: HalfFloatType` (suficiente rango/precisión para la matriz de cámara
  y los colores HDR intermedios)
- `minFilter: LinearFilter`, `magFilter: LinearFilter`
- `wrapS/T: ClampToEdgeWrapping`
- `depthBuffer: false`, `stencilBuffer: false`

### Resolución

- DPR efectivo = `min(window.devicePixelRatio, MAX_DPR=1.5)`. El shader es
  muy pesado; sin cap, retina pura cae bajo 30 fps en GPUs medias.
- En resize → `setSize` de ambos FBOs y `iFrame = 0` para invalidar la
  reproyección (texeles podridos por cambio de resolución).
- Resize debounced a 100 ms para no recrear FBOs durante un drag continuo.

### Pausa

- `paused=true`: no acumula `iTime`, no incrementa `iFrame`, no renderiza la
  Scene A. Sólo renderiza la Scene B con la última textura. Resultado: imagen
  congelada, coste GPU prácticamente cero.

### Reset

- `iFrame = 0`. Ambos FBOs limpiados a `vec4(0)`. El propio shader detecta
  `iFrame == 0` y descarta el contenido podrido del `iChannel0`.

## 6. Manejo de errores

- **WebGL2 no disponible** → overlay HTML con mensaje claro y enlace a
  `caniuse`. R3F intenta WebGL2 por defecto; si `gl.getContext('webgl2')`
  devuelve `null`, mostramos el fallback.
- **Compilación shader falla** → `onError` captura, log a consola y panel
  rojo discreto con la primera línea de error. No rompe la app.
- **Filtro lineal en float texture no soportado** → fallback a `NearestFilter`.
  Aceptamos pérdida menor en la reproyección, evitamos crash en GPUs viejas.
- **Tab en background** → R3F detiene `useFrame` automáticamente. Al volver,
  la reproyección queda desfasada ~10 frames, luego se estabiliza. Aceptable.
- **Strict Mode** (doble mount en dev) → recursos creados en `useEffect`
  con `dispose()` en cleanup. Sin leaks.

## 7. Testing

Sin suite automática en esta entrega: es una experiencia visual donde la
verificación útil es ocular. Lo que sí dejamos:

- `npm run typecheck` — tsc estricto pasa.
- `npm run build` — vite build genera bundle sin errores.
- **Verificación manual** (checklist):
  - levantar `npm run dev`, abrir en navegador
  - comprobar que renderiza el paisaje (no flash negro permanente)
  - `Space` pausa y reanuda sin saltos
  - `R` resetea sin artefactos
  - resize de ventana no rompe ni produce stretching
  - sin errores ni warnings de WebGL en la consola
  - cap a `MAX_DPR=1.5` mantiene fps > 45 en una GPU integrada moderna

## 8. Fuera de alcance (explícito)

- Control manual de cámara (WASD/mouse). Modo B descartado en brainstorming.
- Sliders para hora del día / niebla / velocidad. Modo C descartado.
- Tests automáticos.
- VR / pantalla completa nativa.
- Descarga de screenshot.
- Despliegue (queda como ejercicio posterior, posible vía Vercel).

## 9. Versiones de dependencias

| paquete | versión |
|---|---|
| react / react-dom | ^18.3.1 |
| three | ^0.170.0 |
| @react-three/fiber | ^8.17.10 |
| @react-three/drei | ^9.117.3 |
| vite | ^5.4.11 |
| typescript | ^5.6.3 |

## 10. Próximos pasos

1. Plan de implementación detallado (skill `writing-plans`).
2. Ejecución del plan, posiblemente paralelizando archivos independientes
   con subagentes (FBO hook + Overlay + shaders auxiliares pueden ir en
   paralelo).
3. Verificación manual contra el checklist del §7.
