# Fantasy World — Cubo "Monolito del Valle" · Diseño

**Fecha:** 2026-05-06
**Estado:** aprobado por usuario, listo para plan de implementación
**Stack:** Vite + React 18 + TypeScript + R3F + Three.js (WebGL2)
**Shader fuente:** Shadertoy `NslGRN` de Danil (CC BY-NC-SA 3.0) — raymarched cube con bilinear patches, soft shadow y 3 capas internas con self-intersection translúcida.

---

## 1. Objetivo

Integrar el cubo procedural de Shadertoy `NslGRN` en el centro del valle existente, con:

- Cámara orbitando el cubo a velocidad contemplativa, prácticamente horizontal (mismo plano de mirada que el paisaje).
- Sombra del cubo proyectada sobre el paisaje (no flotando como pegote).
- Cubo monumental, prominente, foco visual de la escena pero sin tapar la cordillera.
- `iTime` compartido con el paisaje → pause/reset/resize del HUD existente funcionan sobre cubo y paisaje sincronizados.

**Lectura conceptual:** el cubo se lee como un objeto ritual plantado en el desfiladero del valle — la "distancia de 40 metros" del usuario se materializa como elevación de cámara y velocidad de orbit, no como tamaño literal en pantalla (un cubo realmente a 40m sería casi imperceptible contra una cordillera enorme y se perdería el shader).

---

## 2. Preset visual — "Monolito del valle"

Defines fijos en `cube.frag.ts`:

| Define | Valor | Por qué |
|---|---|---|
| `CAMERA_POS` | `0.06` | Cámara casi horizontal, mismo plano que la cámara del paisaje. Top-down rompería la coherencia. |
| `CAMERA_FAR` | `3.5` | Eye distance ≈ 5.5 unidades del shader; el cubo ocupa ~35% de la altura. Prominente sin tapar la cordillera. |
| `ROTATION_SPEED` | `0.22` | Orbit lento (~vuelta cada 25-30s). Casa con el ritmo lento del paisaje (nubes flotando, cámara estática). |
| `SHADOW_ALPHA` | ON | El shader hace internamente `cube*α + iChannel0*(1-α)`. La sombra se mezcla sobre el paisaje sin código de composite extra. |
| `ANIM_SHAPE` | ON | Curvatura cubo↔esfera con ciclo lento. Punto de interés sutil sobre un paisaje muy estático. |
| `ANIM_COLOR` | OFF | Mantener identidad cromática estable; animar color sobre paisaje frío sería ruido visual. |
| `USE_COLOR` | OFF (defaults) | Default azul + rojo cálido del shader → contraste térmico contra el valle frío, el cubo es el foco. Forzarlo a azul lo camuflaría con el paisaje. |
| `MOUSE_control` | OFF (sin definir) | Orbit puramente automático; sin interacción de ratón. |
| `tshift` | `53.` (default) | Sin cambio. |

Estos valores son la "personalidad" del cubo en *este* paisaje. Si en el futuro se reusa el cubo en otra escena, son el primer punto a re-tunear.

**Posición vertical en pantalla:** el shader proyecta el cubo en el centro vertical del frame (~50% desde arriba) por la geometría interna de su cámara raymarched. La línea de horizonte del paisaje (`fantasy-world-v5.png`) está al ~40-45% desde arriba, así que el cubo quedará ligeramente por debajo de la cordillera y por encima del primer plano de nubes — encajado en la zona del valle, que es lo deseado. Si en la verificación visual se ve "flotando" alto, se sube `CAMERA_POS` (más picado) o se restringe el rango de mouseY interno; iteración corta, no bloqueante.

---

## 3. Arquitectura del pipeline

**Pipeline actual (3 pases):**

```
landscape.frag (feedback ping-pong)  ──► mainHi
clouds.frag (cada 2 frames, 0.5×)    ──► cloudsLo
compose.frag (uMain + uClouds)       ──► canvas
```

