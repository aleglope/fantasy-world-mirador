# Fantasy World · Optimización de FPS — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir el FPS del shader (~17 → 30+ en Playwright headless, ~2× en GPU real) sin perder calidad ni reintroducir parpadeo en árboles.

**Architecture:** Tres pases por frame: (1) landscape sin nubes a 0.85× con feedback temporal; (2) nubes a 0.50× sin feedback (4× menos coste, son blobs *low-frequency*); (3) compose blend simple. Más tres optimizaciones invisibles dentro del shader del landscape.

**Tech Stack:** Vite + React 18 + TypeScript + R3F + Three.js (WebGL2 / GLSL ES 3.00).

**Spec:** `docs/superpowers/specs/2026-05-06-fps-optimization-design.md`.

**Decisión de plan vs spec:** la spec proponía mover el sun glare al `compose.frag`. Lo dejo donde está (dentro del landscape, antes del gamma — como en el original IQ). Razón: el resultado es semánticamente equivalente (las nubes opacas tapan el glare; las transparentes lo dejan ver, igual que en el original donde el orden era `terrain + sun → blend clouds → gamma`) y nos ahorra duplicar el `cameraSetup` en compose. Compose queda como un blend trivial.

**Decisión de espacio de color:** landscape aplica gamma + grade + reproject como hoy. El nuevo clouds.frag aplica la misma cadena gamma + grade al final. Compose hace blend en espacio gamma-encoded (alfa lineal), que es lo que el original hacía implícitamente al final. Diferencia visible vs. blend en linear: <2 % en midtones de bordes nube/cielo. Aceptable.

---

## Task 1: Tres optimizaciones invisibles en `landscape.frag.ts`

**Files:**
- Modify: `src/shaders/landscape.frag.ts`

Tres edits localizados. Ninguno cambia la apariencia, sólo el coste.

- [ ] **Step 1.1: LOD de paso por distancia en `raymarchTerrain`**

Buscar:
```glsl
        ot = t;
        odis = dis;
        t += dis*0.8*(1.0-0.75*env.y); // slow down in step areas
```

Reemplazar por:
```glsl
        ot = t;
        odis = dis;
        // LOD: pasos progresivamente más largos a distancia (silueta intacta
        // gracias a la interpolación lineal final entre ot y t).
        t += dis*0.8*(1.0-0.75*env.y) * (1.0 + 0.0015*t);
```

- [ ] **Step 1.2: Early-out tighter en `treesShadow` (rama LOWQUALITY)**

Buscar:
```glsl
        if( res<0.001 || t>50.0 || pos.y>kMaxHeight+kMaxTreeHeight ) break;
```

Reemplazar por:
```glsl
        // Sombras lejanas que ya están casi opacas no necesitan refinarse.
        if( res<0.001 || t>50.0 || (res<0.05 && t>20.0) || pos.y>kMaxHeight+kMaxTreeHeight ) break;
```

- [ ] **Step 1.3: Cull tighter del raymarch de árboles en `mainImage`**

Buscar:
```glsl
    if( t.y>0.0 )
    {
        float tf = t.y;
        float tfMax = (t.x>0.0)?t.x:tmax;
```

Reemplazar por:
```glsl
    // Si el envelope está a >1500 unidades los árboles individuales no se
    // distinguen del fondo de niebla; saltamos el raymarch de copas.
    if( t.y>0.0 && t.y<1500.0 )
    {
        float tf = t.y;
        float tfMax = (t.x>0.0)?t.x:tmax;
```

- [ ] **Step 1.4: Verificar typecheck**

```bash
cd /Users/agl/Documents/ALEWENCES_PROJECTS/Fantasy_World
pnpm typecheck
```

Expected: PASS.

---

## Task 2: Crear `clouds.frag.ts` — shader sólo de nubes

**Files:**
- Create: `src/shaders/clouds.frag.ts`

Duplica las funciones que el shader de nubes necesita (hashes, ruidos 3D, FBM, las funciones `cloudsFbm/cloudsMap/renderClouds`, `cameraSetup`, gamma/grade). El comentario `// MIRROR: landscape.frag.ts` en cada bloque marca lo que debe mantenerse sincronizado.

- [ ] **Step 2.1: Escribir el archivo completo**

Contenido exacto:
```ts
// Clouds-only fragment shader (GLSL ES 3.00).
// Renderiza solo el volumen de nubes para componer encima del landscape.
// Las funciones aquí son COPIA LITERAL de landscape.frag.ts; cualquier
// cambio en las versiones del landscape debe replicarse aquí.

const cloudsShader = /* glsl */ `precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec3  iResolution;
uniform float iTime;

