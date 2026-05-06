# Fantasy World — Shaders & WebGL Handbook

Bibliografía operativa para mantener y optimizar el shader de paisaje de Fantasy World
(`src/shaders/landscape.frag.ts`): raymarching de terreno + bosque (ellipsoides) + nubes
volumétricas con reproyección temporal vía `iChannel0` y matriz de cámara serializada en
`mat3x4` (Shadertoy-style).

El documento se ordena por dominio. Cada entrada lleva: título, URL, qué resuelve y 1‑3
puntos clave aterrizados a nuestro caso. Al final hay una sección de aplicación directa al
proyecto.

---

## 1. Raymarching, SDFs y terreno (Inigo Quilez)

### Raymarching distance fields
- URL: <https://iquilezles.org/articles/raymarchingdf/>
- Resuelve: el algoritmo base de sphere tracing y los criterios de paro (`epsilon`, `tmax`,
  número de pasos).
- Para nosotros:
  - Adaptar `epsilon` al footprint del píxel: en el shader ya se usa `th = 0.001*t` para
    terreno y `0.000125*tf` para árboles; mantener proporcional a `t` evita oversampling
    cerca y aliasing lejos.
  - El loop de árboles itera 64 pasos: si los árboles están detrás del terreno conviene
    salir antes (`tf > tfMax`). Eso ya está, pero el `step` actual es `dis` neto: probar
    `tf += max(dis, 0.05*tf)` clampeado para reducir over‑shoot en zonas planas del SDF.
  - Para shaders de paisaje, "pintar" la luz manualmente (rim/back/dome separados) cuesta
    menos que GI real y luce mejor que un solo `dot(N,L)`.

### Terrain marching
- URL: <https://iquilezles.org/articles/terrainmarching/>
- Resuelve: cómo trazar el rayo contra una heightmap analítica f(x,z) sin tener un SDF
  exacto.
- Para nosotros:
  - **Corrección por secante** al cruzar el terreno: ya está en `raymarchTerrain`
    (`t = ot + (th-odis)*(t-ot)/(dis-odis)`); no se debe romper, mejora 1 o 2 píxeles de
    bordes sin coste extra.
  - **Step proporcional a t** (`dt ≈ 0.01*t`): nuestro shader hace algo más agresivo
    (`t += dis*0.8*(1.0-0.75*env.y)`); el factor `env.y` reduce el paso donde la
    pendiente es alta (mapa de "filos"). Ojo si se aumenta `0.8` por velocidad: a partir de
    ~0.95 empiezan a aparecer mordiscos en crestas.
  - Limitar el rayo por la altura máxima del terreno + dosel
    (`tp = (kMaxHeight+kMaxTreeHeight-ro.y)/rd.y`) elimina pasos inútiles cuando se mira
    al cielo: ya implementado, no tocar.

### Soft shadows con SDF
- URL: <https://iquilezles.org/articles/rmshadows/>
- Resuelve: penumbra "gratis" durante la marcha de la sombra usando `min(res, k*h/t)`.
- Para nosotros:
  - El `32.0*hei/t` que aparece en `terrainShadow` y `treesShadow` es exactamente este
    truco. `k=32` da penumbra dura; bajarlo a 8‑16 da fuentes más grandes (sol con
    atmósfera). Hay que probar con baja calidad antes que con alta porque interactúa con
    el step.
  - En `LOWQUALITY` (que es el modo activo) `terrainShadow` solo hace 32 iteraciones y el
    paso mínimo es `2.0+t*0.1`. Subir el mínimo a `3+t*0.15` ahorra ALU casi gratis si la
    diferencia visual es imperceptible a la distancia de cámara actual.

### FBM y multifractales
- URL: <https://iquilezles.org/articles/fbm/>
- Resuelve: la receta de FBM (octavas, lacunarity, gain) y por qué hace falta rotar para
  evitar artefactos axis‑aligned.
