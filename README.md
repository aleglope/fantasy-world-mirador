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
(`ro`/`ta` con un `sin(0.01·t)`).

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