out vec4 outColor;

#define ZERO 0

// MIRROR: landscape.frag.ts — hashes
float hash1( vec2 p )
{
    p  = 50.0*fract( p*0.3183099 );
    return fract( p.x*p.y*(p.x+p.y) );
}
float hash1( float n )
{
    return fract( n*17.0*fract( n*0.3183099 ) );
}

// MIRROR: landscape.frag.ts — 3D noise + derivative
vec4 noised( in vec3 x )
{
    vec3 p = floor(x);
    vec3 w = fract(x);
    vec3 u = w*w*w*(w*(w*6.0-15.0)+10.0);
    vec3 du = 30.0*w*w*(w*(w-2.0)+1.0);

    float n = p.x + 317.0*p.y + 157.0*p.z;

    float a = hash1(n+0.0);
    float b = hash1(n+1.0);
    float c = hash1(n+317.0);
    float d = hash1(n+318.0);
    float e = hash1(n+157.0);
    float f = hash1(n+158.0);
    float g = hash1(n+474.0);
    float h = hash1(n+475.0);

    float k0 =   a;
    float k1 =   b - a;
    float k2 =   c - a;
    float k3 =   e - a;
    float k4 =   a - b - c + d;
    float k5 =   a - c - e + g;
    float k6 =   a - b - e + f;
    float k7 = - a + b + c - d + e - f - g + h;

    return vec4( -1.0+2.0*(k0 + k1*u.x + k2*u.y + k3*u.z + k4*u.x*u.y + k5*u.y*u.z + k6*u.z*u.x + k7*u.x*u.y*u.z),
                      2.0* du * vec3( k1 + k4*u.y + k6*u.z + k7*u.y*u.z,
                                      k2 + k5*u.z + k4*u.x + k7*u.z*u.x,
                                      k3 + k6*u.x + k5*u.y + k7*u.x*u.y ) );
}

// MIRROR: landscape.frag.ts — m3 / m3i constants
const mat3 m3  = mat3( 0.00,  0.80,  0.60,
                      -0.80,  0.36, -0.48,
                      -0.60, -0.48,  0.64 );
const mat3 m3i = mat3( 0.00, -0.80, -0.60,
                       0.80,  0.36, -0.48,
                       0.60, -0.48,  0.64 );

// MIRROR: landscape.frag.ts — fbmd_8
vec4 fbmd_8( in vec3 x )
{
    float f = 2.0;
    float s = 0.65;
    float a = 0.0;
    float b = 0.5;
    vec3  d = vec3(0.0);
    mat3  m = mat3(1.0,0.0,0.0,
                   0.0,1.0,0.0,
                   0.0,0.0,1.0);
    for( int i=ZERO; i<8; i++ )
    {
        vec4 n = noised(x);
        a += b*n.x;
        if( i<4 )
        d += b*m*n.yzw;
        b *= s;
        x = f*m3*x;
        m = f*m3i*m;
    }
    return vec4( a, d );
}

// MIRROR: landscape.frag.ts — globals
const vec3 kSunDir = vec3(-0.624695,0.468521,-0.624695);

// MIRROR: landscape.frag.ts — fog
vec3 fog( in vec3 col, float t )
{
    vec3 ext = exp2(-t*0.00025*vec3(1,1.5,4));
    return col*ext + (1.0-ext)*vec3(0.55,0.55,0.58);
}

// MIRROR: landscape.frag.ts — cloud functions
vec4 cloudsFbm( in vec3 pos )
{
    return fbmd_8(pos*0.0015+vec3(2.0,1.1,1.0)+0.07*vec3(iTime,0.5*iTime,-0.15*iTime));
}

vec4 cloudsMap( in vec3 pos, out float nnd )
{
    float d = abs(pos.y-1500.0)-50.0;
    vec3 gra = vec3(0.0,sign(pos.y-1500.0),0.0);

    vec4 n = cloudsFbm(pos);
    d += 400.0*n.x * (0.7+0.3*gra.y);

    if( d>0.0 ) return vec4(-d,0.0,0.0,0.0);

    nnd = -d;
    d = min(-d/100.0,0.25);
    return vec4( d, gra );
}