**Pipeline propuesto (4 pases):**

```
landscape.frag (feedback ping-pong)  ──► mainHi
clouds.frag (cada 2 frames, 0.5×)    ──► cloudsLo
compose.frag (uMain + uClouds)       ──► composeOut   [FBO nuevo, antes iba a canvas]
cube.frag (iChannel0 = composeOut)   ──► canvas       [pase nuevo]
```

**Decisiones clave:**

- **El cubo va al final, leyendo el paisaje compuesto vía `iChannel0`.** El shader, en modo `SHADOW_ALPHA`, hace internamente el composite final: `fragColor.rgb = fragColor.rgb*α + texture(iChannel0, uv).rgb * (1-α)`. La sombra se mezcla con el paisaje sin tocar `compose.frag`.

- **`compose.frag` cambia destino, no contenido.** Antes escribía a canvas; ahora escribe a `composeOut`. Cero líneas de GLSL modificadas.

- **No fusiono el cubo dentro de `compose.frag`.** Sería técnicamente posible (compose con uCube + alpha) pero acoplaría el raymarcher al composer y perdería separación de responsabilidades. Cada shader hace una cosa.

- **El cubo NO tiene FBO propio** — escribe directo a canvas. Ahorra un pase. Si la perf se queda corta, mover a FBO 0.85× + upscale (ver §8).

**Diagrama de dependencias por frame:**

```
mainHi.read ──► landscape.frag ──► mainHi.write
                                       │
cloudsLo ─────► clouds.frag ──┐        │
                              │        │
                              ▼        ▼
                            compose.frag ──► composeOut
                                                  │
                                                  ▼
                                              cube.frag ──► canvas
```

---

## 4. Archivos y componentes

### Archivos nuevos (1)

| Archivo | Propósito |
|---|---|
| `src/shaders/cube.frag.ts` | El shader Shadertoy `NslGRN` envuelto como módulo TS (string GLSL3). Defines preset (§2), uniforms (`iResolution`, `iTime`, `iChannel0`), y `mainImage(...)` invocado desde `void main()` con `gl_FragCoord.xy`. Sigue patrón existente de `landscape.frag.ts`. |

### Archivos modificados (1)

| Archivo | Cambios |
|---|---|
| `src/components/ShaderLandscape.tsx` | Añade material `cubeMat`, escena `sceneCube`, FBO `composeOut`, y un 4º pase en `useFrame`. Modifica destino del pase compose (de canvas a `composeOut`). Resize y reset incluyen `composeOut`. Estimación: +80-100 líneas; pasa de ~250 a ~330-350. |

### Archivos sin cambios

- `App.tsx`, `Overlay.tsx` — el HUD existente (Space/R/H) sigue funcionando idéntico. El cubo respeta `paused`/`resetSignal` automáticamente porque comparte `stateRef.current.time`.
- `compose.frag.ts`, `landscape.frag.ts`, `clouds.frag.ts`, `fullscreen.vert.ts` — el GLSL no se toca.
- `usePingPongFBO.ts`, `useFps.ts` — sin cambios.

### Decisión: no extraigo el cubo a sub-componente

Lo planteé y descarté:

1. La orquestación del pipeline tiene **estado compartido**: `time`/`frame`, `paused`/`resetSignal`, FBOs encadenados (un pase lee lo que otro escribe). Separar a `<CubePass>` forzaría prop drilling de 4-5 referencias o un Context, sin ganancia real.
2. El componente ya tiene un propósito coherente — orquestar el pipeline. Añadir un 4º pase no cambia esa identidad.
3. YAGNI: si más adelante aparece un 5º shader o un sistema de pases dinámicos, ahí sí se extrae a un hook `useShaderPipeline`. Hoy no.

**Punto de atención sobre tamaño:** ~350 líneas es el techo de lo cómodo. Si el siguiente cambio empuja por encima de ~400, se refactoriza en ese momento (extraer creación de materiales o FBOs a helpers).

---

