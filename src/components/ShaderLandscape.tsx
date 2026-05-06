import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useControls } from 'leva';
import landscapeFrag from '../shaders/landscape.frag';
import cloudsFrag from '../shaders/clouds.frag';
import composeFrag from '../shaders/compose.frag';
import cubeFrag from '../shaders/cube.frag';
import fullscreenVert from '../shaders/fullscreen.vert';
import { usePingPongFBO } from '../hooks/usePingPongFBO';

// Performance tuning (Fantasy World):
// dprCap y resScale ahora vienen como props desde App.tsx (controlados por
// leva en runtime). Aquí mantenemos solo el factor de nubes que casi nunca
// merece tunear porque las nubes ya son borrosas a media resolución.
const RES_SCALE_CLOUDS = 0.5;
// Alternate-frame clouds: cada cuántos frames se vuelve a renderizar el FBO
// de nubes. 2 = se actualiza la mitad de veces (~30% extra de FPS), el frame
// intermedio reusa la textura. La cámara es lenta, no hay shimmer perceptible.
const CLOUDS_FRAME_DIVIDER = 2;

interface Props {
  paused: boolean;
  resetSignal: number;
  onFirstFrame?: () => void;
  timeRef?: { current: number };
  frameRef?: { current: number };
  // Performance knobs controlados por leva en App.tsx.
  dprCap: number;
  resScale: number;
}

export function ShaderLandscape({
  paused,
  resetSignal,
  onFirstFrame,
  timeRef,
  frameRef,
  dprCap,
  resScale,
}: Props) {
  const { gl, size } = useThree();

  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  const initMainW = Math.max(1, Math.floor(size.width * dpr * resScale));
  const initMainH = Math.max(1, Math.floor(size.height * dpr * resScale));

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
        // Tunables del monolito (sincronizados con leva en useFrame).
        uMonoOffsetY: { value: -0.13 },
        uMonoScaleDesktop: { value: 0.15 },
        uMonoScaleMobile: { value: 0.50 },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Controles leva para ajustar el monolito en vivo. Los valores se persisten
  // en localStorage automáticamente. Una vez fijos los valores deseados, se
  // pueden hardcodear en cube.frag.ts y eliminar leva.
  const { uMonoOffsetY, uMonoScaleDesktop, uMonoScaleMobile } = useControls(
    'Monolito',
    {
      uMonoOffsetY: {
        label: 'offset Y',
        value: -0.13,
        min: -0.5,
        max: 0.5,
        step: 0.005,
      },
      uMonoScaleDesktop: {
        label: 'scale desktop',
        value: 0.15,
        min: 0.05,
        max: 1.0,
        step: 0.01,
      },
      uMonoScaleMobile: {
        label: 'scale móvil',
        value: 0.50,
        min: 0.05,
        max: 1.0,
        step: 0.01,
      },
    },
  );

  // Cuatro escenas + cámara ortográfica trivial
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

  const stateRef = useRef({
    time: 0,
    frame: 0,
    notifiedFirst: false,
  });

  // Resize debounced. También se ejecuta cuando cambian los controles leva
  // de performance (dprCap/resScale): redimensiona los FBOs al instante.
  useEffect(() => {
    const handle = setTimeout(() => {
      const mw = Math.max(1, Math.floor(size.width * dpr * resScale));
      const mh = Math.max(1, Math.floor(size.height * dpr * resScale));
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
  }, [size.width, size.height, dpr, resScale]);

  // Reset / mount / HMR re-mount: limpia FBOs y contadores.
  // Sin este path corriendo en mount, un HMR-remount crearía FBOs nuevos sin
  // inicializar (basura GPU) y el feedback temporal del landscape leería esa
  // basura → paisaje caótico/negro tras editar el shader.
  useEffect(() => {
    stateRef.current.frame = 0;
    stateRef.current.time = 0;
    stateRef.current.notifiedFirst = false;
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

  // Cleanup
  useEffect(() => {
    return () => {
      landscapeMat.dispose();
      cloudsMat.dispose();
      composeMat.dispose();
      cubeMat.dispose();
      geom.dispose();
    };
  }, [landscapeMat, cloudsMat, composeMat, cubeMat, geom]);

  // Render loop manual: 4 pases por frame
  useFrame((_, delta) => {
    const s = stateRef.current;

    // Sync uniforms del monolito con leva (siempre, también en pausa, para
    // que los cambios del panel se reflejen al instante).
    cubeMat.uniforms.uMonoOffsetY.value = uMonoOffsetY;
    cubeMat.uniforms.uMonoScaleDesktop.value = uMonoScaleDesktop;
    cubeMat.uniforms.uMonoScaleMobile.value = uMonoScaleMobile;

    if (!paused) {
      s.time += delta;

      // Limpiar el ping-pong en el primer frame de la vida del componente.
      // Sin esto, mainHi.read tiene basura GPU sin inicializar y el primer
      // pase del landscape la lee como iChannel0 (feedback temporal) → halo
      // brillante en los primeros 2-3 frames hasta que el feedback estabiliza.
      // El reset por tecla R también triggerea este path (pone s.frame=0).
      if (s.frame === 0) {
        const prevTarget = gl.getRenderTarget();
        const prevColor = new THREE.Color();
        gl.getClearColor(prevColor);
        const prevAlpha = gl.getClearAlpha();
        gl.setClearColor(0x000000, 0);
        gl.setRenderTarget(mainHi.read);
        gl.clear(true, true, true);
        gl.setRenderTarget(mainHi.write);
        gl.clear(true, true, true);
        gl.setRenderTarget(prevTarget);
        gl.setClearColor(prevColor, prevAlpha);
      }

      // Pase 1: landscape (sin nubes) → mainHi.write
      landscapeMat.uniforms.iTime.value = s.time;
      landscapeMat.uniforms.iFrame.value = s.frame;
      landscapeMat.uniforms.iChannel0.value = mainHi.read.texture;
      gl.setRenderTarget(mainHi.write);
      gl.render(sceneMain, fsCamera);

      // Pase 2: nubes a 0.5× → cloudsLo (sólo cada N frames; en los demás
      // se reutiliza la textura del último render). El primer frame siempre
      // se renderiza para que cloudsLo no esté vacío al componer.
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
  }, 1);

  return null;
}
