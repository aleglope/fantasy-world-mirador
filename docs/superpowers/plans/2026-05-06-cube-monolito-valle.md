# Cubo "Monolito del Valle" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar el shader Shadertoy `NslGRN` como cubo orbitando en el centro del paisaje, con sombra alpha mezclada al valle, sincronizado con el tiempo del paisaje (pause/reset/resize coherentes).

**Architecture:** Pipeline de 4 pases — `landscape → clouds → compose (a FBO composeOut) → cube (a canvas, leyendo composeOut como iChannel0)`. El propio shader del cubo en modo `SHADOW_ALPHA` hace internamente el composite final con el paisaje (`fragColor = cube*α + iChannel0*(1-α)`).

**Tech Stack:** TypeScript, React 18, R3F 8, Three.js 0.170 (WebGL2 / GLSL3), Vite 5.

**Spec de referencia:** [`docs/superpowers/specs/2026-05-06-cube-monolito-valle-design.md`](../specs/2026-05-06-cube-monolito-valle-design.md)

**Atribución:** El shader del cubo es obra de Danil (2021+), Shadertoy `NslGRN`, licencia CC BY-NC-SA 3.0.

---

## Notas operativas para el implementador

1. **Git:** El proyecto Fantasy_World **no es repo git todavía** (`Fantasy_World/.git` no existe). Si encuentras los pasos `git add` / `git commit` y falta `.git`, **omítelos** — el usuario decidirá cuándo inicializar el repo. Sigue el resto de pasos normalmente.

2. **No hay test suite.** Este proyecto sólo tiene `pnpm typecheck` y `pnpm build`. La verificación es **manual visual + comandos de compilación**. No introduzcas Jest/Vitest/Playwright para esta feature: sería sobre-ingeniería para un cambio de shader.

3. **Servidor de dev:** `pnpm dev` levanta Vite en `http://localhost:5173`. La app pinta el paisaje en cuanto se carga. Verifica visualmente cada cambio que afecte al render.

4. **Patrón de shader del proyecto:** todos los shaders son módulos TS (`*.frag.ts` / `*.vert.ts`) que exportan un string GLSL3 mediante `const x = /* glsl */ \`...\`;`. Inicio con `precision highp float;`. Three.js los compila con `glslVersion: THREE.GLSL3`. **No uses `.glsl` ni `.frag` puros.**

5. **Decisión arquitectónica clave:** el cubo se inserta como 4º pase al final del pipeline. Modifica el destino del pase compose (de canvas a `composeOut` FBO) y el cubo lee ese FBO como `iChannel0`. Razón: el shader del cubo, con `SHADOW_ALPHA`, hace internamente el composite final con el fondo. Detalles en spec §3.

---

## File Structure

**Files created (1):**
- `src/shaders/cube.frag.ts` — Shader fragment GLSL3 con el código de Shadertoy `NslGRN` envuelto y los defines del preset "Monolito del Valle".

**Files modified (1):**
- `src/components/ShaderLandscape.tsx` — Añadir material/escena/FBO del cubo, modificar pipeline en `useFrame`, extender resize/reset/cleanup.

**Files unchanged (verificar que no se tocan):**
- `src/App.tsx`, `src/components/Overlay.tsx`
- `src/shaders/landscape.frag.ts`, `clouds.frag.ts`, `compose.frag.ts`, `fullscreen.vert.ts`
- `src/hooks/useFps.ts`, `usePingPongFBO.ts`

---

## Task 1: Crear `src/shaders/cube.frag.ts`

**Files:**
- Create: `src/shaders/cube.frag.ts`

**Step 1: Crear el archivo con el contenido exacto siguiente**

Crea el archivo `src/shaders/cube.frag.ts` con el siguiente contenido completo. Este es el código de Shadertoy `NslGRN` envuelto en el patrón TS del proyecto, con los defines del preset "Monolito del Valle" aplicados (vs. los valores originales del autor):

- `SHADOW_ALPHA` activado
- `CAMERA_POS 0.06` activado
- `CAMERA_FAR 3.5` activado
- `ANIM_SHAPE` activado
- `ROTATION_SPEED` cambiado de `0.8999` → `0.22`
- `MOUSE_control` desactivado (comentado)

```ts
// Cube fragment shader — "Monolito del Valle" preset.
// Source: Shadertoy NslGRN by Danil (2021+), CC BY-NC-SA 3.0.
// https://www.shadertoy.com/view/NslGRN
//
// Modifications vs. the original (preset "Monolito del Valle", ver
// docs/superpowers/specs/2026-05-06-cube-monolito-valle-design.md):
//   - SHADOW_ALPHA, CAMERA_POS=0.06, CAMERA_FAR=3.5, ANIM_SHAPE: enabled
//   - ROTATION_SPEED: 0.8999 -> 0.22 (orbit lento contemplativo)
//   - MOUSE_control: disabled (orbit puramente automático)
//   - Wrapped as GLSL3 module for Three.js (precision, out var, main()).

const cubeShader = /* glsl */ `precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec3      iResolution;
uniform float     iTime;
uniform sampler2D iChannel0;

out vec4 outColor;

// =================== Shadertoy NslGRN — body start ===================
// Created by Danil (2021+) https://github.com/danilw
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
// self https://www.shadertoy.com/view/NslGRN

// --defines for "DESKTOP WALLPAPERS" that use this shader--
// preset "Monolito del Valle"
//#define NO_ALPHA
//#define BG_ALPHA
#define SHADOW_ALPHA
//#define ONLY_BOX
//#define NO_SHADOW
#define CAMERA_POS 0.06
#define ROTATION_SPEED 0.22
//#define STATIC_SHAPE 0.15
#define CAMERA_FAR 3.5
#define ANIM_SHAPE
//#define ANIM_COLOR
//#define USE_COLOR
const vec3 color_blue=vec3(0.5,0.65,0.8);
const vec3 color_red=vec3(0.99,0.2,0.1);
//#define AA_CUBE 4
//#define AA_ALL 4

// --shader code--

#define tshift 53.

// reflect back side
//#define backside_refl

// Camera with mouse — disabled in this preset
//#define MOUSE_control

#define ANGLE_loops 0

//#define DEBUG
//#define BUG

#define FDIST 0.7
#define PI 3.1415926
#define GROUNDSPACING 0.5
#define GROUNDGRID 0.05
#define BOXDIMS vec3(0.75, 0.75, 1.25)

#define IOR 1.33