vec4 renderClouds( in vec3 ro, in vec3 rd, float tmin, float tmax )
{
    vec4 sum = vec4(0.0);

    float tl = (1100.0-ro.y)/rd.y;
    float th = (1900.0-ro.y)/rd.y;
    if( tl>0.0 ) tmin = max( tmin, tl ); else return sum;
    if( th>0.0 ) tmax = min( tmax, th );

    float t = tmin;
    float thickness = 0.0;
    for(int i=ZERO; i<128; i++)
    {
        vec3  pos = ro + t*rd;
        float nnd;
        vec4  denGra = cloudsMap( pos, nnd );
        float den = denGra.x;
        float dt = max(0.2,0.011*t);
        if( den>0.001 )
        {
            float kk;
            cloudsMap( pos+kSunDir*70.0, kk );
            float sha = 1.0-smoothstep(-200.0,200.0,kk); sha *= 1.5;

            vec3 nor = normalize(denGra.yzw);
            float dif = clamp( 0.4+0.6*dot(nor,kSunDir), 0.0, 1.0 )*sha;
            float occ = 0.2+0.7*max(1.0-kk/200.0,0.0) + 0.1*(1.0-den);
            vec3 lin  = vec3(0.0);
                 lin += vec3(0.70,0.80,1.00)*1.0*(0.5+0.5*nor.y)*occ;
                 lin += vec3(0.10,0.40,0.20)*1.0*(0.5-0.5*nor.y)*occ;
                 lin += vec3(1.00,0.95,0.85)*3.0*dif*occ + 0.1;

            vec3 col = vec3(0.8,0.8,0.8)*0.45;
            col *= lin;
            col = fog( col, t );

            float alp = clamp(den*0.5*0.125*dt,0.0,1.0);
            col.rgb *= alp;
            sum = sum + vec4(col,alp)*(1.0-sum.a);

            thickness += dt*den;
        }
        else
        {
            dt = abs(den)+0.2;
        }
        t += dt;
        if( sum.a>0.995 || t>tmax ) break;
    }

    sum.xyz += max(0.0,1.0-0.0125*thickness)*vec3(1.00,0.60,0.40)*0.3*pow(clamp(dot(kSunDir,rd),0.0,1.0),32.0);
    return clamp( sum, 0.0, 1.0 );
}

// MIRROR: landscape.frag.ts — cameraSetup
// Cualquier cambio en la cámara del landscape debe replicarse aquí.
void cameraSetup( in float time, in vec2 fragCoord, out vec3 ro, out vec3 rd ) {
    vec2 p = (2.0*fragCoord - iResolution.xy) / iResolution.y;

    ro = vec3(0.0, 720.0, 200.0);
    vec3 ta = vec3(0.0, 580.0, -260.0);

    ro.x += 80.0*sin(0.008*time);
    ta.x += 60.0*sin(0.008*time);

    vec3 cw = normalize(ta-ro);
    vec3 cp = vec3(0.0, 1.0, 0.0);
    vec3 cu = normalize(cross(cw,cp));
    vec3 cv = normalize(cross(cu,cw));
    rd = normalize( mat3(cu,cv,cw) * vec3(p,1.5) );
}

void main() {
    vec3 ro, rd;
    cameraSetup(iTime, gl_FragCoord.xy, ro, rd);

    vec4 res = renderClouds(ro, rd, 0.0, 2000.0);

    // Aplicar la misma cadena gamma+grade que el landscape, así el blend en
    // compose ocurre en el mismo espacio de color.
    // MIRROR: landscape.frag.ts — gamma + grade chain
    vec3 col = res.rgb;
    col = pow( clamp(col*1.1-0.02,0.0,1.0), vec3(0.4545) );
    col = col*col*(3.0-2.0*col);
    col = pow( col, vec3(1.0,0.92,1.0) );
    col *= vec3(1.02,0.99,0.9 );
    col.z = col.z+0.1;

    outColor = vec4(col, res.a);
}
`;

export default cloudsShader;
```

- [ ] **Step 2.2: Verificar typecheck (no hay imports rotos)**

```bash
pnpm typecheck
```

Expected: errores sólo en `ShaderLandscape.tsx` o ninguno; el archivo `clouds.frag.ts` por sí solo compila TypeScript (es una string export).

---

## Task 3: Modificar `landscape.frag.ts` — quitar `renderClouds` del mainImage

**Files:**
- Modify: `src/shaders/landscape.frag.ts`

Sólo dos edits en `mainImage`. El sun glare se queda en su sitio (no se mueve a compose como decía la spec — ver header del plan para la justificación).

