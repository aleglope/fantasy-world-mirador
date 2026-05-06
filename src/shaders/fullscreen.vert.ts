// Vertex shader passthrough para fullscreen quads (GLSL ES 3.00).
// El plano se posiciona en NDC (-1..1) directamente, sin matrices.
// Three.js inyecta `in vec3 position;` y `in vec2 uv;` cuando se usa
// ShaderMaterial con glslVersion = THREE.GLSL3.

const vertexShader = /* glsl */ `precision highp float;

out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

export default vertexShader;