- Para nosotros:
  - `m2`/`m3` (rotaciones constantes) en `fbm_*` evitan que las crestas se alineen con los
    ejes; nunca quitarlas aunque parezca más barato.
  - 9 octavas para terreno es justo lo que se necesita para detalle a 2 km; más octavas
    son perceptualmente invisibles.
  - Se puede degradar el FBM para sombras y self‑occlusion: `terrainShadow` no necesita 9
    octavas, basta con 5‑6 para mantener silueta con un 30% menos coste.

### Value noise con derivadas analíticas
- URL: <https://iquilezles.org/articles/morenoise/>
- Resuelve: devolver `(noise, ∂/∂x, ∂/∂y, ∂/∂z)` en una sola pasada.
- Para nosotros:
  - `noised`/`noised2d` en el shader implementan exactamente esto. El `fbmd_9` usa esas
    derivadas para construir la normal del terreno **sin** central differences (que
    requieren 6 evaluaciones extra del FBM). Ahorro ≈ 5×.
  - Aprovecha esto en `treesNormal` también: actualmente usa el truco del tetraedro (4
    taps) porque el SDF de árboles no es FBM puro y no expone derivadas. No tiene
    arreglo barato sin reescribir.

### SDF distance functions
- URL: <https://iquilezles.org/articles/distfunctions/>
- Resuelve: catálogo de SDFs primitivas (cápsulas, esferas, elipsoides, cajas...).
- Para nosotros:
  - `sdEllipsoidY` del shader es la aproximación lower‑bound del elipsoide (no es exacta,
    pero sí Lipschitz‑1). Sirve para la copa del árbol.
  - Para troncos vale `sdCapsule`; para hojarasca dispersa, considerar `sdRoundCone`.

### Smoothmin
- URL: <https://iquilezles.org/articles/smin/>
- Resuelve: cómo unir SDFs sin costuras geométricas.
- Para nosotros:
  - Si en algún momento se quiere fusionar copas vecinas (cluster de árboles que se ve
    como una masa) usar **smin polinomial cuadrático**: rápido, conservativo y nunca
    sobre‑estima distancias (importante: si un smin sobre‑estima, el sphere‑tracing salta
    sobre la geometría → agujeros).

### Normales por tetraedro (4 taps)
- URL: <https://iquilezles.org/articles/normalsSDF/>
- Resuelve: calcular normales con 4 evaluaciones del SDF en lugar de 6.
- Para nosotros:
  - `treesNormal` ya usa el patrón `e = 0.5773*(2.0*vec3(...)-1.0)` con 4 iteraciones.
    Coste 4× SDF en vez de 6×: 33% menos. No reemplazar por central diff aunque "se
    entienda mejor".

### Fog y atmospheric scattering
- URL: <https://iquilezles.org/articles/fog/>
- Resuelve: niebla exponencial con extinción por canal y in‑scattering del sol.
- Para nosotros:
  - `fog()` del shader implementa la versión por canal:
    `exp2(-t*0.00025*vec3(1,1.5,4))`. El factor 4 en azul hace que el azul se extinga más
    rápido en el aire; si se quiere atardecer subir el factor verde y bajar el azul.
  - El "halo" del sol a través de niebla sale de
    `0.25*vec3(0.8,0.4,0.2)*pow(sun, 4)` al final de `mainImage`: se puede multiplicar
    por `(1.0-isCloud)` para que las nubes no lo "atenúen mal".

---

## 2. The Book of Shaders

### Capítulo 5 — Shaping functions / smoothstep
- URL: <https://thebookofshaders.com/05/>
- Resuelve: introducción a `step`, `smoothstep` y curvas de remap.
- Para nosotros:
  - `smoothstep` está acelerado en hardware. Usar `smoothstep(a,b,x)` en lugar de
    `clamp((x-a)/(b-a),0,1)*(3-2*…)`: el compilador hará lo mismo pero el código queda
    auditable.
  - Todos los `mix`/`smoothstep` finales del color en `mainImage` son fadeouts por
    distancia (`smoothstep(60.0,200.0,resT)`). Buen patrón.