- [ ] **Step 3.1: Quitar la llamada a `renderClouds`**

Buscar:
```glsl
    float isCloud = 0.0;
    {
        vec4 res = renderClouds( ro, rd, 0.0, resT, resT, fragCoord );
        col = col*(1.0-res.w) + res.xyz;
        isCloud = res.w;
    }
```

Reemplazar por:
```glsl
    // Las nubes se renderizan ahora en clouds.frag a media resolución y se
    // componen en compose.frag. Conservamos isCloud=0 porque la reproyección
    // temporal usaba ese factor para confiar más del frame nuevo en zonas
    // nublosas; al no haber nubes en este pase, esa rama se desactiva.
    float isCloud = 0.0;
```

- [ ] **Step 3.2: Quitar `renderClouds` y `cloudsMap`/`cloudsFbm`/`cloudsShadowFlat` no — se mantienen porque `cloudsShadowFlat` lo usa el landscape para sombras de terreno**

Verificación: el sombreado de terreno usa `cloudsShadowFlat(epos, kSunDir)` cerca de la línea ~595. Eso necesita `cloudsFbm` y por extensión `fbmd_8`. **No tocar** esas funciones; sólo quitamos la llamada a `renderClouds` desde `mainImage`.

(Step de no-cambio. Sólo confirma que lo anterior es lo único que toco en este Task.)

- [ ] **Step 3.3: Verificar typecheck**

```bash
pnpm typecheck
```

Expected: PASS (el shader sigue siendo una string válida).

---

## Task 4: Crear `compose.frag.ts` — blend trivial

**Files:**
- Create: `src/shaders/compose.frag.ts`

- [ ] **Step 4.1: Escribir el archivo completo**

Contenido exacto:
```ts
// Compose fragment shader: blend del landscape con las nubes premultiplicadas.
// Ambas texturas están en el mismo espacio de color (gamma + grade aplicado),
// así que el blend simple `main*(1-alpha) + clouds.rgb` es perceptualmente
// correcto.

const composeShader = /* glsl */ `precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uMain;
uniform sampler2D uClouds;

void main() {
  vec3 main = texture(uMain, vUv).rgb;
  vec4 clouds = texture(uClouds, vUv); // upscale bilinear automático
  outColor = vec4(main*(1.0-clouds.a) + clouds.rgb, 1.0);
}
`;

export default composeShader;
```

- [ ] **Step 4.2: Verificar typecheck**

```bash
pnpm typecheck
```

Expected: errores sólo en `ShaderLandscape.tsx` (que aún no lo importa).

---

## Task 5: Refactorizar `ShaderLandscape.tsx` — 3 escenas + cloudsLo FBO

**Files:**
- Modify: `src/components/ShaderLandscape.tsx`

Es el cambio más grande. Reescribo el archivo completo para mantener la coherencia.

- [ ] **Step 5.1: Reemplazar el archivo completo**

