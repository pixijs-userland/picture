import { BlendFilter, IBlendShaderParts } from './BlendFilter';
import { BLEND_MODES, Filter } from '@pixi/core';

interface IBlendModeShaderParts extends IBlendShaderParts
{
    npmBlendCode?: string
}

export const BLEND_OPACITY
    = `if (b_src.a == 0.0) {
  gl_FragColor = vec4(0, 0, 0, 0);
  return;
}
if (b_dest.a == 0.0) {
  gl_FragColor = b_src;
  return;
}
vec3 base = b_dest.rgb / b_dest.a;
vec3 blend = b_src.rgb / b_src.a;
%NPM_BLEND%
// SWAP SRC WITH NPM BLEND
vec3 new_src = (1.0 - b_dest.a) * blend + b_dest.a * B;
// PORTER DUFF PMA COMPOSITION MODE
b_res.a = b_src.a + b_dest.a * (1.0-b_src.a);
b_res.rgb = b_src.a * new_src + (1.0 - b_src.a) * b_dest.rgb;
`;

export const MULTIPLY_PART: IBlendModeShaderParts = {
    blendCode: BLEND_OPACITY,
    npmBlendCode: `vec3 B = blend * base;`
};

// reverse hardlight
export const OVERLAY_PART: IBlendModeShaderParts = {
    blendCode: BLEND_OPACITY,
    npmBlendCode: `vec3 B = blendOverlay(base, blend);`,
    uniformCode: `
float finalBlendOverlay(float base, float blend)
{
    return mix((1.0-2.0*(1.0-base)*(1.0-blend)), (2.0*base*blend), step(base, 0.5));
}

vec3 blendOverlay(vec3 base, vec3 blend)
{
    return vec3(
        finalBlendOverlay(base.r,blend.r),
        finalBlendOverlay(base.g,blend.g),
        finalBlendOverlay(base.b,blend.b)
    );
}
`,
};

export const HARDLIGHT_PART: IBlendModeShaderParts = {
    blendCode: BLEND_OPACITY,
    npmBlendCode: `vec3 B = blendHardLightVec3(base, blend);`,
    uniformCode: `
float blendHardLight(float base, float blend)
{
    return mix((1.0-2.0*(1.0-base)*(1.0-blend)), 2.0*base*blend, 1.0 - step(base, 0.5));
}

vec3 blendHardLightVec3(vec3 base, vec3 blend)
{
    return vec3(blendHardLight(base.r,blend.r),blendHardLight(base.g,blend.g),blendHardLight(base.b,blend.b));
}`,
};

export const SOFTLIGHT_PART: IBlendModeShaderParts = {
    blendCode: BLEND_OPACITY,
    npmBlendCode: `vec3 B = blendSoftLightVec3(base, blend);`,
    uniformCode: `
float blendSoftLight(float base, float blend)
{
    if(blend < 0.5)
    {
        return 2.0*base*blend+base*base*(1.0-2.0*blend);
    }
    else
    {
        return sqrt(base)*(2.0*blend-1.0)+2.0*base*(1.0-blend);
    }
}

vec3 blendSoftLightVec3(vec3 base, vec3 blend)
{
    return vec3(blendSoftLight(base.r,blend.r),blendSoftLight(base.g,blend.g),blendSoftLight(base.b,blend.b));
}
`,
};

export const DARKEN_PART: IBlendModeShaderParts = {
    blendCode: BLEND_OPACITY,
    npmBlendCode: `vec3 B = blendDarkenVec3(base, blend);`,
    uniformCode: `
float blendDarken(float base, float blend)
{
    return min(blend,base);
}

vec3 blendDarkenVec3(vec3 base, vec3 blend)
{
    return vec3(blendDarken(base.r,blend.r),blendDarken(base.g,blend.g),blendDarken(base.b,blend.b));
}
`,
};

export const LIGHTEN_PART: IBlendModeShaderParts = {
    blendCode: BLEND_OPACITY,
    npmBlendCode: `vec3 B = blendLightenVec3(base, blend);`,
    uniformCode: `
float blendLighten(float base, float blend)
{
    return max(blend,base);
}

vec3 blendLightenVec3(vec3 base, vec3 blend)
{
    return vec3(blendLighten(base.r,blend.r),blendLighten(base.g,blend.g),blendLighten(base.b,blend.b));
}
`,
};

export const COLOR_DODGE_PART: IBlendModeShaderParts = {
    blendCode: BLEND_OPACITY,
    npmBlendCode: `vec3 B = blendColorDodge(base, blend);`,
    uniformCode: `
float blendColorDodge(float base, float blend) {
    return (blend==1.0)?blend:min(base/(1.0-blend),1.0);
}

vec3 blendColorDodge(vec3 base, vec3 blend) {
    return vec3(blendColorDodge(base.r,blend.r),blendColorDodge(base.g,blend.g),blendColorDodge(base.b,blend.b));
}
`,
};

