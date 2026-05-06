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