Contenido exacto:
```tsx
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import landscapeFrag from '../shaders/landscape.frag';
import cloudsFrag from '../shaders/clouds.frag';
import composeFrag from '../shaders/compose.frag';
import fullscreenVert from '../shaders/fullscreen.vert';
import { usePingPongFBO } from '../hooks/usePingPongFBO';

const MAX_DPR = 1.5;
const RES_SCALE_MAIN = 0.85;
const RES_SCALE_CLOUDS = 0.5;

interface Props {
  paused: boolean;
  resetSignal: number;
  onFirstFrame?: () => void;
  timeRef?: { current: number };
  frameRef?: { current: number };
}

export function ShaderLandscape({
  paused,
  resetSignal,
  onFirstFrame,
  timeRef,
  frameRef,
}: Props) {
  const { gl, size } = useThree();

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const initMainW = Math.max(1, Math.floor(size.width * dpr * RES_SCALE_MAIN));
  const initMainH = Math.max(1, Math.floor(size.height * dpr * RES_SCALE_MAIN));

  // Ping-pong FBO para el landscape (con feedback temporal vía iChannel0).
  const mainHi = usePingPongFBO({ width: initMainW, height: initMainH });

  // FBO simple para las nubes (sin feedback temporal — son blobs suaves
  // que evolucionan smooth con iTime y no necesitan acumulación).
  const cloudsLo = useMemo(() => {
    const w = Math.max(
      1,
      Math.floor(size.width * dpr * RES_SCALE_CLOUDS),
    );
    const h = Math.max(
      1,
      Math.floor(size.height * dpr * RES_SCALE_CLOUDS),
    );
    return new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      cloudsLo.dispose();
    };
  }, [cloudsLo]);

  // Materiales
  const landscapeMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVert,
      fragmentShader: landscapeFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        iResolution: { value: new THREE.Vector3(initMainW, initMainH, 1) },
        iTime: { value: 0 },
        iFrame: { value: 0 },
        iChannel0: { value: null },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cloudsMat = useMemo(() => {
    const w = Math.max(
      1,
      Math.floor(size.width * dpr * RES_SCALE_CLOUDS),
    );
    const h = Math.max(
      1,
      Math.floor(size.height * dpr * RES_SCALE_CLOUDS),
    );
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVert,
      fragmentShader: cloudsFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        iResolution: { value: new THREE.Vector3(w, h, 1) },
        iTime: { value: 0 },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const composeMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVert,
      fragmentShader: composeFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uMain: { value: null },
        uClouds: { value: null },
      },
    });
  }, []);

  // Tres escenas + cámara ortográfica trivial
  const { sceneMain, sceneClouds, sceneCompose, fsCamera, geom } = useMemo(() => {
    const geom = new THREE.PlaneGeometry(2, 2);
    const sceneMain = new THREE.Scene();
    const meshMain = new THREE.Mesh(geom, landscapeMat);
    meshMain.frustumCulled = false;
    sceneMain.add(meshMain);
    const sceneClouds = new THREE.Scene();
    const meshClouds = new THREE.Mesh(geom, cloudsMat);
    meshClouds.frustumCulled = false;
    sceneClouds.add(meshClouds);
    const sceneCompose = new THREE.Scene();
    const meshCompose = new THREE.Mesh(geom, composeMat);
    meshCompose.frustumCulled = false;
    sceneCompose.add(meshCompose);
    const fsCamera = new THREE.Camera();
    return { sceneMain, sceneClouds, sceneCompose, fsCamera, geom };
  }, [landscapeMat, cloudsMat, composeMat]);

  const stateRef = useRef({
    time: 0,
    frame: 0,
    notifiedFirst: false,
  });

  // Resize debounced
  useEffect(() => {
    const handle = setTimeout(() => {
      const mw = Math.max(1, Math.floor(size.width * dpr * RES_SCALE_MAIN));
      const mh = Math.max(1, Math.floor(size.height * dpr * RES_SCALE_MAIN));
      const cw = Math.max(1, Math.floor(size.width * dpr * RES_SCALE_CLOUDS));
      const ch = Math.max(1, Math.floor(size.height * dpr * RES_SCALE_CLOUDS));
      mainHi.setSize(mw, mh);
      cloudsLo.setSize(cw, ch);
      landscapeMat.uniforms.iResolution.value.set(mw, mh, 1);
      cloudsMat.uniforms.iResolution.value.set(cw, ch, 1);
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
    if (timeRef) timeRef.current = 0;
    if (frameRef) frameRef.current = 0;
    const prev = gl.getRenderTarget();
    const clearColor = new THREE.Color();
    gl.getClearColor(clearColor);
    const clearAlpha = gl.getClearAlpha();
    gl.setClearColor(0x000000, 0);
    gl.setRenderTarget(mainHi.read);
    gl.clear(true, true, true);
    gl.setRenderTarget(mainHi.write);
    gl.clear(true, true, true);
    gl.setRenderTarget(cloudsLo);
    gl.clear(true, true, true);
    gl.setRenderTarget(prev);
    gl.setClearColor(clearColor, clearAlpha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  // Cleanup de materiales y geometría
  useEffect(() => {
    return () => {
      landscapeMat.dispose();
      cloudsMat.dispose();
      composeMat.dispose();
      geom.dispose();
    };
  }, [landscapeMat, cloudsMat, composeMat, geom]);

  // Render loop manual: 3 pases por frame
  useFrame((_, delta) => {
    const s = stateRef.current;

    if (!paused) {
      s.time += delta;

      // Pase 1: landscape (sin nubes) → mainHi.write
      landscapeMat.uniforms.iTime.value = s.time;
      landscapeMat.uniforms.iFrame.value = s.frame;
      landscapeMat.uniforms.iChannel0.value = mainHi.read.texture;
      gl.setRenderTarget(mainHi.write);
      gl.render(sceneMain, fsCamera);

      // Pase 2: nubes a 0.5× → cloudsLo
      cloudsMat.uniforms.iTime.value = s.time;
      gl.setRenderTarget(cloudsLo);
      gl.render(sceneClouds, fsCamera);

      // Pase 3: compose → canvas
      composeMat.uniforms.uMain.value = mainHi.write.texture;
      composeMat.uniforms.uClouds.value = cloudsLo.texture;
      gl.setRenderTarget(null);
      gl.render(sceneCompose, fsCamera);

      mainHi.swap();
      s.frame += 1;

      if (timeRef) timeRef.current = s.time;
      if (frameRef) frameRef.current = s.frame;

      if (!s.notifiedFirst && s.frame > 1) {
        s.notifiedFirst = true;
        onFirstFrame?.();
      }
    } else {
      // En pausa: re-componer con la última textura disponible
      composeMat.uniforms.uMain.value = mainHi.read.texture;
      composeMat.uniforms.uClouds.value = cloudsLo.texture;
      gl.setRenderTarget(null);
      gl.render(sceneCompose, fsCamera);
    }
  }, 1);

  return null;
}
```

