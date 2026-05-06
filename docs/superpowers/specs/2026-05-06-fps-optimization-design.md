# Fantasy World — Optimización de FPS · Diseño

**Fecha:** 2026-05-06
**Estado:** aprobado por usuario, listo para plan de implementación
**Stack:** Vite + React 18 + TypeScript + R3F + Three.js (WebGL2)

---

## 1. Objetivo

Subir el FPS del shader manteniendo la calidad visual actual y, sobre todo,
sin reintroducir el parpadeo en árboles que apareció en una iteración previa
(brainstorm v1: bajar `RES_SCALE` a 0.7 + reducir peso del historial temporal
de 0.1 a 0.3 + check binario de desocclusion). Aquella combinación introdujo
shimmer en copas y vibración por aliasing del upscale.

Estrategia elegida: **Plan B — equilibrado**:

1. Optimizaciones invisibles dentro del shader actual (LOD, early-outs, cull).
2. Separar las nubes a un segundo FBO de baja resolución (0.5×) y componer.

Esperado: +60 a 100 % FPS sin pérdida visual perceptible. Las nubes son
inherentemente *low-frequency* (FBM volumétrico), tolera bien el upscale
bilinear.

## 2. Arquitectura

```
ShaderLandscape  (3 pases por frame)
├─ Scene main:    fullscreen quad + landscape ShaderMaterial (sin nubes)
├─ Scene clouds:  fullscreen quad + clouds ShaderMaterial    (nuevo)
├─ Scene compose: fullscreen quad + compose ShaderMaterial   (nuevo)
├─ FBO mainHi:    ping-pong (al 0.85× del canvas, HalfFloat)
├─ FBO cloudsLo:  simple        (al 0.50× del canvas, HalfFloat)
└─ useFrame(priority=1):
    1. landscape sin nubes → mainHi.write   (con iChannel0=mainHi.read)
    2. clouds              → cloudsLo
    3. compose(mainHi, cloudsLo) → canvas
    4. swap mainHi; iFrame++
```

Justificación: las nubes ocupan ~30 % del coste actual del shader (128 iter de
volumetric raymarching). A 0.5× son **4×** más baratas y se ven idénticas
porque ya son blobs suaves; el upscale bilinear no introduce alias visible.
El landscape (alta frecuencia: terreno, hojas) se mantiene a 0.85× para no
tocar lo que ya está pulido.

## 3. Optimizaciones invisibles dentro del shader

Tres cambios sobre `landscape.frag.ts` antes de tocar la pipeline:

### a) Distance-based LOD en raymarch de terreno

`raymarchTerrain` actual:
```glsl
t += dis*0.8*(1.0-0.75*env.y);
```

Pasa a:
```glsl
t += dis*0.8*(1.0-0.75*env.y) * (1.0 + 0.0015*t);
```

Pasos progresivamente más grandes con la distancia. La silueta se conserva
porque la convergencia final usa interpolación lineal entre `ot`/`t`. Ahorro
estimado: ~25 % de iteraciones efectivas.

### b) Early-out tighter en `treesShadow`

Actual (LOWQUALITY):
```glsl
if( res<0.001 || t>50.0 || pos.y>kMaxHeight+kMaxTreeHeight ) break;
```

Pasa a:
```glsl
if( res<0.001 || t>50.0 || (res<0.05 && t>20.0) || pos.y>kMaxHeight+kMaxTreeHeight ) break;
```

Sombras lejanas ya casi opacas no necesitan refinarse. Cero artefacto
porque a `res<0.05` el píxel queda esencialmente en sombra plena.

### c) Cull tighter del raymarch de árboles

En `mainImage`, después del raymarch del envelope:
```glsl
if( t.y>0.0 ) {
    float tf = t.y;
    ...
}
```

Pasa a:
```glsl
if( t.y>0.0 && t.y<1500.0 ) {
    float tf = t.y;
    ...
}
```

Si el envelope está a más de 1500 unidades, los árboles individuales no
serían distinguibles del color de terreno + niebla. Saltarse el raymarch
ahorra coste en píxeles del horizonte.

## 4. Componentes nuevos

### `src/shaders/clouds.frag.ts`

Nuevo fragment shader, sólo nubes. Contiene:
- `cloudsFbm`, `cloudsMap`, `renderClouds` (copiado del landscape, idéntico
  tras el ajuste de capa a y=1500 ya hecho en la fase anterior)
- Función `cameraSetup(time, out vec3 ro, out vec3 rd, vec2 fragCoord)` —
  duplicada literalmente del landscape para mantener sincronía
- Output: `outColor = vec4(rgb, alpha)` donde alpha viene de `sum.a` de
  `renderClouds`

Tamaño esperado: ~150 líneas de GLSL.

### `src/shaders/compose.frag.ts`

Composición landscape + nubes:
```glsl
uniform sampler2D uMain;
uniform sampler2D uClouds;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec3 main = texture(uMain, vUv).rgb;
  vec4 clouds = texture(uClouds, vUv);  // bilinear automatic upscale
  outColor = vec4(main*(1.0-clouds.a) + clouds.rgb, 1.0);
}
```

### `src/shaders/landscape.frag.ts` — modificado

- Quita la llamada `renderClouds(...)` del `mainImage`
- Quita el `col += 0.25*vec3(0.8,0.4,0.2)*pow(sun, 4.0)` final (sun glare)
- Sun glare se mueve a `compose.frag.ts` para que sume por encima de todo
- La reproyección temporal sigue intacta sobre el landscape sin nubes

### `src/components/ShaderLandscape.tsx` — modificado