### Capítulo 11 — Noise
- URL: <https://thebookofshaders.com/11/>
- Resuelve: introducción a value noise vs gradient noise (Perlin) e interpolación cúbica
  de Hermite.
- Para nosotros:
  - El `u = w*w*w*(w*(w*6-15)+10)` que aparece en `noise`/`noise2d` es la quintic de
    Perlin (C2 continua). Si por algún motivo se quiere simplificar, una hermite cúbica
    `w*w*(3-2*w)` cuesta menos pero se notan kinks en derivadas → aparecen banding al
    iluminar.

### Capítulo 13 — Fractal Brownian Motion
- URL: <https://thebookofshaders.com/13/>
- Resuelve: cómo apilar octavas para FBM.
- Para nosotros:
  - El truco de "domain warping" (FBM(p + FBM(p))) puede dar bosques con aspecto de
    crecimiento real. Coste: 2× evaluaciones de FBM. Sólo aplicable si bajamos octavas
    base a 5.
  - Para nubes: el FBM 3D ya está implementado en `fbmd_8`; añadir un warp adicional sale
    caro y la cámara apenas lo ve por nuestra distancia.

---

## 3. Three.js — ShaderMaterial y render targets

### ShaderMaterial vs RawShaderMaterial
- URL: <https://threejs.org/docs/#api/en/materials/ShaderMaterial>
- Resuelve: cómo declarar materiales con shaders custom y qué inyecta Three.js
  automáticamente (uniforms `modelMatrix`, `viewMatrix`, atributos `position`, `uv`, etc.).
- Para nosotros:
  - Para un fullscreen quad de raymarching **conviene `RawShaderMaterial`** o
    `ShaderMaterial` con `glslVersion: THREE.GLSL3`: evitamos cualquier inyección que
    contamine el `out vec4 outColor` ya declarado.
  - `defines` permite introducir `#define LOWQUALITY` desde JS sin recompilar manualmente
    el código; útil para A/B perf.
  - `glslVersion: THREE.GLSL3` es obligatorio porque el shader usa `texelFetch`,
    `textureLod`, `mat3x4` y `out vec4 outColor` — todos GLSL ES 3.00.

### WebGLRenderTarget (ping‑pong / feedback)
- URL: <https://threejs.org/docs/#api/en/renderers/WebGLRenderTarget>
- Resuelve: render‑to‑texture, formato y tipo del buffer.
- Para nosotros:
  - Para reproyección temporal hacen falta **dos** RT (`A` y `B`) que se intercambian.
    El shader lee de `B.texture` y escribe a `A`; al final del frame se swappean.
  - **Tipo:** `HalfFloatType` es el sweet spot. `UnsignedByteType` recorta el HDR del
    historial (notable en zonas brillantes del cielo + sol). `FloatType` es waste si no
    se va a postprocesar a alto rango — y consume el doble de bandwidth.
  - **Filtrado:** `LinearFilter`. `textureLod(iChannel0, spos, 0.0)` ya pide lod 0
    explícitamente; con `LinearFilter` la GPU hace la interpolación bilineal del
    historial gratis.
  - **Wrap:** `ClampToEdgeWrapping` para que el `bool offscreen` del shader sea la única
    fuente de verdad (con `RepeatWrapping` se metería ghosting wrap‑around en bordes).
  - El shader serializa la matriz de cámara en los píxeles (0,0)..(2,0) — el RT debe
    poder leerse a sí mismo, así que `A` y `B` deben tener el **mismo tamaño** que el
    framebuffer principal.

---

## 4. React Three Fiber

### Hooks: useFrame y useThree
- URL: <https://r3f.docs.pmnd.rs/api/hooks>
- Resuelve: integración React ↔ render loop de Three.js.
- Para nosotros:
  - `useFrame((state, delta) => {...}, priority)` con `priority > 0` **desactiva el
    render automático**. En ese caso somos responsables de llamar
    `gl.render(scene, camera)`. Para ping‑pong necesitamos esto.
  - Patrón típico:
    ```ts
    useFrame(({ gl, scene, camera }) => {
      gl.setRenderTarget(rtA);
      material.uniforms.iChannel0.value = rtB.texture;
      gl.render(scene, camera);
      gl.setRenderTarget(null);
      // blit rtA al canvas con un material trivial
      [rtA, rtB] = [rtB, rtA];
    }, 1);
    ```
  - **No hacer `setState`** dentro de `useFrame`. Mutar refs y `material.uniforms.X.value`
    directamente.

