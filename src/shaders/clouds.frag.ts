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

// MIRROR: landscape.frag.ts — m3 / m3i
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