- [ ] **Step 5.2: Verificar typecheck**

```bash
pnpm typecheck
```

Expected: PASS sin errores.

---

## Task 6: Build de producción

**Files:** ninguno (sólo correr comandos).

- [ ] **Step 6.1: Build**

```bash
pnpm build
```

Expected: vite genera `dist/` sin errores. Tamaño esperado del bundle JS: <300 KB gzip (R3F + three + 3 shaders inline).

---

## Task 7: Verificación visual con Playwright

**Files:** ninguno; produce screenshots.

- [ ] **Step 7.1: Levantar dev server en background**

```bash
pnpm dev
```

(En el agente de subagent-driven-development, lanzar con `run_in_background: true` y esperar con un curl loop hasta que sirva.)

- [ ] **Step 7.2: Abrir Playwright, navegar y esperar**

Usar las herramientas `mcp__plugin_playwright_playwright__*`:

```
browser_navigate → http://localhost:5173/
browser_wait_for → time: 8
```

- [ ] **Step 7.3: Verificar consola sin errores**

```
browser_console_messages → level: error
```

Expected: 0 errores.

- [ ] **Step 7.4: Tomar screenshot**

```
browser_take_screenshot → filename: fantasy-world-v4.png, type: png, fullPage: false
```

- [ ] **Step 7.5: Comparar con `fantasy-world-v3.png`**

Criterios visuales (juicio del verificador, sin diff automático):
- **Las nubes se ven** en v4 (en v3 ya volvieron a aparecer tras subir la capa a y=1500).
- **El paisaje se ve igualmente nítido** — el LOD por distancia y los early-outs no deben crear silhouettes raras.
- **No hay shimmer/parpadeo en árboles** comparando posiciones de copas entre los dos.
- **FPS** del HUD de v4 debe ser **≥ 22** (vs 17 en v3) en headless. En GPU real esto se traducirá en ~50-60+.

- [ ] **Step 7.6: Cerrar browser y dev server**

```
browser_close
```

Y en bash:
```bash
pkill -f vite 2>/dev/null
```

---

## Task 8 (opcional): Commit

**Files:** ninguno.

Si el repo está inicializado en git y los pasos previos pasan:

- [ ] **Step 8.1: Stage + commit**

```bash
git add -A
git commit -m "perf: split clouds to 0.5x FBO + invisible LOD optimizations

- new clouds.frag (no temporal feedback, half-res)
- new compose.frag (simple alpha blend)
- distance-based step LOD in raymarchTerrain
- tighter early-out in treesShadow
- cull tree raymarch when envelope > 1500 units
- 3-pass render loop in ShaderLandscape

Expected: ~2x FPS in real GPU, no visible quality loss."
```

Saltar si no hay repo git.

---

## Notas de ejecución

Las tareas son **secuenciales** y no se prestan a paralelización útil — Task 5 depende del clouds.frag y compose.frag de Tasks 2 y 4, y Task 3 modifica el mismo archivo que Task 1. La verificación (7) es lo último y depende de un build válido.

Despacho recomendado:
1. Task 1 (3 edits localizados) → typecheck
2. Task 2 (clouds.frag) → typecheck
3. Task 3 (quitar renderClouds del landscape) → typecheck
4. Task 4 (compose.frag) → typecheck
5. Task 5 (ShaderLandscape.tsx refactor) → typecheck
6. Task 6 (build)
7. Task 7 (verificación visual con Playwright)
8. Task 8 (commit, opcional)