mat3 rotx(float a){float s = sin(a);float c = cos(a);return mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, c, s), vec3(0.0, -s, c));  }
mat3 roty(float a){float s = sin(a);float c = cos(a);return mat3(vec3(c, 0.0, s), vec3(0.0, 1.0, 0.0), vec3(-s, 0.0, c));}
mat3 rotz(float a){float s = sin(a);float c = cos(a);return mat3(vec3(c, s, 0.0), vec3(-s, c, 0.0), vec3(0.0, 0.0, 1.0 ));}

vec3 fcos1(vec3 x) {
    vec3 w = fwidth(x);
    float lw=length(w);
    if((lw==0.)||isnan(lw)||isinf(lw)){vec3 tc=vec3(0.); for(int i=0;i<8;i++)tc+=cos(x+x*float(i-4)*(0.01*400./iResolution.y));return tc/8.;}
    return cos(x) * smoothstep(3.14 * 2.0, 0.0, w);
}

vec3 fcos2( vec3 x){return cos(x);}
vec3 fcos( vec3 x){
#ifdef AA_ALL
    return fcos2(x);
#else
    return fcos1(x);
#endif
}

vec3 getColor(vec3 p)
{
    p = abs(p);
    p *= 01.25;
    p = 0.5 * p / dot(p, p);
#ifdef ANIM_COLOR
    p+=0.072*iTime;
#endif

    float t = (0.13) * length(p);
    vec3 col = vec3(0.3, 0.4, 0.5);
    col += 0.12 * fcos(6.28318 * t * 1.0 + vec3(0.0, 0.8, 1.1));
    col += 0.11 * fcos(6.28318 * t * 3.1 + vec3(0.3, 0.4, 0.1));
    col += 0.10 * fcos(6.28318 * t * 5.1 + vec3(0.1, 0.7, 1.1));
    col += 0.10 * fcos(6.28318 * t * 17.1 + vec3(0.2, 0.6, 0.7));
    col += 0.10 * fcos(6.28318 * t * 31.1 + vec3(0.1, 0.6, 0.7));
    col += 0.10 * fcos(6.28318 * t * 65.1 + vec3(0.0, 0.5, 0.8));
    col += 0.10 * fcos(6.28318 * t * 115.1 + vec3(0.1, 0.4, 0.7));
    col += 0.10 * fcos(6.28318 * t * 265.1 + vec3(1.1, 1.4, 2.7));
    col = clamp(col, 0., 1.);
    return col;
}

void calcColor(vec3 ro, vec3 rd, vec3 nor, float d, float len, int idx, bool si, float td, out vec4 colx,
               out vec4 colsi)
{
    vec3 pos = (ro + rd * d);
#ifdef DEBUG
    float a = 1. - smoothstep(len - 0.15, len + 0.00001, length(pos));
    if (idx == 0)colx = vec4(1., 0., 0., a);
    if (idx == 1)colx = vec4(0., 1., 0., a);
    if (idx == 2)colx = vec4(0., 0., 1., a);
    if (si)
    {
        pos = (ro + rd * td);
        float ta = 1. - smoothstep(len - 0.15, len + 0.00001, length(pos));
        if (idx == 0)colsi = vec4(1., 0., 0., ta);
        if (idx == 1)colsi = vec4(0., 1., 0., ta);
        if (idx == 2)colsi = vec4(0., 0., 1., ta);
    }
#else
    float a = 1. - smoothstep(len - 0.15*0.5, len + 0.00001, length(pos));
    vec3 col = getColor(pos);
    colx = vec4(col, a);
    if (si)
    {
        pos = (ro + rd * td);
        float ta = 1. - smoothstep(len - 0.15*0.5, len + 0.00001, length(pos));
        col = getColor(pos);
        colsi = vec4(col, ta);
    }
#endif
}

bool iBilinearPatch(in vec3 ro, in vec3 rd, in vec4 ps, in vec4 ph, in float sz, out float t, out vec3 norm,
                    out bool si, out float tsi, out vec3 normsi, out float fade, out float fadesi)
{
    vec3 va = vec3(0.0, 0.0, ph.x + ph.w - ph.y - ph.z);
    vec3 vb = vec3(0.0, ps.w - ps.y, ph.z - ph.x);
    vec3 vc = vec3(ps.z - ps.x, 0.0, ph.y - ph.x);
    vec3 vd = vec3(ps.xy, ph.x);
    t = -1.;
    tsi = -1.;
    si = false;
    fade = 1.;
    fadesi = 1.;
    norm=vec3(0.,1.,0.);normsi=vec3(0.,1.,0.);

    float tmp = 1.0 / (vb.y * vc.x);
    float a = 0.0;
    float b = 0.0;
    float c = 0.0;
    float d = va.z * tmp;
    float e = 0.0;
    float f = 0.0;
    float g = (vc.z * vb.y - vd.y * va.z) * tmp;
    float h = (vb.z * vc.x - va.z * vd.x) * tmp;
    float i = -1.0;
    float j = (vd.x * vd.y * va.z + vd.z * vb.y * vc.x) * tmp - (vd.y * vb.z * vc.x + vd.x * vc.z * vb.y) * tmp;

    float p = dot(vec3(a, b, c), rd.xzy * rd.xzy) + dot(vec3(d, e, f), rd.xzy * rd.zyx);
    float q = dot(vec3(2.0, 2.0, 2.0) * ro.xzy * rd.xyz, vec3(a, b, c)) + dot(ro.xzz * rd.zxy, vec3(d, d, e)) +
              dot(ro.yyx * rd.zxy, vec3(e, f, f)) + dot(vec3(g, h, i), rd.xzy);
    float r =
        dot(vec3(a, b, c), ro.xzy * ro.xzy) + dot(vec3(d, e, f), ro.xzy * ro.zyx) + dot(vec3(g, h, i), ro.xzy) + j;

    if (abs(p) < 0.000001)
    {
        float tt = -r / q;
        if (tt <= 0.) return false;
        t = tt;
        vec3 pos = ro + t * rd;
        if(length(pos)>sz)return false;
        vec3 grad = vec3(2.0) * pos.xzy * vec3(a, b, c) + pos.zxz * vec3(d, d, e) + pos.yyx * vec3(f, e, f) + vec3(g, h, i);
        norm = -normalize(grad);
        return true;
    }
    else
    {
        float sq = q * q - 4.0 * p * r;
        if (sq < 0.0) { return false; }
        else
        {
            float s = sqrt(sq);
            float t0 = (-q + s) / (2.0 * p);
            float t1 = (-q - s) / (2.0 * p);
            float tt1 = min(t0 < 0.0 ? t1 : t0, t1 < 0.0 ? t0 : t1);
            float tt2 = max(t0 > 0.0 ? t1 : t0, t1 > 0.0 ? t0 : t1);
            float tt0 = tt1;
            if (tt0 <= 0.) return false;
            vec3 pos = ro + tt0 * rd;
            bool ru = step(sz, length(pos)) > 0.5;
            if (ru) { tt0 = tt2; pos = ro + tt0 * rd; }
            if (tt0 <= 0.) return false;
            bool ru2 = step(sz, length(pos)) > 0.5;
            if (ru2) return false;

            if ((tt2 > 0.) && ((!ru)) && !(step(sz, length(ro + tt2 * rd)) > 0.5))
            {
                si = true;
                fadesi=s;
                tsi = tt2;
                vec3 tpos = ro + tsi * rd;
                vec3 tgrad = vec3(2.0) * tpos.xzy * vec3(a, b, c) + tpos.zxz * vec3(d, d, e) +
                             tpos.yyx * vec3(f, e, f) + vec3(g, h, i);
                normsi = -normalize(tgrad);
            }

            fade=s;
            t = tt0;
            vec3 grad = vec3(2.0) * pos.xzy * vec3(a, b, c) + pos.zxz * vec3(d, d, e) + pos.yyx * vec3(f, e, f) + vec3(g, h, i);
            norm = -normalize(grad);
            return true;
        }
    }
}