### useFBO (drei)
- URL: <https://drei.docs.pmnd.rs/misc/fbo-use-fbo>
- Resuelve: helper que crea un `WebGLRenderTarget` con el ciclo de vida (dispose) atado
  al componente.
- Para nosotros:
  - `useFBO(width, height, settings)` o `useFBO(settings)` (full screen).
  - Settings recomendados aquí:
    `{ type: THREE.HalfFloatType, format: THREE.RGBAFormat,
       minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
       depthBuffer: false, stencilBuffer: false }`.
  - Crear DOS con `useFBO` y `useRef` para el swap; no recrear en cada render.

### shaderMaterial declarativo en JSX
- URL: <https://r3f.docs.pmnd.rs/api/objects>
- Resuelve: pasar uniforms y mantener referencias estables.
- Para nosotros:
  - R3F **mergea** uniforms cuando reasignas el objeto entero — pero la práctica robusta
    es tener un único `uniforms` creado una vez y mutar `.value` en `useFrame`. Cambiar
    el objeto puede romper la cache interna de `WebGLProgram`.

---

## 5. WebGL2 / GLSL ES 3.00

### Wikipedia/MDN — features clave de WebGL2
- URL: <https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext>
- Resuelve: qué API extra tiene WebGL2 sobre WebGL1.
- Para nosotros:
  - **`texelFetch(sampler, ivec2, lod)`**: lectura sin filtrado, en coordenadas enteras.
    El shader lo usa para leer la matriz de cámara serializada en (0,0..2,0). Es la única
    forma correcta porque cualquier filtrado destruiría los floats codificados.
  - **`textureLod(sampler, vec2, float)`**: lectura con LOD explícito sin necesidad de
    derivadas. El shader lo usa para `iChannel0` en el sample del historial — evita que
    la GPU calcule mipmaps innecesarios.
  - **`mat3x4`**: matriz no cuadrada. Tres `vec4` consecutivos. El shader la usa para
    almacenar la matriz de cámara compacta (3 ejes + posición negada en w). Lectura:
    `wpos*oldCam` proyecta `(world,1)` a coordenadas de cámara antigua.
  - **MRT (Multiple Render Targets)**: relevante si en algún momento se separa el pase
    en G‑buffer (depth + albedo + normal) para hacer TAA con motion vectors propios.

### GLSL ES 3.00 — features
- URL: <https://en.wikipedia.org/wiki/OpenGL_Shading_Language>
- Resuelve: diferencias 3.00 vs 1.00 en atributos `in/out`, layout qualifiers, integer
  ops, swizzling.
- Para nosotros:
  - `out vec4 outColor;` reemplaza a `gl_FragColor`.
  - Bucles con `int i=ZERO; i<N; i++` son válidos sin restricciones de "constant
    expression" (en GLSL 1.00 sí lo eran). El truco `ZERO = min(iFrame,0)` se mantiene
    sólo para forzar al compilador a no desenrollar bucles grandes (400 iter en
    `raymarchTerrain` colgaría el shader compiler).
  - Operadores enteros y bitshift (`>>`, `&`) son legales — el `treesNormal` los usa para
    generar las 4 esquinas del tetraedro a partir de `i`.

### MDN WebGL Tutorial
- URL: <https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial>
- Resuelve: índice oficial de tutoriales: contexto, programa, attribs, uniforms, texturas.
- Para nosotros:
  - Buen punto de entrada para refrescar el modelo de pipeline (vertex → primitive
    assembly → rasterizer → fragment) cuando hay que debuggear por qué algo no se dibuja.

---

## 6. TAA y reproyección temporal