```ts
const RES_SCALE_MAIN   = 0.85;
const RES_SCALE_CLOUDS = 0.50;
```

- `usePingPongFBO` para mainHi (igual que ahora)
- Nuevo: `useFBO`-style hook simple para cloudsLo (sin ping-pong; las nubes
  no usan feedback temporal). Para no introducir un hook nuevo, lo creamos
  inline con un `useMemo` en el componente.
- Tres `THREE.Scene` y tres `ShaderMaterial`s (main, clouds, compose).
- Resize redimensiona ambos FBOs.

## 5. Flujo de datos

### Uniforms

**landscape (igual que ahora):**
| nombre | tipo | origen |
|---|---|---|
| `iResolution` | `vec3` | tamaño FBO mainHi |
| `iTime` | `float` | acumulado interno |
| `iFrame` | `int` | contador interno |
| `iChannel0` | `sampler2D` | `mainHi.read.texture` |

**clouds (nuevo):**
| nombre | tipo | origen |
|---|---|---|
| `iResolution` | `vec3` | tamaño FBO cloudsLo (canvas × 0.5 × dpr) |
| `iTime` | `float` | acumulado interno (mismo `s.time` que landscape) |

**compose (nuevo):**
| nombre | tipo | origen |
|---|---|---|
| `uMain` | `sampler2D` | `mainHi.write.texture` (después del pase 1) |
| `uClouds` | `sampler2D` | `cloudsLo.texture` |
| `iResolution` | `vec3` | tamaño canvas |
| `iTime` | `float` | para sun glare final |

### Render loop completo

```ts
useFrame((_, delta) => {
  const s = stateRef.current;

  if (!paused) {
    s.time += delta;

    // Pase 1: landscape (sin nubes)
    landscapeMat.uniforms.iChannel0.value = mainHi.read.texture;
    landscapeMat.uniforms.iTime.value = s.time;
    landscapeMat.uniforms.iFrame.value = s.frame;
    gl.setRenderTarget(mainHi.write);
    gl.render(sceneMain, fsCamera);

    // Pase 2: clouds a 0.5×
    cloudsMat.uniforms.iTime.value = s.time;
    gl.setRenderTarget(cloudsLo);
    gl.render(sceneClouds, fsCamera);

    // Pase 3: compose → canvas
    composeMat.uniforms.uMain.value = mainHi.write.texture;
    composeMat.uniforms.uClouds.value = cloudsLo.texture;
    composeMat.uniforms.iTime.value = s.time;
    gl.setRenderTarget(null);
    gl.render(sceneCompose, fsCamera);

    mainHi.swap();
    s.frame++;

    if (timeRef) timeRef.current = s.time;
    if (frameRef) frameRef.current = s.frame;
    if (!s.notifiedFirst && s.frame > 1) {
      s.notifiedFirst = true;
      onFirstFrame?.();
    }
  } else {
    // En pausa: re-componer con la última textura
    composeMat.uniforms.uMain.value = mainHi.read.texture;
    composeMat.uniforms.uClouds.value = cloudsLo.texture;
    gl.setRenderTarget(null);
    gl.render(sceneCompose, fsCamera);
  }
}, 1);
```

## 6. Casos borde y errores

- **Sincronía cámara entre landscape y clouds**: ambos shaders contienen una
  copia literal del cálculo de cámara. Riesgo: que evolucione una y no la
  otra. **Mitigación**: comentario `// MIRROR: clouds.frag.ts` en ambos
  ficheros junto al bloque.
- **Halo bilinear en bordes nube/cielo claro**: posible artefacto del
  upscale 0.5×. Mitigación: la composición usa alpha como máscara, no edge
  sharp; en la práctica los bordes de nube son suaves por construcción.
- **Compilación falla en clouds o compose**: `onError` log; app sigue con
  landscape solo (degradación elegante posible si el código de error
  permite que `compose` no inicialice — para v1 es aceptable que crashee
  visiblemente con error en consola).
- **Resize**: ambos FBOs redimensionan; mainHi resetea `iFrame=0` para
  invalidar reproyección. cloudsLo no necesita reset (no tiene memoria).
- **iFrame==0 en pausa**: si pausa antes del primer frame válido, el
  compose intenta leer cloudsLo con texel cero — se ve como sin nubes
  durante un frame. Aceptable.

## 7. Testing

Sin suite automática.

- `pnpm typecheck` debe pasar.
- `pnpm build` debe pasar.
- **Verificación visual con Playwright** (procedimiento):
  1. Levantar dev server.
  2. Navegar a `localhost:5173`, esperar 8 s.
  3. Tomar screenshot `fantasy-world-v4.png`.
  4. Comparar con `fantasy-world-v3.png` (estado pre-optimización):
     - Las nubes deben verse en v4.
     - El paisaje debe verse igualmente nítido.
     - Los árboles no deben mostrar shimmer obvio comparando los dos.
  5. FPS objetivo: pasar de 17 (headless) a 30+ (headless).

## 8. Fuera de alcance

- Plan C (alternate-frame clouds) — no, queda como futura iteración si fuera
  necesario.
- Quality preset UI (low/medium/high) — no, demasiado scope. Las constantes
  `RES_SCALE_MAIN/CLOUDS` quedan como knobs en el código.
- Reescribir el cálculo de cámara como uniform compartido — no, mantenerlo
  duplicado es más simple y son 4 líneas.
- Reducir el LOWQUALITY define más allá de lo que ya está.

## 9. Próximos pasos

1. Plan de implementación detallado (skill `writing-plans`).
2. Ejecución (probable single-pass: las modificaciones son acopladas).
3. Verificación visual contra v3.