float dot2( in vec3 v ) { return dot(v,v); }

float segShadow( in vec3 ro, in vec3 rd, in vec3 pa, float sh )
{
    float dm = dot(rd.yz,rd.yz);
    float k1 = (ro.x-pa.x)*dm;
    float k2 = (ro.x+pa.x)*dm;
    vec2  k5 = (ro.yz+pa.yz)*dm;
    float k3 = dot(ro.yz+pa.yz,rd.yz);
    vec2  k4 = (pa.yz+pa.yz)*rd.yz;
    vec2  k6 = (pa.yz+pa.yz)*dm;

    for( int i=0; i<4 + ANGLE_loops; i++ )
    {
        vec2  s = vec2(i&1,i>>1);
        float t = dot(s,k4) - k3;
        if( t>0.0 )
        sh = min(sh,dot2(vec3(clamp(-rd.x*t,k1,k2),k5-k6*s)+rd*t)/(t*t));
    }
    return sh;
}

float boxSoftShadow( in vec3 ro, in vec3 rd, in vec3 rad, in float sk )
{
    rd += 0.0001 * (1.0 - abs(sign(rd)));
    vec3 rdd = rd;
    vec3 roo = ro;

    vec3 m = 1.0/rdd;
    vec3 n = m*roo;
    vec3 k = abs(m)*rad;

    vec3 t1 = -n - k;
    vec3 t2 = -n + k;

    float tN = max( max( t1.x, t1.y ), t1.z );
    float tF = min( min( t2.x, t2.y ), t2.z );

    if( tN<tF && tF>0.0) return 0.0;

    float sh = 1.0;
    sh = segShadow( roo.xyz, rdd.xyz, rad.xyz, sh );
    sh = segShadow( roo.yzx, rdd.yzx, rad.yzx, sh );
    sh = segShadow( roo.zxy, rdd.zxy, rad.zxy, sh );
    sh = clamp(sk*sqrt(sh),0.0,1.0);
    return sh*sh*(3.0-2.0*sh);
}

float box(in vec3 ro, in vec3 rd, in vec3 r, out vec3 nn, bool entering)
{
    rd += 0.0001 * (1.0 - abs(sign(rd)));
    vec3 dr = 1.0 / rd;
    vec3 n = ro * dr;
    vec3 k = r * abs(dr);

    vec3 pin = -k - n;
    vec3 pout = k - n;
    float tin = max(pin.x, max(pin.y, pin.z));
    float tout = min(pout.x, min(pout.y, pout.z));
    if (tin > tout) return -1.;
    if (entering) { nn = -sign(rd) * step(pin.zxy, pin.xyz) * step(pin.yzx, pin.xyz); }
    else { nn = sign(rd) * step(pout.xyz, pout.zxy) * step(pout.xyz, pout.yzx); }
    return entering ? tin : tout;
}

vec3 bgcol(in vec3 rd)
{
    return mix(vec3(0.01), vec3(0.336, 0.458, .668), 1. - pow(abs(rd.z+0.25), 1.3));
}

vec3 background(in vec3 ro, in vec3 rd , vec3 l_dir, out float alpha)
{
#ifdef ONLY_BOX
alpha=0.;
return vec3(0.01);
#endif
    float t = (-BOXDIMS.z - ro.z) / rd.z;
    alpha=0.;
    vec3 bgc = bgcol(rd);
    if (t < 0.) return bgc;
    vec2 uv = ro.xy + t * rd.xy;
#ifdef NO_SHADOW
    float shad=1.;
#else
    float shad = boxSoftShadow((ro + t * rd), normalize(l_dir+vec3(0.,0.,1.))*rotz(PI*0.65) , BOXDIMS, 1.5);
#endif
    float aofac = smoothstep(-0.95, .75, length(abs(uv) - min(abs(uv), vec2(0.45))));
    aofac = min(aofac,smoothstep(-0.65, 1., shad));
    float lght=max(dot(normalize(ro + t * rd+vec3(0.,-0.,-5.)), normalize(l_dir-vec3(0.,0.,1.))*rotz(PI*0.65)), 0.0);
    vec3 col = mix(vec3(0.4), vec3(.71,.772,0.895), lght*lght* aofac+ 0.05) * aofac;
    alpha=1.-smoothstep(7.,10.,length(uv));
#ifdef SHADOW_ALPHA
    alpha=clamp(alpha*(1.-aofac)*1.25,0.,1.);
#endif
    return mix(col*length(col)*0.8,bgc,smoothstep(7.,10.,length(uv)));
}

#define swap(a,b) tv=a;a=b;b=tv