### Brian Karis — High Quality Temporal Supersampling (SIGGRAPH 2014)
- URL: <https://de45xmedrsdbp.cloudfront.net/Resources/files/TemporalAA_small-59732822.pdf>
- Resuelve: el algoritmo TAA canónico que usa Unreal: jitter Halton, neighborhood clamp,
  filtro Blackman‑Harris, history rejection.
- Para nosotros:
  - Nuestra reproyección usa un offset jittered `o` por frame y mezcla
    `mix(historia, actual, w)` con `w = 0.1 + 0.8*isCloud`. **No** hay neighborhood clamp
    — por eso depende del ángulo: si los árboles son muy ruidosos se aprecia ghosting.
  - Implementar **clamp al min/max del 3×3** alrededor del píxel actual antes del `mix`
    elimina la mayor parte del ghosting sin coste prohibitivo (8 sample extras del frame
    actual o 4 si se reusa el `col` del thread + neighbors compartidos).
  - **Halton(2,3)** como secuencia de jitter da mejor convergencia que `hash2` aleatorio
    porque cubre el píxel uniformemente en N frames.

### Marco Salvi — An excursion in Temporal Supersampling (GDC 2016)
- URL: <https://developer.download.nvidia.com/gameworks/events/GDC2016/msalvi_temporal_supersampling.pdf>
- Resuelve: rechazo del historial vía estadística (variance clipping) en lugar de min/max
  duro.
- Para nosotros:
  - Variance clip = calcular `μ ± γ·σ` del 3×3 (un primer momento + segundo momento) y
    proyectar la historia hacia ese AABB. Mejor que neighborhood clamp puro: menos
    flicker en zonas con detalle alto (bosque).

### TAA Starter Pack (Alex Tardif)
- URL: <https://alextardif.com/TAA.html>
- Resuelve: receta moderna y minimalista de TAA con todos los componentes.
- Para nosotros:
  - Para un raymarcher **no hay rasterized motion vectors**: hay que derivarlos del
    movimiento de la cámara (delta de la matriz `mat3x4` que ya guardamos) y de la
    posición mundial reconstruida (`ro + rd*resT`). Eso es exactamente lo que hace
    `cpos = wpos*oldCam` en el shader.
  - **Anti‑flicker weighting**: ponderar el blend por luminancia: zonas brillantes pesan
    menos que oscuras al meterlas en el historial → suprime sparkle del especular del
    sol en hojas.

### Sugu Lee — TAA Tutorial
- URL: <https://sugulee.wordpress.com/2021/06/21/temporal-anti-aliasingtaa-tutorial/>
- Resuelve: código paso a paso de TAA con Halton, motion vectors, accumulate.
- Para nosotros:
  - Útil para entender el orden de operaciones cuando se quiere migrar de "reproyección
    casera" a "TAA decente": jitter en clip space → render → reproject por matriz vieja →
    clamp/clip → blend.

### Code Corsair — Temporal AA pitfalls
- URL: <https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/>
- Resuelve: catálogo exhaustivo de fallos de TAA y mitigaciones.
- Para nosotros:
  - **Disocclusion**: cuando la cámara avanza y aparece geometría nueva (parte de árbol
    detrás de otro). Si no se rechaza la historia, hay smear. El shader trata el caso
    "off‑screen" (`spos.x<0 || …`) pero no el caso "el píxel reproyectado cae sobre otra
    profundidad"; añadir un test de profundidad reconstruida cuesta una multiplicación
    extra.
  - **Off‑screen reprojection**: ya tratado correctamente con `bool offscreen`.
  - **History rejection**: nuestro `w = 0.1 + 0.8*isCloud` ya da más peso al frame nuevo
    en nubes (que son muy variables). Buen heurístico, pero hace que la zona de nubes no
    se beneficie del TAA — alternativa: clamp neighborhood en RGB y dejar `w=0.1` global.

