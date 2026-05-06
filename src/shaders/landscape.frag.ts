// Fantasy World — fragment shader (GLSL ES 3.00)
// Adaptado del shader de paisaje "Selva / Greek" estilo Inigo Quilez.
// Mantiene el algoritmo original (FBM, raymarching de terreno y árboles,
// nubes volumétricas y reproyección temporal vía iChannel0).

const fragmentShader = /* glsl */ `precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec3  iResolution;
uniform float iTime;
uniform int   iFrame;
uniform sampler2D iChannel0;

out vec4 outColor;

#define LOWQUALITY

//==========================================================================================
// general utilities
//==========================================================================================
#define ZERO (min(iFrame,0))

float sdEllipsoidY( in vec3 p, in vec2 r )
{
    float k0 = length(p/r.xyx);
    float k1 = length(p/(r.xyx*r.xyx));
    return k0*(k0-1.0)/k1;
}

vec2 smoothstepd( float a, float b, float x)
{
    if( x<a ) return vec2( 0.0, 0.0 );
    if( x>b ) return vec2( 1.0, 0.0 );
    float ir = 1.0/(b-a);
    x = (x-a)*ir;
    return vec2( x*x*(3.0-2.0*x), 6.0*x*(1.0-x)*ir );
}

mat3 setCamera( in vec3 ro, in vec3 ta, float cr )
{
    vec3 cw = normalize(ta-ro);
    vec3 cp = vec3(sin(cr), cos(cr),0.0);
    vec3 cu = normalize( cross(cw,cp) );
    vec3 cv = normalize( cross(cu,cw) );
    return mat3( cu, cv, cw );
}

//==========================================================================================
// hashes
//==========================================================================================

float hash1( vec2 p )
{
    p  = 50.0*fract( p*0.3183099 );
    return fract( p.x*p.y*(p.x+p.y) );
}

float hash1( float n )
{
    return fract( n*17.0*fract( n*0.3183099 ) );
}

vec2 hash2( vec2 p )
{
    const vec2 k = vec2( 0.3183099, 0.3678794 );
    float n = 111.0*p.x + 113.0*p.y;
    return fract(n*fract(k*n));
}

//==========================================================================================
// noises
//==========================================================================================

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

float noise( in vec3 x )
{
    vec3 p = floor(x);
    vec3 w = fract(x);
    vec3 u = w*w*w*(w*(w*6.0-15.0)+10.0);

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

    return -1.0+2.0*(k0 + k1*u.x + k2*u.y + k3*u.z + k4*u.x*u.y + k5*u.y*u.z + k6*u.z*u.x + k7*u.x*u.y*u.z);
}

vec3 noised2d( in vec2 x )
{
    vec2 p = floor(x);
    vec2 w = fract(x);
    vec2 u = w*w*w*(w*(w*6.0-15.0)+10.0);
    vec2 du = 30.0*w*w*(w*(w-2.0)+1.0);

    float a = hash1(p+vec2(0,0));
    float b = hash1(p+vec2(1,0));
    float c = hash1(p+vec2(0,1));
    float d = hash1(p+vec2(1,1));

    float k0 = a;
    float k1 = b - a;
    float k2 = c - a;
    float k4 = a - b - c + d;

    return vec3( -1.0+2.0*(k0 + k1*u.x + k2*u.y + k4*u.x*u.y),
                 2.0*du * vec2( k1 + k4*u.y,
                            k2 + k4*u.x ) );
}

float noise2d( in vec2 x )
{
    vec2 p = floor(x);
    vec2 w = fract(x);
    vec2 u = w*w*w*(w*(w*6.0-15.0)+10.0);

    float a = hash1(p+vec2(0,0));
    float b = hash1(p+vec2(1,0));
    float c = hash1(p+vec2(0,1));
    float d = hash1(p+vec2(1,1));

    return -1.0+2.0*(a + (b-a)*u.x + (c-a)*u.y + (a - b - c + d)*u.x*u.y);
}

//==========================================================================================
// fbm constructions
//==========================================================================================

const mat3 m3  = mat3( 0.00,  0.80,  0.60,
                      -0.80,  0.36, -0.48,
                      -0.60, -0.48,  0.64 );
const mat3 m3i = mat3( 0.00, -0.80, -0.60,
                       0.80,  0.36, -0.48,
                       0.60, -0.48,  0.64 );
const mat2 m2 = mat2(  0.80,  0.60,
                      -0.60,  0.80 );
const mat2 m2i = mat2( 0.80, -0.60,
                       0.60,  0.80 );

float fbm_4( in vec2 x )
{
    float f = 1.9;
    float s = 0.55;
    float a = 0.0;
    float b = 0.5;
    for( int i=ZERO; i<4; i++ )
    {
        float n = noise2d(x);
        a += b*n;
        b *= s;
        x = f*m2*x;
    }
    return a;
}

float fbm_4_3d( in vec3 x )
{
    float f = 2.0;
    float s = 0.5;
    float a = 0.0;
    float b = 0.5;
    for( int i=ZERO; i<4; i++ )
    {
        float n = noise(x);
        a += b*n;
        b *= s;
        x = f*m3*x;
    }
    return a;
}

vec4 fbmd_7( in vec3 x )
{
    float f = 1.92;
    float s = 0.5;
    float a = 0.0;
    float b = 0.5;
    vec3  d = vec3(0.0);
    mat3  m = mat3(1.0,0.0,0.0,
                   0.0,1.0,0.0,
                   0.0,0.0,1.0);
    for( int i=ZERO; i<7; i++ )
    {
        vec4 n = noised(x);
        a += b*n.x;
        d += b*m*n.yzw;
        b *= s;
        x = f*m3*x;
        m = f*m3i*m;
    }
    return vec4( a, d );
}

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

float fbm_9( in vec2 x )
{
    float f = 1.9;
    float s = 0.55;
    float a = 0.0;
    float b = 0.5;
    for( int i=ZERO; i<9; i++ )
    {
        float n = noise2d(x);
        a += b*n;
        b *= s;
        x = f*m2*x;
    }
    return a;
}

vec3 fbmd_9( in vec2 x )
{
    float f = 1.9;
    float s = 0.55;
    float a = 0.0;
    float b = 0.5;
    vec2  d = vec2(0.0);
    mat2  m = mat2(1.0,0.0,0.0,1.0);
    for( int i=ZERO; i<9; i++ )
    {
        vec3 n = noised2d(x);
        a += b*n.x;
        d += b*m*n.yz;
        b *= s;
        x = f*m2*x;
        m = f*m2i*m;
    }
    return vec3( a, d );
}

//==========================================================================================
// global
//==========================================================================================

const vec3  kSunDir = vec3(-0.624695,0.468521,-0.624695);
const float kMaxTreeHeight = 4.8;
const float kMaxHeight = 840.0;

vec3 fog( in vec3 col, float t )
{
    vec3 ext = exp2(-t*0.00025*vec3(1,1.5,4));
    return col*ext + (1.0-ext)*vec3(0.55,0.55,0.58);
}

//==========================================================================================
// clouds
//==========================================================================================

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

float cloudsShadowFlat( in vec3 ro, in vec3 rd )
{
    float t = (1500.0-ro.y)/rd.y;
    if( t<0.0 ) return 1.0;
    vec3 pos = ro + rd*t;
    return cloudsFbm(pos).x;
}

vec4 renderClouds( in vec3 ro, in vec3 rd, float tmin, float tmax, inout float resT, in vec2 px )
{
    vec4 sum = vec4(0.0);

    float tl = (1100.0-ro.y)/rd.y;
    float th = (1900.0-ro.y)/rd.y;
    if( tl>0.0 ) tmin = max( tmin, tl ); else return sum;
    if( th>0.0 ) tmax = min( tmax, th );

    float t = tmin;
    float lastT = -1.0;
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
            if( lastT<0.0 ) lastT = t;
        }
        else
        {
            dt = abs(den)+0.2;
        }
        t += dt;
        if( sum.a>0.995 || t>tmax ) break;
    }

    if( lastT>0.0 ) resT = min(resT,lastT);

    sum.xyz += max(0.0,1.0-0.0125*thickness)*vec3(1.00,0.60,0.40)*0.3*pow(clamp(dot(kSunDir,rd),0.0,1.0),32.0);
    return clamp( sum, 0.0, 1.0 );
}

//==========================================================================================
// terrain
//==========================================================================================

vec2 terrainMap( in vec2 p )
{
    float e = fbm_9( p/2000.0 + vec2(1.0,-2.0) );
    float a = 1.0-smoothstep( 0.12, 0.13, abs(e+0.12) );
    e = 600.0*e + 600.0;
    e += 90.0*smoothstep( 552.0, 594.0, e );
    return vec2(e,a);
}

vec4 terrainMapD( in vec2 p )
{
    vec3 e = fbmd_9( p/2000.0 + vec2(1.0,-2.0) );
    e.x  = 600.0*e.x + 600.0;
    e.yz = 600.0*e.yz;

    vec2 c = smoothstepd( 550.0, 600.0, e.x );
    e.x  = e.x  + 90.0*c.x;
    e.yz = e.yz + 90.0*c.y*e.yz;

    e.yz /= 2000.0;
    return vec4( e.x, normalize( vec3(-e.y,1.0,-e.z) ) );
}

vec3 terrainNormal( in vec2 pos )
{
    return terrainMapD(pos).yzw;
}

float terrainShadow( in vec3 ro, in vec3 rd, in float mint )
{
    float res = 1.0;
    float t = mint;
#ifdef LOWQUALITY
    for( int i=ZERO; i<32; i++ )
    {
        vec3  pos = ro + t*rd;
        vec2  env = terrainMap( pos.xz );
        float hei = pos.y - env.x;
        res = min( res, 32.0*hei/t );
        if( res<0.0001 || pos.y>kMaxHeight ) break;
        t += clamp( hei, 2.0+t*0.1, 100.0 );
    }
#else
    for( int i=ZERO; i<128; i++ )
    {
        vec3  pos = ro + t*rd;
        vec2  env = terrainMap( pos.xz );
        float hei = pos.y - env.x;
        res = min( res, 32.0*hei/t );
        if( res<0.0001 || pos.y>kMaxHeight  ) break;
        t += clamp( hei, 0.5+t*0.05, 25.0 );
    }
#endif
    return clamp( res, 0.0, 1.0 );
}

vec2 raymarchTerrain( in vec3 ro, in vec3 rd, float tmin, float tmax )
{
    float tp = (kMaxHeight+kMaxTreeHeight-ro.y)/rd.y;
    if( tp>0.0 ) tmax = min( tmax, tp );

    float dis, th;
    float t2 = -1.0;
    float t = tmin;
    float ot = t;
    float odis = 0.0;
    float odis2 = 0.0;
    // Fantasy World perf: bajado 400 → 200. Con la cámara actual del valle
    // los rayos casi nunca llegan a iter > 150 antes de pegar al terreno o
    // pasarse de tmax. Si la cámara cambiara a vistas muy panorámicas, subir.
    for( int i=ZERO; i<200; i++ )
    {
        th = 0.001*t;

        vec3  pos = ro + t*rd;
        vec2  env = terrainMap( pos.xz );
        float hei = env.x;

        float dis2 = pos.y - (hei+kMaxTreeHeight*1.1);
        if( dis2<th )
        {
            if( t2<0.0 )
            {
                t2 = ot + (th-odis2)*(t-ot)/(dis2-odis2);
            }
        }
        odis2 = dis2;

        dis = pos.y - hei;
        if( dis<th ) break;

        ot = t;
        odis = dis;
        // LOD por distancia: pasos progresivamente más largos lejos. La
        // silueta queda intacta gracias a la interpolación lineal final.
        t += dis*0.8*(1.0-0.75*env.y) * (1.0 + 0.0015*t);
        if( t>tmax ) break;
    }

    if( t>tmax ) t = -1.0;
    else t = ot + (th-odis)*(t-ot)/(dis-odis);

    return vec2(t,t2);
}

//==========================================================================================
// trees
//==========================================================================================

float treesMap( in vec3 p, in float rt, out float oHei, out float oMat, out float oDis )
{
    oHei = 1.0;
    oDis = 0.0;
    oMat = 0.0;

    float base = terrainMap(p.xz).x;

    float bb = fbm_4(p.xz*0.075);

    float d = 20.0;
    vec2 n = floor( p.xz/2.0 );
    vec2 f = fract( p.xz/2.0 );
    for( int j=0; j<=1; j++ )
    for( int i=0; i<=1; i++ )
    {
        vec2  g = vec2( float(i), float(j) ) - step(f,vec2(0.5));
        vec2  o = hash2( n + g );
        vec2  v = hash2( n + g + vec2(13.1,71.7) );
        vec2  r = g - f + o;

        float height = kMaxTreeHeight * (0.4+0.8*v.x);
        float width = 0.5 + 0.2*v.x + 0.3*v.y;

        if( bb<0.0 ) width *= 0.5; else height *= 0.7;

        vec3  q = vec3(r.x,p.y-base-height*0.5,r.y);

        float k = sdEllipsoidY( q, vec2(width,0.5*height) );

        if( k<d )
        {
            d = k;
            oMat = 0.5*hash1(n+g+111.0);
            if( bb>0.0 ) oMat += 0.5;
            oHei = (p.y - base)/height;
            oHei *= 0.5 + 0.5*length(q) / width;
        }
    }

    if( rt<1200.0 )
    {
        p.y -= 600.0;
        float s = fbm_4_3d( p*3.0 );
        s = s*s;
        float att = 1.0-smoothstep(100.0,1200.0,rt);
        d += 4.0*s*att;
        oDis = s*att;
    }

    return d;
}

float treesShadow( in vec3 ro, in vec3 rd )
{
    float res = 1.0;
    float t = 0.02;
#ifdef LOWQUALITY
    for( int i=ZERO; i<64; i++ )
    {
        float kk1, kk2, kk3;
        vec3 pos = ro + rd*t;
        float h = treesMap( pos, t, kk1, kk2, kk3 );
        res = min( res, 32.0*h/t );
        t += h;
        // Sombras lejanas que ya están casi opacas no necesitan refinarse.
        if( res<0.001 || t>50.0 || (res<0.05 && t>20.0) || pos.y>kMaxHeight+kMaxTreeHeight ) break;
    }
#else
    for( int i=ZERO; i<150; i++ )
    {
        float kk1, kk2, kk3;
        float h = treesMap( ro + rd*t, t, kk1, kk2, kk3 );
        res = min( res, 32.0*h/t );
        t += h;
        if( res<0.001 || t>120.0 ) break;
    }
#endif
    return clamp( res, 0.0, 1.0 );
}

vec3 treesNormal( in vec3 pos, in float t )
{
    float kk1, kk2, kk3;
    vec3 n = vec3(0.0);
    for( int i=ZERO; i<4; i++ )
    {
        vec3 e = 0.5773*(2.0*vec3((((i+3)>>1)&1),((i>>1)&1),(i&1))-1.0);
        n += e*treesMap(pos+0.005*e, t, kk1, kk2, kk3);
    }
    return normalize(n);
}

//==========================================================================================
// sky
//==========================================================================================

vec3 renderSky( in vec3 ro, in vec3 rd )
{
    vec3 col = vec3(0.42,0.62,1.1) - rd.y*0.4;

    float t = (2500.0-ro.y)/rd.y;
    if( t>0.0 )
    {
        vec2 uv = (ro+t*rd).xz;
        float cl = fbm_9( uv*0.00104 );
        float dl = smoothstep(-0.2,0.6,cl);
        col = mix( col, vec3(1.0), 0.12*dl );
    }

    float sun = clamp( dot(kSunDir,rd), 0.0, 1.0 );
    col += 0.2*vec3(1.0,0.6,0.3)*pow( sun, 32.0 );

    return col;
}

//==========================================================================================
// main
//==========================================================================================

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 o = hash2( vec2(float(iFrame),1.0) ) - 0.5;

    vec2 p = (2.0*(fragCoord+o)-iResolution.xy)/ iResolution.y;

    float time = iTime;
    // Cámara elevada y mirando hacia abajo para ver el valle.
    // Antes: ro=(0, 401.5, 6.0), ta=(0, 403.5, -84). Quedaba atrapada
    // detrás del relieve frontal. Ahora la subimos sobre el dosel y la
    // inclinamos hacia abajo para que el ojo barra el valle abierto.
    vec3 ro = vec3(0.0, 720.0, 200.0);
    vec3 ta = vec3(0.0, 580.0, -260.0);

    // Vuelo lateral muy suave: amplitud y frecuencia reducidas para
    // minimizar la cantidad de desocclusion por frame y estabilizar la
    // acumulación temporal del shader (los árboles tienen ruido alto).
    ro.x += 80.0*sin(0.008*time);
    ta.x += 60.0*sin(0.008*time);

    mat3 ca = setCamera( ro, ta, 0.0 );
    vec3 rd = ca * normalize( vec3(p,1.5));

    float resT = 2000.0;

    vec3 col = renderSky( ro, rd );

    {
    const float tmax = 2000.0;
    int   obj = 0;
    vec2 t = raymarchTerrain( ro, rd, 15.0, tmax );
    if( t.x>0.0 )
    {
        resT = t.x;
        obj = 1;
    }

    float hei, mid, displa;

    // Cull: si el envelope está a >1500 unidades los árboles individuales no
    // se distinguen del fondo de niebla; saltamos el raymarch de copas.
    if( t.y>0.0 && t.y<1500.0 )
    {
        float tf = t.y;
        float tfMax = (t.x>0.0)?t.x:tmax;
        // Fantasy World perf: bajado 64 → 32. Los árboles cercanos se
        // alcanzan en ~10-20 iter; el cull de 1500 unidades ya descarta los
        // lejanos. Si se acerca mucho la cámara al dosel, subir a 48.
        for(int i=ZERO; i<32; i++)
        {
            vec3  pos = ro + tf*rd;
            float dis = treesMap( pos, tf, hei, mid, displa);
            if( dis<(0.000125*tf) ) break;
            tf += dis;
            if( tf>tfMax ) break;
        }
        if( tf<tfMax )
        {
            resT = tf;
            obj = 2;
        }
    }

    if( obj>0 )
    {
        vec3 pos  = ro + resT*rd;
        vec3 epos = pos + vec3(0.0,4.8,0.0);

        float sha1  = terrainShadow( pos+vec3(0,0.02,0), kSunDir, 0.02 );
        sha1 *= smoothstep(-0.325,-0.075,cloudsShadowFlat(epos, kSunDir));

        #ifndef LOWQUALITY
        float sha2  = treesShadow( pos+vec3(0,0.02,0), kSunDir );
        #endif

        vec3 tnor = terrainNormal( pos.xz );
        vec3 nor;

        vec3 speC = vec3(1.0);

        if( obj==1 )
        {
            nor = normalize( tnor + 0.8*(1.0-abs(tnor.y))*0.8*fbmd_7( (pos-vec3(0,600,0))*0.15*vec3(1.0,0.2,1.0) ).yzw );

            col = vec3(0.18,0.12,0.10)*.85;

            col = 1.0*mix( col, vec3(0.1,0.1,0.0)*0.2, smoothstep(0.7,0.9,nor.y) );
            float dif = clamp( dot( nor, kSunDir), 0.0, 1.0 );
            dif *= sha1;
            #ifndef LOWQUALITY
            dif *= sha2;
            #endif

            float bac = clamp( dot(normalize(vec3(-kSunDir.x,0.0,-kSunDir.z)),nor), 0.0, 1.0 );
            float foc = clamp( (pos.y/2.0-180.0)/130.0, 0.0,1.0);
            float dom = clamp( 0.5 + 0.5*nor.y, 0.0, 1.0 );
            vec3  lin  = 1.0*0.2*mix(0.1*vec3(0.1,0.2,0.1),vec3(0.7,0.9,1.5)*3.0,dom)*foc;
                  lin += 1.0*8.5*vec3(1.0,0.9,0.8)*dif;
                  lin += 1.0*0.27*vec3(1.1,1.0,0.9)*bac*foc;
            speC = vec3(4.0)*dif*smoothstep(20.0,0.0,abs(pos.y/2.0-310.0)-20.0);

            col *= lin;
        }
        else
        {
            vec3 gnor = treesNormal( pos, resT );

            nor = normalize( gnor + 2.0*tnor );

            float occ = clamp(hei,0.0,1.0) * pow(1.0-2.0*displa,3.0);
            float dif = clamp( 0.1 + 0.9*dot( nor, kSunDir), 0.0, 1.0 );
            dif *= sha1;
            if( dif>0.0001 )
            {
                float a = clamp( 0.5+0.5*dot(tnor,kSunDir), 0.0, 1.0);
                a = a*a;
                a *= occ;
                a *= 0.6;
                a *= smoothstep(60.0,200.0,resT);
                #ifdef LOWQUALITY
                float sha2  = treesShadow( pos+kSunDir*0.1, kSunDir );
                #endif
                dif *= a+(1.0-a)*sha2;
            }
            float dom = clamp( 0.5 + 0.5*nor.y, 0.0, 1.0 );
            float bac = clamp( 0.5+0.5*dot(normalize(vec3(-kSunDir.x,0.0,-kSunDir.z)),nor), 0.0, 1.0 );
            float fre = clamp(1.0+dot(nor,rd),0.0,1.0);

            vec3 lin  = 12.0*vec3(1.2,1.0,0.7)*dif*occ*(2.5-1.5*smoothstep(0.0,120.0,resT));
                 lin += 0.55*mix(0.1*vec3(0.1,0.2,0.0),vec3(0.6,1.0,1.0),dom*occ);
                 lin += 0.07*vec3(1.0,1.0,0.9)*bac*occ;
                 lin += 1.10*vec3(0.9,1.0,0.8)*pow(fre,5.0)*occ*(1.0-smoothstep(100.0,200.0,resT));
            speC = dif*vec3(1.0,1.1,1.5)*1.2;

            float brownAreas = fbm_4( pos.zx*0.015 );
            col = vec3(0.2,0.2,0.05);
            col = mix( col, vec3(0.32,0.2,0.05), smoothstep(0.2,0.9,fract(2.0*mid)) );
            col *= (mid<0.5)?0.65+0.35*smoothstep(300.0,600.0,resT)*smoothstep(700.0,500.0,pos.y):1.0;
            col = mix( col, vec3(0.25,0.16,0.01)*0.825, 0.7*smoothstep(0.1,0.3,brownAreas)*smoothstep(0.5,0.8,tnor.y) );
            col *= 1.0-0.5*smoothstep(400.0,700.0,pos.y);
            col *= lin;
        }

        vec3  ref = reflect(rd,nor);
        float fre = clamp(1.0+dot(nor,rd),0.0,1.0);
        float spe = 3.0*pow( clamp(dot(ref,kSunDir),0.0, 1.0), 9.0 )*(0.05+0.95*pow(fre,5.0));
        col += spe*speC;

        col = fog(col,resT);
    }
    }

    // Las nubes se renderizan ahora en clouds.frag a media resolución y se
    // componen en compose.frag. Conservamos isCloud=0 porque la reproyección
    // temporal usaba ese factor para confiar más del frame nuevo en zonas
    // nublosas; al no haber nubes aquí, esa rama queda neutral.
    float isCloud = 0.0;

    float sun = clamp( dot(kSunDir,rd), 0.0, 1.0 );
    col += 0.25*vec3(0.8,0.4,0.2)*pow( sun, 4.0 );

    col = pow( clamp(col*1.1-0.02,0.0,1.0), vec3(0.4545) );
    col = col*col*(3.0-2.0*col);
    col = pow( col, vec3(1.0,0.92,1.0) );
    col *= vec3(1.02,0.99,0.9 );
    col.z = col.z+0.1;

    // reproject from previous frame and average
    mat3x4 oldCam = mat3x4( texelFetch(iChannel0,ivec2(0,0), 0),
                            texelFetch(iChannel0,ivec2(1,0), 0),
                            texelFetch(iChannel0,ivec2(2,0), 0) );

    vec4 wpos = vec4(ro + rd*resT,1.0);
    vec3 cpos = (wpos*oldCam);
    vec2 npos = 1.5 * cpos.xy / cpos.z;
    vec2 spos = 0.5 + 0.5*npos*vec2(iResolution.y/iResolution.x,1.0);
    spos -= o/iResolution.xy;
    vec2 rpos = spos * iResolution.xy;

    if( rpos.y<1.0 && rpos.x<3.0 )
    {
    }
    else
    {
        vec3 ocol = textureLod( iChannel0, spos, 0.0 ).xyz;
        if( iFrame==0 ) ocol = col;
        // Si la posición reproyectada cae fuera del frame, no podemos fiarnos
        // del historial: usamos 100% el frame nuevo. Esto evita ghosting en
        // los bordes sin meter parpadeo en el resto (a diferencia de un check
        // por color, que hace switching binario cada frame en zonas ruidosas).
        bool offscreen = spos.x<0.0 || spos.x>1.0 || spos.y<0.0 || spos.y>1.0;
        float w = offscreen ? 1.0 : (0.1+0.8*isCloud);
        col = mix( ocol, col, w );
    }

    ivec2 ip = ivec2(fragCoord);
    if( ip.y==0 && ip.x<=2 )
    {
        fragColor = vec4( ca[ip.x], -dot(ca[ip.x],ro) );
    }
    else
    {
        fragColor = vec4( col, 1.0 );
    }
}

void main() {
    vec4 result;
    mainImage(result, gl_FragCoord.xy);
    outColor = result;
}
`;

export default fragmentShader;