## 5. Estructura del nuevo `cube.frag.ts`

```glsl
precision highp float;

// Preset "Monolito del valle"
#define SHADOW_ALPHA
#define ANIM_SHAPE
#define CAMERA_POS 0.06
#define CAMERA_FAR 3.5
#define ROTATION_SPEED 0.22
// (sin MOUSE_control, sin USE_COLOR, sin ANIM_COLOR)

uniform vec3      iResolution;
uniform float     iTime;
uniform sampler2D iChannel0;   // paisaje compuesto (composeOut)
out vec4 fragColor;

// <bloque GLSL del shader Shadertoy NslGRN, intacto>
// — incluye fcos1/fcos2/fcos, getColor, calcColor, iBilinearPatch,
//   segShadow, boxSoftShadow, box, bgcol, background, insides, mainImage.
// La cabecera mainImage se mantiene; añadimos un main() wrapper.

void main() {
  mainImage(fragColor, gl_FragCoord.xy);
}
```

**Notas sobre uniforms:**

- El shader **no usa `iFrame`** con nuestros defines (la única referencia es `min(iFrame,0)` en una optimización ANGLE comentada que evaluamos como `0`). No lo expongo.
- El shader **no usa `iMouse`** sin `MOUSE_control`. No lo expongo.
- `iResolution` debe corresponder al tamaño del canvas en **device pixels** (`size.width * dpr`, `size.height * dpr`), no en CSS pixels. El shader divide `fragCoord` (que es `gl_FragCoord` ya en device pixels al renderizar a canvas) entre `iResolution.xy` para sus UVs internas — si pasamos CSS pixels las UVs salen escaladas y el sample a `iChannel0` se descoloca.

**Atribución:** mantener el comentario de cabecera del autor original (`// Created by Danil (2021+)` y la línea de licencia CC BY-NC-SA 3.0) en el archivo.

---

## 6. Render loop, estado y reset

### Orden del `useFrame` (no-pausado)

```
1. landscape pass:   iChannel0   = mainHi.read.texture
                     iTime       = stateRef.time
                     iFrame      = stateRef.frame
                     destino     = mainHi.write
2. clouds pass:      sólo si frame === 0 || frame % 2 === 0
                     iTime       = stateRef.time
                     destino     = cloudsLo
3. compose pass:     uMain       = mainHi.write.texture
                     uClouds     = cloudsLo.texture
                     destino     = composeOut          [cambio: antes era canvas]
4. cube pass:        iChannel0   = composeOut.texture
                     iTime       = stateRef.time
                     iResolution = canvas size
                     destino     = canvas              [nuevo]
5. mainHi.swap()
6. frame += 1
```

### Pausa

Misma lógica que hoy: cuando `paused === true`, no se avanza `time`/`frame` y se recompone con la última textura disponible. La rama de pausa del `useFrame` se extiende para incluir el cubo:

```
if (paused) {
  // re-compose desde mainHi.read + cloudsLo → composeOut
  // re-render cube con composeOut → canvas
  // (sin avanzar time, sin swap)
}
```

Resultado: pausar congela cubo + paisaje sincronizados; reanudar continúa fluido.

### Reset

El handler `useEffect([resetSignal])` ya limpia `mainHi.read`, `mainHi.write` y `cloudsLo`. Se añade el clear de `composeOut`:

```
gl.setRenderTarget(mainHi.read);    gl.clear(...)   // [ya existe]
gl.setRenderTarget(mainHi.write);   gl.clear(...)   // [ya existe]
gl.setRenderTarget(cloudsLo);       gl.clear(...)   // [ya existe]
gl.setRenderTarget(composeOut);     gl.clear(...)   // [nuevo]
```

El cubo es stateless (no tiene feedback temporal) y no requiere clear propio: su frame se recalcula entero desde `iTime`.

### Sincronización paisaje ↔ cubo

El `iTime` del cubo es el **mismo float** que el del paisaje (`stateRef.current.time`). Esto es deliberado:

