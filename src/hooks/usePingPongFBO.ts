import { useMemo, useEffect } from 'react';
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
    return { a, b, read: a, write: b };
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