vec4 insides(vec3 ro, vec3 rd, vec3 nor_c, vec3 l_dir, out float tout)
{
    tout = -1.;
    vec3 trd=rd;
    vec3 col = vec3(0.);
    float pi = 3.1415926;

    if (abs(nor_c.x) > 0.5) { rd = rd.xzy * nor_c.x; ro = ro.xzy * nor_c.x; }
    else if (abs(nor_c.z) > 0.5) { l_dir *= roty(pi); rd = rd.yxz * nor_c.z; ro = ro.yxz * nor_c.z; }
    else if (abs(nor_c.y) > 0.5) { l_dir *= rotz(-pi * 0.5); rd = rd * nor_c.y; ro = ro * nor_c.y; }

#ifdef ANIM_SHAPE
    float curvature = (0.001+1.5-1.5*smoothstep(0.,8.5,mod((iTime+tshift)*0.44,20.))*(1.-smoothstep(10.,18.5,mod((iTime+tshift)*0.44,20.))));
#else
#ifdef STATIC_SHAPE
    const float curvature = STATIC_SHAPE;
#else
    const float curvature = .5;
#endif
#endif
    float bil_size = 1.;
    vec4 ps = vec4(-bil_size, -bil_size, bil_size, bil_size) * curvature;
    vec4 ph = vec4(-bil_size, bil_size, bil_size, -bil_size) * curvature;

    vec4 [3]colx=vec4[3](vec4(0.),vec4(0.),vec4(0.));
    vec3 [3]dx=vec3[3](vec3(-1.),vec3(-1.),vec3(-1.));
    vec4 [3]colxsi=vec4[3](vec4(0.),vec4(0.),vec4(0.));
    int [3]order=int[3](0,1,2);

    for (int i = 0; i < 3 + ANGLE_loops; i++)
    {
        if (abs(nor_c.x) > 0.5) { ro *= rotz(-pi * (1. / float(3))); rd *= rotz(-pi * (1. / float(3))); }
        else if (abs(nor_c.z) > 0.5) { ro *= rotz(pi * (1. / float(3))); rd *= rotz(pi * (1. / float(3))); }
        else if (abs(nor_c.y) > 0.5) { ro *= rotx(pi * (1. / float(3))); rd *= rotx(pi * (1. / float(3))); }
        vec3 normnew;
        float tnew;
        bool si;
        float tsi;
        vec3 normsi;
        float fade;
        float fadesi;

        if (iBilinearPatch(ro, rd, ps, ph, bil_size, tnew, normnew, si, tsi, normsi, fade, fadesi))
        {
            if (tnew > 0.)
            {
                vec4 tcol, tcolsi;
                calcColor(ro, rd, normnew, tnew, bil_size, i, si, tsi, tcol, tcolsi);
                if (tcol.a > 0.0)
                {
                    {
                        vec3 tvalx = vec3(tnew, float(si), tsi);
                        dx[i]=tvalx;
                    }
#ifdef DEBUG
                    colx[i]=tcol;
                    if (si)colxsi[i]=tcolsi;
#else
                    float dif = clamp(dot(normnew, l_dir), 0.0, 1.0);
                    float amb = clamp(0.5 + 0.5 * dot(normnew, l_dir), 0.0, 1.0);

                    {
#ifdef USE_COLOR
                        vec3 shad = 0.57 * color_blue * amb + 1.5*color_blue.bgr * dif;
                        const vec3 tcr = color_red;
#else
                        vec3 shad = vec3(0.32, 0.43, 0.54) * amb + vec3(1.0, 0.9, 0.7) * dif;
                        const vec3 tcr = vec3(1.,0.21,0.11);
#endif
                        float ta = clamp(length(tcol.rgb),0.,1.);
                        tcol=clamp(tcol*tcol*2.,0.,1.);
                        vec4 tvalx = vec4((tcol.rgb*shad*1.4 + 3.*(tcr*tcol.rgb)*clamp(1.-(amb+dif),0.,1.)), min(tcol.a,ta));
                        tvalx.rgb=clamp(2.*tvalx.rgb*tvalx.rgb,0.,1.);
                        tvalx*=(min(fade*5.,1.));
                        colx[i]=tvalx;
                    }
                    if (si)
                    {
                        dif = clamp(dot(normsi, l_dir), 0.0, 1.0);
                        amb = clamp(0.5 + 0.5 * dot(normsi, l_dir), 0.0, 1.0);
                        {
#ifdef USE_COLOR
                            vec3 shad = 0.57 * color_blue * amb + 1.5*color_blue.bgr * dif;
                            const vec3 tcr = color_red;
#else
                            vec3 shad = vec3(0.32, 0.43, 0.54) * amb + vec3(1.0, 0.9, 0.7) * dif;
                            const vec3 tcr = vec3(1.,0.21,0.11);
#endif
                            float ta = clamp(length(tcolsi.rgb),0.,1.);
                            tcolsi=clamp(tcolsi*tcolsi*2.,0.,1.);
                            vec4 tvalx = vec4(tcolsi.rgb * shad + 3.*(tcr*tcolsi.rgb)*clamp(1.-(amb+dif),0.,1.), min(tcolsi.a,ta));
                            tvalx.rgb=clamp(2.*tvalx.rgb*tvalx.rgb,0.,1.);
                            tvalx.rgb*=(min(fadesi*5.,1.));
                            colxsi[i]=tvalx;
                        }
                    }
#endif
                }
            }
        }
    }

    float a = 1.;
    if (dx[0].x < dx[1].x){{vec3 swap(dx[0], dx[1]);}{int swap(order[0], order[1]);}}
    if (dx[1].x < dx[2].x){{vec3 swap(dx[1], dx[2]);}{int swap(order[1], order[2]);}}
    if (dx[0].x < dx[1].x){{vec3 swap(dx[0], dx[1]);}{int swap(order[0], order[1]);}}

    tout = max(max(dx[0].x, dx[1].x), dx[2].x);

    if (dx[0].y < 0.5) { a=colx[order[0]].a; }

#if !(defined(DEBUG)&&defined(BUG))
    bool [3] rul= bool[3](
        ((dx[0].y > 0.5) && (dx[1].x <= 0.)),
        ((dx[1].y > 0.5) && (dx[0].x > dx[1].z)),
        ((dx[2].y > 0.5) && (dx[1].x > dx[2].z))
    );
    for(int k=0;k<3;k++){
        if(rul[k]){
            vec4 tcolxsi = vec4(0.);
            tcolxsi=colxsi[order[k]];
            vec4 tcolx = vec4(0.);
            tcolx=colx[order[k]];

            vec4 tvalx = mix(tcolxsi, tcolx, tcolx.a);
            colx[order[k]]=tvalx;

            vec4 tvalx2 = mix(vec4(0.), tvalx, max(tcolx.a, tcolxsi.a));
            colx[order[k]]=tvalx2;
        }
    }
#endif

    float a1 = (dx[1].y < 0.5) ? colx[order[1]].a : ((dx[1].z > dx[0].x) ? colx[order[1]].a : 1.);
    float a2 = (dx[2].y < 0.5) ? colx[order[2]].a : ((dx[2].z > dx[1].x) ? colx[order[2]].a : 1.);
    col = mix(mix(colx[order[0]].rgb, colx[order[1]].rgb, a1), colx[order[2]].rgb, a2);
    a = max(max(a, a1), a2);
    return vec4(col, a);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    float osc = 0.5;
    vec3 l_dir = normalize(vec3(0., 1., 0.));
    l_dir *= rotz(0.5);
    float mouseY = 1.0 * 0.5 * PI;
#ifdef MOUSE_control
    mouseY = (1.0 - 1.15 * iMouse.y / iResolution.y) * 0.5 * PI;
    if(iMouse.y < 1.)
#endif
#ifdef CAMERA_POS
    mouseY = PI*CAMERA_POS;
#else
    mouseY = PI*0.49 - smoothstep(0.,8.5,mod((iTime+tshift)*0.33,25.))*(1.-smoothstep(14.,24.0,mod((iTime+tshift)*0.33,25.))) * 0.55 * PI;
#endif
#ifdef ROTATION_SPEED
    float mouseX = -2.*PI-0.25*(iTime*ROTATION_SPEED+tshift);
#else
    float mouseX = -2.*PI-0.25*(iTime+tshift);
#endif
#ifdef MOUSE_control
    mouseX+=-(iMouse.x / iResolution.x) * 2. * PI;
#endif

#ifdef CAMERA_FAR
    vec3 eye = (2. + CAMERA_FAR) * vec3(cos(mouseX) * cos(mouseY), sin(mouseX) * cos(mouseY), sin(mouseY));
#else
    vec3 eye = 4. * vec3(cos(mouseX) * cos(mouseY), sin(mouseX) * cos(mouseY), sin(mouseY));
#endif
    vec3 w = normalize(-eye);
    vec3 up = vec3(0., 0., 1.);
    vec3 u = normalize(cross(w, up));
    vec3 v = cross(u, w);

    vec4 tot=vec4(0.);
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.x;

    vec3 rd = normalize(w * FDIST + uv.x * u + uv.y * v);

    vec3 ni;
    float t = box(eye, rd, BOXDIMS, ni, true);
    vec3 ro = eye + t * rd;
    vec2 coords = ro.xy * ni.z/BOXDIMS.xy + ro.yz * ni.x/BOXDIMS.yz + ro.zx * ni.y/BOXDIMS.zx;
    float fadeborders = (1.-smoothstep(0.915,1.05,abs(coords.x)))*(1.-smoothstep(0.915,1.05,abs(coords.y)));

    if (t > 0.)
    {
        float ang = -iTime * 0.33;
        vec3 col = vec3(0.);

        float R0 = (IOR - 1.) / (IOR + 1.);
        R0 *= R0;

        vec2 theta = vec2(0.);
        vec3 n = vec3(cos(theta.x) * sin(theta.y), sin(theta.x) * sin(theta.y), cos(theta.y));

        vec3 nr = n.zxy * ni.x + n.yzx * ni.y + n.xyz * ni.z;
        vec3 rdr = reflect(rd, nr);
        float talpha;
        vec3 reflcol = background(ro, rdr, l_dir,talpha);

        vec3 rd2 = refract(rd, nr, 1. / IOR);

        float accum = 1.;
        vec3 no2 = ni;
        vec3 ro_refr = ro;

        vec4 [2] colo = vec4[2](vec4(0.),vec4(0.));

        for (int j = 0; j < 2 + ANGLE_loops; j++)
        {
            float tb;
            vec2 coords2 = ro_refr.xy * no2.z + ro_refr.yz * no2.x + ro_refr.zx * no2.y;
            vec3 eye2 = vec3(coords2, -1.);
            vec3 rd2trans = rd2.yzx * no2.x + rd2.zxy * no2.y + rd2.xyz * no2.z;

            rd2trans.z = -rd2trans.z;
            vec4 internalcol = insides(eye2, rd2trans, no2, l_dir, tb);
            if (tb > 0.)
            {
                internalcol.rgb *= accum;
                colo[j]=internalcol;
            }

            if ((tb <= 0.) || (internalcol.a < 1.))
            {
                float tout = box(ro_refr, rd2, BOXDIMS, no2, false);
                no2 = n.zyx * no2.x + n.xzy * no2.y + n.yxz * no2.z;
                vec3 rout = ro_refr + tout * rd2;
                vec3 rdout = refract(rd2, -no2, IOR);
                float fresnel2 = R0 + (1. - R0) * pow(1. - dot(rdout, no2), 1.3);
                rd2 = reflect(rd2, -no2);

                ro_refr = rout;
                ro_refr.z = max(ro_refr.z, -0.999);

                accum *= fresnel2;
            }
        }
        float fresnel = R0 + (1. - R0) * pow(1. - dot(-rd, nr), 5.);
        col = mix(mix(colo[1].rgb * colo[1].a, colo[0].rgb, colo[0].a)*fadeborders, reflcol, pow(fresnel, 1.5));
        col=clamp(col,0.,1.);

        float cineshader_alpha = 0.;
        cineshader_alpha = clamp(0.15*dot(eye,ro),0.,1.);
        vec4 tcolx = vec4(col, cineshader_alpha);
#if defined(BG_ALPHA)||defined(ONLY_BOX)||defined(SHADOW_ALPHA)
        tcolx.w = 1.;
#endif
        tot += tcolx;
    }
    else
    {
        vec4 tcolx = vec4(0.);
        float alpha;
        tcolx = vec4(background(eye, rd, l_dir, alpha), 0.15);
#if defined(BG_ALPHA)||defined(ONLY_BOX)||defined(SHADOW_ALPHA)
        tcolx.w = alpha;
#endif
        tot += tcolx;
    }

    fragColor = tot;
#ifdef NO_ALPHA
    fragColor.w = 1.;
#endif
    fragColor.rgb=clamp(fragColor.rgb,0.,1.);
#if defined(BG_ALPHA)||defined(ONLY_BOX)||defined(SHADOW_ALPHA)
    fragColor.rgb=fragColor.rgb*fragColor.w+texture(iChannel0, fragCoord/iResolution.xy).rgb*(1.-fragColor.w);
#endif
}
// =================== Shadertoy NslGRN — body end ===================