- Pause/reset funcionan a la primera para ambos sin código extra.
- Animación del cubo (`ANIM_SHAPE`, orbit) y del paisaje (nubes, feedback) avanzan en el mismo "reloj de mundo".
- Si el día de mañana se quiere desincronizar (cubo orbita aunque paisaje pause), se crea un `cubeTime` separado. No se hace hoy.

---

## 7. Resize y cleanup

### Resize

Mismo `setTimeout(100ms)` debounce existente. Se añade:

- `composeOut.setSize(canvasW, canvasH)` (a tamaño completo de canvas, sin scale factor — preserva fidelidad post-compose como hoy)
- `cubeMat.uniforms.iResolution.value.set(canvasW, canvasH, 1)`

El cubo samplea `composeOut` con UV normalizadas, así que cualquier diferencia entre la resolución de `mainHi` (0.85×) y `composeOut` (1.0×) la absorbe el sampler lineal. Sin parpadeo.

### Cleanup

En el `useEffect` de unmount se añade:

```
cubeMat.dispose();
composeOut.dispose();
```

Junto a los `dispose` existentes. Patrón idéntico.

---

## 8. Rendimiento — knobs disponibles

### Coste estimado

| Pase | Coste relativo | Notas |
|---|---|---|
| landscape | sin cambio | feedback ping-pong, 0.85× DPR |
| clouds | sin cambio | 0.5× DPR, alterna frames |
| compose | +overhead despreciable (<0.3ms) | escribe a FBO en lugar de canvas |
| **cube (nuevo)** | **dominante** | raymarched + soft shadow + 3 capas con self-intersection, full canvas DPR |

A 1080p × 1.5 DPR ≈ 4.7M fragmentos/frame para el cubo. Estimación:
- GPU integrada (Apple Silicon, Iris): 3-6 ms
- Discreta moderna: <2 ms

### Estrategia

Arrancar **sin optimizaciones**, medir con el HUD de FPS, ajustar sólo si hace falta. Si el FPS objetivo (≥60fps en máquina del usuario) no se alcanza, aplicar en este orden (de menor a mayor cambio):

1. Bajar `MAX_DPR` de 1.5 → 1.25 en `ShaderLandscape.tsx` (1 línea).
2. Renderizar el cubo a un FBO a 0.85× DPR + un pase de upscale lineal a canvas (añade 1 pase, recupera ~30% del coste del cubo).
3. Saltar el cubo en frames alternos como ya hace `clouds` (el cubo no tiene feedback temporal — seguro).
4. Quitar `ANIM_SHAPE` y volver a `STATIC_SHAPE 0.5` (la curvatura no-const ralentiza compilación en ANGLE y ejecución leve).

Cada knob es un cambio de 1-3 líneas. Postergables.

---

## 9. Testing y verificación

Este proyecto no tiene test suite automatizada (sólo `pnpm typecheck` y `pnpm build`). Verificación **manual visual + checklist**.

**Checklist antes del merge:**

- [ ] `pnpm typecheck` pasa sin errores nuevos
- [ ] `pnpm build` produce bundle sin warnings nuevos de GLSL
- [ ] `pnpm dev` levanta y la primera carga no muestra error de compilación de shader en consola
- [ ] El paisaje (sin el cubo, comentando temporalmente el pase 4) sigue idéntico al baseline `fantasy-world-v5.png`
- [ ] El cubo aparece centrado, orbita despacio y proyecta sombra visible sobre el valle
- [ ] Tecla **Space**: congela cubo Y paisaje sincronizados (no uno sin el otro)
- [ ] Tecla **R**: resetea tiempo, el cubo arranca su orbit desde 0
- [ ] Tecla **H**: oculta HUD, no afecta render
- [ ] Resize de ventana: tras 100ms el render se ajusta sin crash y sin texturas estiradas
- [ ] FPS objetivo: ≥60fps a 1080p en máquina del usuario (HUD muestra FPS en tiempo real)
- [ ] Captura de pantalla `fantasy-world-v6.png` para baseline futuro

