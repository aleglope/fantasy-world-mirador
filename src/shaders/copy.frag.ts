// Copy fragment shader: muestrea uTexture y la escribe a pantalla.
// Se usa en el segundo pase de render (FBO -> canvas).

const copyShader = /* glsl */ `precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;

void main() {
  outColor = texture(uTexture, vUv);
}
`;

export default copyShader;