void main() {
  mainImage(outColor, gl_FragCoord.xy);
}
`;

export default cubeShader;
```

Notas importantes sobre el contenido del shader:
- Eliminé los bloques de antialiasing por loop (`AA_CUBE` / `AA_ALL`) del cuerpo de `mainImage`, porque nuestros defines no los activan y dejarlos vacíos (sólo el `else` branch) simplifica el código sin cambiar comportamiento. Si en el futuro se quiere AA por loop, recuperarlo del original. La estructura actual mantiene el comportamiento idéntico al de la versión original con `AA_CUBE` y `AA_ALL` ambos sin definir.
- Eliminé referencias a `iMouse` (no se usa con `MOUSE_control` apagado).
- Eliminé referencia a `iChannel0` como background-cube en el modo `BG_ALPHA` (no aplicable con SHADOW_ALPHA).

**Step 2: Verificar typecheck**

Ejecutar:
```bash
cd /Users/agl/Documents/ALEWENCES_PROJECTS/Fantasy_World
pnpm typecheck
```

Salida esperada: el comando termina con código 0, sin errores. El shader es un string TS, así que `tsc` no inspecciona el GLSL — sólo verifica que el archivo es un módulo válido con un export por defecto.

**Step 3: Verificar build**

```bash
pnpm build
```