### Playdead Inside (TAA reference real)
- URL: <https://s3.amazonaws.com/arena-attachments/655504/c5c71c5507f0f8bf344252958254fb7d.pdf>
- Resuelve: el TAA de Inside, referencia obligada para "TAA en producción".
- Para nosotros:
  - YCoCg para el clipping mejora calidad perceptual: el clip en luminance + chroma es
    menos visible que en RGB. Coste: dos transforms baratos (mat3 fija).

### Wikipedia — Temporal AA
- URL: <https://en.wikipedia.org/wiki/Temporal_anti-aliasing>
- Resuelve: visión global con vocabulario estándar.
- Para nosotros:
  - Útil para alinear nomenclatura cuando se discute con otra persona que viene de
    Unity/Unreal.

---

## 7. Volumetric clouds y raymarching de medios

### Inigo Quilez — Volumetric clouds (Shadertoy)
- URL: <https://www.shadertoy.com/view/4ttSWf>  (referencia canónica: "Rainforest")
- Resuelve: receta de nubes con FBM 3D animado, marcha esférica con paso adaptativo,
  shading con sample del sol (`kSunDir*70.0`).
- Para nosotros:
  - El loop de `renderClouds` ya usa **paso adaptativo** (`dt = max(0.2, 0.011*t)`), que
    es lo correcto: el detalle visible decae con la distancia.
  - 128 iteraciones es alto. Probar 96 con un `dt` un 15% mayor y ver si se nota: en
    nuestro frame con la cámara fija viendo el valle la diferencia es marginal.
  - **Early exit** por opacidad acumulada (`if(sum.a>0.995) break`) es esencial — ya está.

### Brashandplucky — Reprojection TAA
- URL: <https://brashandplucky.com/2023/05/06/reprojection-temporal-antialiasing.html>
- Resuelve: explicación clara de reproyección por matriz inversa de cámara.
- Para nosotros:
  - Confirma que serializar la matriz de cámara en píxeles y leerla con `texelFetch`
    es válido y eficiente para shaders sin acceso a uniforms históricos.

---

## 8. Optimización de fragment shaders

### Interplay of Light — Speedup pixel shaders
- URL: <https://interplayoflight.wordpress.com/2020/02/17/ways-to-speedup-pixel-shader-execution/>
- Resuelve: catálogo concreto de cuellos de botella en fragment shaders modernos.
- Para nosotros:
  - **Register pressure**: cada `vec3`/`vec4` local consume registros. El shader actual
    declara muchas variables intermedias en `mainImage`; un compilador moderno las
    reagrupa, pero scope local (bloques `{}`) ayuda. Evitar guardar valores que sólo se
    usan una vez.
  - **Branch divergence**: el `if(obj==1) … else …` separa terreno y árboles. Como el SIMT
    agrupa píxeles vecinos, en bordes terreno/árbol hay divergencia. Es inevitable; al
    menos minimizar el `else` (ya lo hace, copia código mínimo).
  - **Texture vs ALU**: en este shader **no hay texturas pesadas**, todo es ALU. El
    cuello de botella es el FBM (9 octavas × N evaluaciones por frame). Cualquier
    reducción de octavas en sombras/normales tiene impacto directo en fps.

### Kanzi — Optimizing fragment shaders
- URL: <https://docs.kanzi.com/3.6.6/en-us/Content/Best%20practices/Shaders/Optimizing%20pixel%20shaders.htm>
- Resuelve: guía orientada a precisión y movimiento de cálculos al vertex stage.
- Para nosotros:
  - **Precisión**: el shader usa `precision highp float`. Para el cómputo principal
    (raymarching de FBMs con escalas de 2000) es necesario. **Pero** cosas como `col`,
    `lin`, `nor` se podrían declarar `mediump` localmente — en GPUs móviles puede dar un
    boost de 1.5–2× ese bloque concreto. En desktop normalmente `mediump` se promociona
    a `highp` y no cambia nada.
  - Mover trabajo al vertex shader **no aplica** aquí porque vertex shader sólo emite el
    fullscreen quad.