export const COLOR_BURN_PART: IBlendModeShaderParts = {
    blendCode: BLEND_OPACITY,
    npmBlendCode: `vec3 B = blendColorBurn(base, blend);`,
    uniformCode: `
float colorBurn(float base, float blend)
{
    return max((1.0-((1.0-base)/blend)),0.0);
}

vec3 blendColorBurn(vec3 base, vec3 blend)
{
    return vec3(colorBurn(base.r,blend.r),colorBurn(base.g,blend.g),colorBurn(base.b,blend.b));
}
`,
};

/**
 * Maps {@link PIXI.BLEND_MODES blend modes} to {@link IBlendShaderParts.blendCode blend code}.
 *
 * This library provides blending code for {@link BLEND_MODES.MULTIPLY}, {@link BLEND_MODES.OVERLAY},
 * {@link BLEND_MODES.HARD_LIGHT}, {@link BLEND_MODES.SOFT_LIGHT}. If you add blend modes to the
 * {@link PIXI.BLEND_MODES} enumeration, you can implement them by augmenting this map with your shader
 * code.
 *
 * @type {object<string, string>}
 */
export const blendPartsArray: Array<IBlendModeShaderParts> = [];

blendPartsArray[BLEND_MODES.MULTIPLY] = MULTIPLY_PART;
blendPartsArray[BLEND_MODES.OVERLAY] = OVERLAY_PART;
blendPartsArray[BLEND_MODES.HARD_LIGHT] = HARDLIGHT_PART;
blendPartsArray[BLEND_MODES.SOFT_LIGHT] = SOFTLIGHT_PART;
blendPartsArray[BLEND_MODES.DARKEN] = DARKEN_PART;
blendPartsArray[BLEND_MODES.LIGHTEN] = LIGHTEN_PART;
blendPartsArray[BLEND_MODES.COLOR_DODGE] = COLOR_DODGE_PART;
blendPartsArray[BLEND_MODES.COLOR_BURN] = COLOR_BURN_PART;

for (const key in blendPartsArray)
{
    const part = blendPartsArray[key];

    if (part.npmBlendCode)
    {
        part.blendCode = part.blendCode.replace(`%NPM_BLEND%`, part.npmBlendCode);
    }
}

const filterCache: Array<BlendFilter> = [];
const filterCacheArray: Array<Array<BlendFilter>> = [];
const trivialBlend = new Array<boolean>(32);

trivialBlend[BLEND_MODES.NORMAL] = true;
trivialBlend[BLEND_MODES.ADD] = true;
trivialBlend[BLEND_MODES.SCREEN] = true;
trivialBlend[BLEND_MODES.DST_OUT] = true;
trivialBlend[BLEND_MODES.DST_IN] = true;
trivialBlend[BLEND_MODES.DST_OVER] = true;
trivialBlend[BLEND_MODES.DST_ATOP] = true;
trivialBlend[BLEND_MODES.SRC_OUT] = true;
trivialBlend[BLEND_MODES.SRC_IN] = true;
trivialBlend[BLEND_MODES.SRC_OVER] = true;
trivialBlend[BLEND_MODES.SRC_ATOP] = true;
trivialBlend[BLEND_MODES.SRC_OUT] = true;
trivialBlend[BLEND_MODES.SRC_IN] = true;
trivialBlend[BLEND_MODES.SRC_OVER] = true;
trivialBlend[BLEND_MODES.XOR] = true;
trivialBlend[BLEND_MODES.SUBTRACT] = true;

/**
 * Get a memoized {@link BlendFilter} for the passed blend mode. This expects {@link blendFullArray}
 * to have the blending code beforehand.
 *
 * If you changed the blending code in {@link blendFullArray}, this won't create a new blend filter
 * due to memoization!
 *
 * @param blendMode - The blend mode desired.
 */
export function getBlendFilter(blendMode: BLEND_MODES)
{
    const triv = trivialBlend[blendMode];

    if (!triv && !blendPartsArray[blendMode])
    {
        return null;
    }
    if (!filterCache[blendMode])
    {
        if (triv)
        {
            filterCache[blendMode] = (new Filter()) as any;
            filterCache[blendMode].blendMode = blendMode;
            filterCache[blendMode].trivial = true;
        }
        else
        {
            filterCache[blendMode] = new BlendFilter(blendPartsArray[blendMode]);
        }
    }

    return filterCache[blendMode];
}

/**
 * Similar to {@link getBlendFilter}, but wraps the filter in a memoized array.
 *
 * This is useful when assigning {@link PIXI.Container.filters} as a new array will not be created
 * per re-assigment.
 *
 * ```
 * import { getBlendFilter, getBlendFilterArray } from '@pixi/picture';
 *
 * // Don't do
 * displayObject.filters = [getBlendFilter(BLEND_MODES.OVERLAY)];
 *
 * // Do
 * displayObject.filters = getBlendFilterArray(BLEND_MODES.OVERLAY);
 * ```
 *
 * @param blendMode - The blend mode desired.
 */
export function getBlendFilterArray(blendMode: BLEND_MODES)
{
    if (!blendPartsArray[blendMode])
    {
        return null;
    }
    if (!filterCacheArray[blendMode])
    {
        filterCacheArray[blendMode] = [getBlendFilter(blendMode)];
    }

    return filterCacheArray[blendMode];
}