Salida esperada: `vite build` termina con éxito, genera `dist/`. Puede mostrar warning sobre tamaño del chunk (el shader añade ~25KB al bundle); es esperable y aceptable.

**Step 4: Commit (omitir si no hay `.git`)**

```bash
cd /Users/agl/Documents/ALEWENCES_PROJECTS/Fantasy_World
git add src/shaders/cube.frag.ts
git commit -m "feat(shaders): add cube fragment shader (Shadertoy NslGRN, preset Monolito del Valle)"
```

---

## Task 2: Añadir material, escena y FBO del cubo a `ShaderLandscape.tsx` (sin tocar render loop)

Esta tarea añade las **declaraciones** del material, la escena y el FBO `composeOut`, y extiende el cleanup. **No modifica el `useFrame`** todavía: por tanto el render visual sigue idéntico al actual. Esto deja un commit intermedio en estado funcional verificable.

**Files:**
- Modify: `src/components/ShaderLandscape.tsx`

**Step 1: Añadir el import del shader del cubo**

En la cabecera de `src/components/ShaderLandscape.tsx`, junto a los otros imports de shaders (líneas 4-7), añadir:

```tsx
import cubeFrag from '../shaders/cube.frag';
```

El bloque de imports queda:

```tsx
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import landscapeFrag from '../shaders/landscape.frag';
import cloudsFrag from '../shaders/clouds.frag';
import composeFrag from '../shaders/compose.frag';
import cubeFrag from '../shaders/cube.frag';
import fullscreenVert from '../shaders/fullscreen.vert';
import { usePingPongFBO } from '../hooks/usePingPongFBO';
```

**Step 2: Añadir la creación del FBO `composeOut`**

Justo después del bloque que crea `cloudsLo` (terminando alrededor de la línea 64 con `}, []);`), añadir un nuevo `useMemo` que crea `composeOut` a tamaño completo de canvas (sin scale factor, para preservar fidelidad post-compose como hace hoy el render directo a canvas):

```tsx
  // FBO para el resultado del compose. Antes el compose iba directo a canvas;
  // ahora va a este FBO para que el pase del cubo lo lea como iChannel0.
  // Tamaño = canvas completo en device pixels (sin RES_SCALE) — preserva la
  // misma fidelidad que el blit-a-canvas actual.
  const composeOut = useMemo(() => {
    const w = Math.max(1, Math.floor(size.width * dpr));
    const h = Math.max(1, Math.floor(size.height * dpr));
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
      composeOut.dispose();
    };
  }, [composeOut]);
```

**Step 3: Añadir el material del cubo**

Justo después del bloque `composeMat = useMemo(...)` (alrededor de la línea 125 del archivo actual, antes del `useMemo` que crea las escenas), añadir:

```tsx
  const cubeMat = useMemo(() => {
    const w = Math.max(1, Math.floor(size.width * dpr));
    const h = Math.max(1, Math.floor(size.height * dpr));
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVert,
      fragmentShader: cubeFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        // iResolution debe estar en device pixels (canvas completo). El
        // shader divide gl_FragCoord (en device pixels al renderizar a canvas)
        // entre iResolution para sus UVs internas.
        iResolution: { value: new THREE.Vector3(w, h, 1) },
        iTime: { value: 0 },
        iChannel0: { value: null },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

**Step 4: Añadir la escena del cubo al `useMemo` de escenas**

El `useMemo` actual (alrededor de la línea 128) construye `sceneMain`, `sceneClouds`, `sceneCompose`. Modificarlo para incluir `sceneCube`:

```tsx
  const { sceneMain, sceneClouds, sceneCompose, sceneCube, fsCamera, geom } = useMemo(() => {
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
    const sceneCube = new THREE.Scene();
    const meshCube = new THREE.Mesh(geom, cubeMat);
    meshCube.frustumCulled = false;
    sceneCube.add(meshCube);
    const fsCamera = new THREE.Camera();
    return { sceneMain, sceneClouds, sceneCompose, sceneCube, fsCamera, geom };
  }, [landscapeMat, cloudsMat, composeMat, cubeMat]);
```

**Step 5: Extender el cleanup de unmount**

El `useEffect` de cleanup actual (alrededor de la línea 193) llama a dispose sobre `landscapeMat`, `cloudsMat`, `composeMat`, `geom`. Añadir `cubeMat`:

```tsx
  useEffect(() => {
    return () => {
      landscapeMat.dispose();
      cloudsMat.dispose();
      composeMat.dispose();
      cubeMat.dispose();
      geom.dispose();
    };
  }, [landscapeMat, cloudsMat, composeMat, cubeMat, geom]);
```

**Step 6: Verificar typecheck**

```bash
cd /Users/agl/Documents/ALEWENCES_PROJECTS/Fantasy_World
pnpm typecheck
```

Salida esperada: 0 errores.

**Step 7: Verificar dev server (paisaje sigue idéntico)**

```bash
pnpm dev
```

Abrir `http://localhost:5173`. Verificación visual:
- El paisaje aparece exactamente igual que antes (no se ve el cubo todavía — esa parte es Task 3).
- Sin errores en consola del navegador.
- HUD con FPS visible.
- Pulsar Space pausa y reanuda. Pulsar R resetea. Pulsar H oculta HUD.

Cerrar el dev server con Ctrl+C después de verificar.

**Step 8: Commit (omitir si no hay `.git`)**

```bash
git add src/components/ShaderLandscape.tsx
git commit -m "feat(shader-landscape): declare cube material, scene and composeOut FBO"
```

---

## Task 3: Modificar el `useFrame` para integrar el cubo en el pipeline

Esta tarea modifica el render loop. Tras este commit el cubo aparece visualmente sobre el valle.

**Files:**
- Modify: `src/components/ShaderLandscape.tsx`

**Step 1: Modificar la rama no-pausada del `useFrame`**

El `useFrame` actual (líneas ~203-248) tiene la rama `if (!paused)`. Reemplazar el bloque completo de los pases (desde el comentario `// Pase 1` hasta el `mainHi.swap();` inclusive) por la versión nueva que:
1. Pase 1 (landscape) → mainHi.write **(sin cambios)**
2. Pase 2 (clouds) → cloudsLo **(sin cambios)**
3. Pase 3 (compose) → **`composeOut`** en lugar de canvas
4. Pase 4 nuevo (cube) → canvas