### NVIDIA shader decompile / optimization (Danil)
- URL: <https://medium.com/geekculture/decompiling-nvidia-shaders-and-optimizing-5aeaeb65f828>
- Resuelve: cómo inspeccionar el código generado y descubrir oportunidades.
- Para nosotros:
  - En desktop, abrir el shader en Spector.js o RenderDoc y ver el ratio ALU/Sample. Si
    está ALU‑bound al 100%, no merece la pena tocar texturas — todo el ahorro saldrá de
    reducir iteraciones del raymarching.

### Generalist Programmer — Shader programming guide 2025
- URL: <https://generalistprogrammer.com/tutorials/shader-programming-complete-graphics-guide-2025>
- Resuelve: visión panorámica actualizada de optimización shader 2025.
- Para nosotros:
  - GPUs SIMT modernas (post‑2016) son menos sensibles al branching que las antiguas; no
    sustituir un `if` por un `mix(a,b,step(c,x))` ciegamente — a veces es **más caro**
    porque calcula ambas ramas.

---

## 9. Recursos canónicos en Shadertoy

### Rainforest (iq) — referencia directa de nuestro shader
- URL: <https://www.shadertoy.com/view/4ttSWf>
- Resuelve: arquitectura completa terreno + bosque + nubes + reproyección temporal con
  matriz serializada.
- Para nosotros:
  - **Es nuestro shader.** Cualquier optimización debería diff‑ear contra esta versión
    para no romper la look.
  - Ver el tab `Buffer A` original explica el ping‑pong: Image lee de Buffer A, Buffer A
    se renderiza al RT y se intercambia.

### Raymarching Primitives (iq)
- URL: <https://www.shadertoy.com/view/Xds3zN>
- Resuelve: catálogo vivo de SDFs, smin, ops booleanos.
- Para nosotros:
  - Banco de pruebas para añadir nuevas formas (rocas, estructuras) sin reinventar.

### Reprojection UV Screen‑Quad (Shadertoy)
- URL: <https://www.shadertoy.com/view/tdyBRz>
- Resuelve: ejemplo mínimo de reproyección con `mat3x4` empacada.
- Para nosotros:
  - Idéntico al patrón nuestro pero esqueleto desnudo — útil para tests aislados sin
    todo el peso del paisaje.

### Multipass minimal example
- URL: <https://www.shadertoy.com/view/lljcDG>
- Resuelve: mostrar cómo se serializan datos en píxeles (1,0)..(N,0) entre buffers.
- Para nosotros:
  - Confirma la convención: la primera fila se reserva como "metadata", el resto es
    color real. Nuestro `if(rpos.y<1.0 && rpos.x<3.0) {} else {…}` justamente protege
    los 3 primeros texels de la fila 0.

---

## 10. Aplicado a Fantasy World

Lista priorizada de cambios para subir fps y reducir motion blur sin cambiar el
*look* del shader. Todo es modificable desde fuera de `landscape.frag.ts` salvo el
último bloque.

1. **Half‑float render targets en lugar de byte (cuando estén creados como byte).**
   Ganancia: HDR limpio, banding fuera. Coste: 2× bandwidth del historial pero fillrate
   de un fragment shader tan pesado se compensa solo. Settings:
   `type: HalfFloatType, format: RGBAFormat, depthBuffer: false`.

2. **Asegurar `glslVersion: THREE.GLSL3` y `RawShaderMaterial`.** Si por error está en
   `ShaderMaterial` con GLSL1, Three.js inserta `#version` y prefijos que reescriben
   `out vec4 outColor` y rompen `texelFetch`. Verificar en el primer render.

3. **Bajar octavas del FBM en sombras.** `terrainShadow` no necesita 9 octavas: basta con
   un `fbm_5` para mantener silueta. Hacer una variante `terrainMapShadow` que use
   `fbm_5` y comparar fps. Esperable 5‑10% global porque las sombras corren en el inner
   loop.

4. **Reducir iteraciones del bosque a la distancia.** El loop de `treesMap` (raymarch)
   itera 64. Para `tf > 400` con `dis < 0.5*tf` ya es invisible — añadir un break por
   distancia una vez calibrado. Ojo: esto sí toca el shader; si no se quiere tocar, la
   misma idea aplica al loop de sombras de árboles.