**No se añaden tests automatizados** — pintar pixels en headless WebGL es coste alto para un proyecto de esta naturaleza.

---

## 10. Riesgos identificados

1. **Compilación inicial del shader (~200-500ms).** `cube.frag` es grande (~500 líneas con branching). Three.js compila asíncrono en WebGL2 con `KHR_parallel_shader_compile`. Esperado: 1-3 frames negros del cubo en la primera carga. El callback `onFirstFrame` actual se dispara con el paisaje; el cubo aparece un instante después. Aceptable.

2. **Coherencia de luz cubo↔paisaje.** La dirección de la luz interna del cubo es fija (`l_dir = normalize(vec3(0,1,0)) * rotz(0.5)`). Puede que la sombra no caiga del lado "correcto" respecto a la luz aparente del paisaje. Si chirría visualmente, se ajusta `l_dir` en una iteración corta. **No bloqueante** para el primer build.

3. **Color space.** El Canvas está en modo `flat` (sin tone mapping). El composite del shader (`cube*α + bg*(1-α)`) es alpha lineal estándar — sin mismatch. Riesgo bajo. Si en el futuro se activa `gl.toneMapping`, hay que revisar.

4. **macOS-only confiable.** El shader fuente tiene workarounds documentados para ANGLE/D3D (Windows) y Nvidia (`#define BUG`). En macOS Metal/WebGL2 va limpio. Si más adelante se despliega en Windows, hay riesgo de bug visual conocido en una de las 3 capas internas del cubo.

5. **Drivers móviles / GPUs viejas.** El raymarcher con 3 capas y self-intersection puede sobrecargar móviles antiguos. El proyecto ya filtra por WebGL2 en `App.tsx` (descarta lo más frágil). Sin garantía en móviles low-end pero tampoco era el target.

6. **Atribución de licencia.** El shader está bajo CC BY-NC-SA 3.0. Implica:
   - Mantener atribución del autor en el archivo.
   - Si el proyecto se distribuye, debe mantenerse la misma licencia para esa parte.
   - Uso no comercial.
   Si el proyecto evoluciona a algo comercial, se requiere relicenciar o reescribir el shader desde cero.

---

## 11. Fuera de alcance

Cosas que **no** se hacen en esta iteración (registradas para iteraciones futuras):

- HUD de control para el cubo (sliders de orbit speed, distancia, color). El usuario no lo pidió. YAGNI.
- Interacción con el ratón (deshabilitada con `MOUSE_control` OFF). Si se quiere agregar luego, basta con definir `MOUSE_control` y exponer un uniform `iMouse`.
- FBO propio para el cubo + upscale (knob #2 de §8). Se aplica sólo si la perf real lo requiere.
- Múltiples cubos / variantes / animación cinematográfica entre presets.
- Tests automatizados de regresión visual.
- Soporte garantizado en Windows ANGLE o móviles low-end.

---

## 12. Resumen ejecutivo

| Sección | Decisión |
|---|---|
| Pipeline | 4 pases — landscape → clouds → compose (a FBO `composeOut`) → cube (a canvas, sombra alpha sobre paisaje) |
| Archivos | +`cube.frag.ts` (nuevo), modifica `ShaderLandscape.tsx` (+~80-100 líneas) |
| Estado | `iTime` compartido — pause/reset/resize sincronizados sin código extra |
| Preset visual | `CAMERA_POS=0.06`, `CAMERA_FAR=3.5`, `ROTATION_SPEED=0.22`, `SHADOW_ALPHA`, `ANIM_SHAPE`, colores default |
| Perf | Sin optimizaciones de entrada; 4 knobs disponibles si hace falta |
| Testing | Manual + checklist, `pnpm typecheck`, `pnpm build` |
| Riesgos | Conocidos y aceptados; light coherence iterable post-build |