```tsx
    if (!paused) {
      s.time += delta;

      // Pase 1: landscape (sin nubes) → mainHi.write
      landscapeMat.uniforms.iTime.value = s.time;
      landscapeMat.uniforms.iFrame.value = s.frame;
      landscapeMat.uniforms.iChannel0.value = mainHi.read.texture;
      gl.setRenderTarget(mainHi.write);
      gl.render(sceneMain, fsCamera);

      // Pase 2: nubes a 0.5× → cloudsLo (sólo cada N frames; en los demás
      // se reutiliza la textura del último render).
      if (s.frame === 0 || s.frame % CLOUDS_FRAME_DIVIDER === 0) {
        cloudsMat.uniforms.iTime.value = s.time;
        gl.setRenderTarget(cloudsLo);
        gl.render(sceneClouds, fsCamera);
      }

      // Pase 3: compose → composeOut (FBO; antes iba directo a canvas).
      composeMat.uniforms.uMain.value = mainHi.write.texture;
      composeMat.uniforms.uClouds.value = cloudsLo.texture;
      gl.setRenderTarget(composeOut);
      gl.render(sceneCompose, fsCamera);

      // Pase 4: cubo → canvas. El shader lee composeOut como iChannel0 y,
      // en modo SHADOW_ALPHA, hace internamente cube*α + iChannel0*(1-α).
      cubeMat.uniforms.iTime.value = s.time;
      cubeMat.uniforms.iChannel0.value = composeOut.texture;
      gl.setRenderTarget(null);
      gl.render(sceneCube, fsCamera);

      mainHi.swap();
      s.frame += 1;

      if (timeRef) timeRef.current = s.time;
      if (frameRef) frameRef.current = s.frame;

      if (!s.notifiedFirst && s.frame > 1) {
        s.notifiedFirst = true;
        onFirstFrame?.();
      }
    } else {
```

**Step 2: Modificar la rama pausada del `useFrame`**

La rama `else` actual (en pausa) recompone con la última textura disponible y escribe a canvas. Hay que extenderla para que también escriba a `composeOut` y luego el cubo a canvas:

```tsx
    } else {
      // En pausa: re-componer con la última textura disponible al composeOut
      // y luego re-renderizar el cubo sobre canvas.
      composeMat.uniforms.uMain.value = mainHi.read.texture;
      composeMat.uniforms.uClouds.value = cloudsLo.texture;
      gl.setRenderTarget(composeOut);
      gl.render(sceneCompose, fsCamera);

      cubeMat.uniforms.iTime.value = s.time;
      cubeMat.uniforms.iChannel0.value = composeOut.texture;
      gl.setRenderTarget(null);
      gl.render(sceneCube, fsCamera);
    }
```

Esto preserva la sincronía cubo↔paisaje en pausa (el cubo congela en el mismo `s.time` que el paisaje).

**Step 3: Verificar typecheck**

```bash
pnpm typecheck
```

Salida esperada: 0 errores.

**Step 4: Verificar visualmente con el dev server**

```bash
pnpm dev
```

Abrir `http://localhost:5173`. Esperar 2-3 segundos a que compile el shader del cubo (puede tardar — es grande). Verificación:

- [ ] El cubo aparece centrado en pantalla, ocupando ~35% de la altura.
- [ ] El cubo gira lentamente (1 vuelta cada ~25-30 segundos).
- [ ] Tiene reflejos y capas internas con colores azul/rojo translúcidos.
- [ ] La sombra suave del cubo se proyecta sobre el paisaje (zona más oscura debajo del cubo).
- [ ] El paisaje sigue funcionando: la cámara/cordillera se ve detrás del cubo, las nubes se mueven lento.
- [ ] FPS razonable (objetivo ≥60fps a 1080p; revisar en HUD).
- [ ] Sin errores en consola del navegador. (Si hay un error de compilación de shader, el navegador lo muestra como mensaje rojo en la consola con el número de línea — útil para debug.)

**Step 5: Verificar pause y reset**

Con la app corriendo:

- [ ] Pulsar **Space**: cubo y paisaje se congelan **simultáneamente**. Volver a pulsar: ambos reanudan exactamente desde donde estaban.
- [ ] Pulsar **R**: tiempo se resetea a 0; el cubo arranca su orbit desde el principio (la rotación visible vuelve a su posición inicial).
- [ ] Pulsar **H**: HUD se oculta; el render del cubo+paisaje no cambia.

Si alguno falla, no continuar — investigar antes de seguir.

Cerrar dev server con Ctrl+C.

**Step 6: Commit (omitir si no hay `.git`)**

```bash
git add src/components/ShaderLandscape.tsx
git commit -m "feat(shader-landscape): wire cube pass into render pipeline (compose -> composeOut -> cube -> canvas)"
```

---

## Task 4: Extender resize y reset para incluir `composeOut`

Esta tarea cierra los huecos: redimensionar la ventana y pulsar R deben tratar `composeOut` igual que los otros FBOs.

**Files:**
- Modify: `src/components/ShaderLandscape.tsx`

**Step 1: Extender el handler de resize**

En el `useEffect` de resize debounced (alrededor de las líneas 153-167), añadir el resize de `composeOut` y la actualización del uniform `iResolution` del cubo:

```tsx
  useEffect(() => {
    const handle = setTimeout(() => {
      const mw = Math.max(1, Math.floor(size.width * dpr * RES_SCALE_MAIN));
      const mh = Math.max(1, Math.floor(size.height * dpr * RES_SCALE_MAIN));
      const cw = Math.max(1, Math.floor(size.width * dpr * RES_SCALE_CLOUDS));
      const ch = Math.max(1, Math.floor(size.height * dpr * RES_SCALE_CLOUDS));
      const fullW = Math.max(1, Math.floor(size.width * dpr));
      const fullH = Math.max(1, Math.floor(size.height * dpr));
      mainHi.setSize(mw, mh);
      cloudsLo.setSize(cw, ch);
      composeOut.setSize(fullW, fullH);
      landscapeMat.uniforms.iResolution.value.set(mw, mh, 1);
      cloudsMat.uniforms.iResolution.value.set(cw, ch, 1);
      cubeMat.uniforms.iResolution.value.set(fullW, fullH, 1);
      stateRef.current.frame = 0; // invalida reproyección
    }, 100);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);
```

**Step 2: Extender el handler de reset**