5. **Implementar neighborhood clamp ligero (3×3) antes del `mix(ocol, col, w)`.**
   Pseudocódigo:
   ```glsl
   vec3 cmin = col, cmax = col;
   // 4‑tap diagonal sample del frame current ya calculado a través de un buffer aparte
   // o bien reutilizar derivadas en clip space
   ocol = clamp(ocol, cmin, cmax);
   ```
   Esto **mata el ghosting de los árboles cuando la cámara hace su `sin(0.008*time)`**
   sin tocar el peso de blend.

6. **Halton(2,3) en lugar de `hash2(vec2(iFrame,1.0))`.** El jitter actual es ruido
   blanco; Halton converge a antialiasing equivalente en ~8 frames vs ~30 con ruido. El
   parámetro `o` de `mainImage` se sustituye por una LUT de 16 offsets indexada por
   `iFrame & 15`.

7. **Anti‑flicker por luminancia.** Modificar el blend final:
   ```glsl
   float lumC = dot(col, vec3(0.299,0.587,0.114));
   float lumO = dot(ocol, vec3(0.299,0.587,0.114));
   float wAdj = w * (1.0 / (1.0 + max(0.0, lumC-lumO)*4.0));
   col = mix(ocol, col, wAdj);
   ```
   Atenúa el sparkle del especular del sol en hojas.

8. **Forzar early‑exit por opacidad en nubes a 0.99.** Está en 0.995. Bajar a 0.98 puede
   ahorrar 5‑15 iteraciones en zonas densas sin diferencia visible.

9. **Eliminar `treesShadow` en LOWQUALITY para árboles fuera de foco** (`resT > 300`).
   Reemplazar por `sha2 = a + (1.0-a)*0.6` constante. El detalle de la sombra de árbol
   sobre árbol no se distingue a esa distancia y el `treesShadow` itera 64 veces.

10. **`mediump` selectivo en color final.** Bloque de tone‑mapping
    (`col = pow(...); col = col*col*(3-2*col); col = pow(col, vec3(...))`) puede ser
    `mediump`. En desktop indistinto, en mobile (si llega a ser objetivo) ahorra ALU.

### Notas sobre lo que NO conviene tocar
- El `ZERO = min(iFrame,0)` en todos los bucles: hace que el compilador **no desenrolle**
  loops de 64/128/400 iteraciones que romperían el shader compiler.
- La constante `1.5` de `vec3 rd = ca * normalize(vec3(p,1.5))`: define el FOV efectivo,
  encaja con la composición elegida.
- El `0.000125*tf` en el threshold de árboles: por debajo aparecen agujeros, por encima
  bordes pixelados.
- La matriz serializada en píxeles (0,0)..(2,0) y el guard `if(ip.y==0 && ip.x<=2)`:
  cualquier modificación que escriba color en esos texels rompe la reproyección del
  siguiente frame.

---

## Apéndice — Orden recomendado de lectura

Si alguien aterriza en este shader sin contexto:

1. iq — *Terrain marching* (10 min) → entender por qué el step es proporcional a `t`.
2. iq — *FBM* + *More noise* (20 min) → entender qué hace cada `fbm_*` del shader.
3. iq — *SDF distance functions* + *Smoothmin* (15 min) → árboles.
4. iq — *Raymarching shadows* (10 min) → la fórmula `32*hei/t`.
5. The Book of Shaders cap. 11–13 (30 min) → fundamentos si vienen de otro stack.
6. Karis — *High Quality Temporal Supersampling* (40 min) → marco mental para
   reproyección.
7. Alex Tardif — *TAA Starter Pack* (20 min) → receta concreta para implementar mejoras.
8. Three.js docs — *ShaderMaterial* + *WebGLRenderTarget* (15 min) → el plumbing.
9. R3F — *useFrame* + drei *useFBO* (10 min) → cómo orquestarlo desde React.

Total: ~3 horas para tener un mapa mental sólido.