En el `useEffect([resetSignal])` (alrededor de las líneas 170-190), añadir el clear de `composeOut`. La estructura actual setea render target a cada FBO y limpia. Añadir `composeOut` al final, antes de restaurar `prev`:

```tsx
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
    gl.setRenderTarget(composeOut);
    gl.clear(true, true, true);
    gl.setRenderTarget(prev);
    gl.setClearColor(clearColor, clearAlpha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);
```

**Step 3: Verificar typecheck**

```bash
pnpm typecheck
```

Salida esperada: 0 errores.

**Step 4: Verificar resize**

```bash
pnpm dev
```

Con la app corriendo en el navegador:

- [ ] Redimensionar la ventana del navegador (arrastra una esquina): tras ~100ms (debounce) el render se reajusta. El cubo sigue centrado a la nueva proporción. Sin texturas estiradas. Sin crash.
- [ ] Maximizar / restaurar / cambiar a otra resolución: igual.

**Step 5: Verificar reset (segunda pasada con composeOut limpio)**

- [ ] Esperar a que el paisaje "se llene" (~5 segundos — el feedback temporal va acumulando información). Pulsar **R**: el render parpadea brevemente y arranca limpio. El cubo vuelve a la posición inicial. No queda residuo de la imagen previa en el primer frame post-reset.

Cerrar dev server.

**Step 6: Commit (omitir si no hay `.git`)**

```bash
git add src/components/ShaderLandscape.tsx
git commit -m "feat(shader-landscape): handle composeOut FBO in resize and reset paths"
```

---

## Task 5: Verificación final completa + screenshot baseline

**Files:**
- Create: `fantasy-world-v6.png` (screenshot de la app con el cubo integrado)

**Step 1: `pnpm typecheck` limpio**

```bash
cd /Users/agl/Documents/ALEWENCES_PROJECTS/Fantasy_World
pnpm typecheck
```

Esperado: 0 errores. Si aparece error nuevo (no presente en el baseline pre-feature), hay que arreglar antes de continuar.

**Step 2: `pnpm build` limpio**

```bash
pnpm build
```

Esperado: build termina con éxito. El bundle final incluye el shader del cubo (~25KB extra). Warnings esperables sobre tamaño de chunk; warnings *nuevos* sobre código TS/JS hay que investigar.

**Step 3: Ejecutar checklist visual completo**

```bash
pnpm dev
```

Ir a `http://localhost:5173`. Marcar cada item:

- [ ] La primera carga muestra el paisaje en ≤2 segundos.
- [ ] El cubo aparece en ≤3 segundos (compilación inicial del shader).
- [ ] Cubo centrado, ~35% altura, orbita lento.
- [ ] Reflejos y capas internas visibles (azul + rojo cálido).
- [ ] Sombra suave del cubo proyectada sobre el valle (oscurecimiento bajo el cubo).
- [ ] Paisaje (cordillera, nubes, atmósfera) sigue idéntico al baseline `fantasy-world-v5.png` en las zonas no cubiertas.
- [ ] FPS HUD muestra ≥60 (o el target del usuario).
- [ ] **Space** pausa cubo+paisaje sincronizados.
- [ ] **R** resetea ambos a t=0.
- [ ] **H** oculta HUD; render no cambia.
- [ ] Resize de ventana se ajusta correctamente.
- [ ] Sin warnings/errors de WebGL en consola del navegador.

Si algún item falla, **detener** y abrir investigación.

**Step 4: Capturar screenshot baseline `fantasy-world-v6.png`**

Con la app corriendo, esperar a que el paisaje y cubo estén estables (~10 segundos para que el feedback temporal del paisaje converja y el cubo esté en mid-orbit visible). Capturar la pantalla completa de la página.

En macOS:
```
Cmd + Shift + 4, luego Space, luego click en la ventana del navegador
```
o, mejor, usar el snippet del proyecto si existe (`.playwright-mcp/` indica que el usuario usa Playwright para screenshots).

Guardar el archivo como `fantasy-world-v6.png` en la raíz del proyecto:

```bash
mv ~/Desktop/screenshot.png /Users/agl/Documents/ALEWENCES_PROJECTS/Fantasy_World/fantasy-world-v6.png
```

(Ajustar la ruta de origen según donde el sistema haya dejado la captura.)

Cerrar dev server.

**Step 5: Commit final (omitir si no hay `.git`)**

```bash
cd /Users/agl/Documents/ALEWENCES_PROJECTS/Fantasy_World
git add fantasy-world-v6.png
git commit -m "docs: add v6 screenshot baseline with cube integrated"
```

---

## Mapeo plan ↔ spec

Comprobación de cobertura — cada requisito del spec debe estar implementado en alguna task de este plan:

| Spec § | Requisito | Task que lo cubre |
|---|---|---|
| §2 | Defines del preset "Monolito del Valle" | Task 1 (Step 1) |
| §3 | Pipeline de 4 pases con composeOut | Task 2 (Step 2) + Task 3 (Steps 1-2) |
| §4 | `cube.frag.ts` nuevo | Task 1 |
| §4 | Modificación de `ShaderLandscape.tsx` | Tasks 2, 3, 4 |
| §5 | Estructura del shader file | Task 1 (Step 1) |
| §6 | Render loop ordering + pause sync | Task 3 (Steps 1-2, 5) |
| §6 | Reset clear de composeOut | Task 4 (Step 2) |
| §7 | Resize incluye composeOut e iResolution | Task 4 (Step 1) |
| §7 | Cleanup dispose | Task 2 (Steps 2, 5) |
| §9 | Verificación checklist | Task 5 (Step 3) |

Si en revisión final detectas un punto del spec sin cobertura, añade una tarea aquí antes de empezar a ejecutar.

---

## Knobs de optimización (NO aplicar de entrada)

Si la verificación visual de Task 3/Task 5 muestra FPS por debajo del target, aplicar en este orden (cada uno es 1-3 líneas):

1. En `ShaderLandscape.tsx` línea ~10, bajar `MAX_DPR` de `1.5` a `1.25`.
2. Renderizar el cubo a un FBO a 0.85× DPR + un pase tiny de upscale lineal a canvas (añade un 5º pase). No incluir en este plan; pedir replanificación si hace falta.
3. Saltar el cubo en frames alternos como ya hace `clouds`. No incluir en este plan; pedir replanificación si hace falta.
4. En `cube.frag.ts`, sustituir `#define ANIM_SHAPE` por `#define STATIC_SHAPE 0.5`. Pierde la animación de forma pero recupera ~5% perf y compila más rápido.

Estos no se aplican de entrada porque la perf esperada en macOS Metal es suficiente; sólo si la verificación lo requiere.
