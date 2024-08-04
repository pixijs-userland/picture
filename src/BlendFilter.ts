import { Filter } from '@pixi/core';

/**
 * This filter uses a backdrop texture to calculate the output colors.
 *
 * A backdrop filter can use existing colors in the destination framebuffer to calculate the
 * output colors. It does not need to rely on in-built {@link PIXI.BLEND_MODES blend modes} to
 * do those calculations.
 */
export class BackdropFilter extends Filter
{
    /**
     * The name of the {@link Filter.uniforms uniform} for the backdrop texture.
     *
     * @pixi/picture's does some mixin magic to bind a copy of destination framebuffer to
     * this uniform.
     */
    backdropUniformName: string = null;

    trivial = false;

    /** If non-null, @pixi/picture will clear the filter's output framebuffer with this RGBA color. */
    clearColor: Float32Array = null;
}

/** A shader part for blending source and destination colors. */
export interface IBlendShaderParts
{
    /**
     * (optional) Code that declares any additional uniforms to be accepted by the {@link BlendFilter}.
     *
     * If you do use this, make sure these uniforms are passed in {@link IBlendShaderParts.uniforms uniforms}.
     */
    uniformCode?: string;

    /**
     * (optional) Uniforms to pass to the resulting {@link BlendFilter}.
     *
     * Make sure to declare these in {@link IBlendShaderParts.uniformCode uniformCode}.
     */
    uniforms?: { [key: string]: any };

    /**
     * The blend code that calculates the output color. The following variables are available to
     * this code:
     *
     * | Variable | Type     | Description (colors are usually PMA)       |
     * |----------|----------|--------------------------------------------|
     * | b_src    | vec4     | Source color                               |
     * | b_dst    | vec4     | Destination color                          |
     * | b_res    | vec4     | Output / result color                      |
     */
    blendCode: string;
}

const filterFrag = `
varying vec2 vTextureCoord;

uniform sampler2D uSampler;
uniform sampler2D uBackdrop;
uniform vec2 uBackdrop_flipY;

%UNIFORM_CODE%

void main(void)
{
   vec2 backdropCoord = vec2(vTextureCoord.x, uBackdrop_flipY.x + uBackdrop_flipY.y * vTextureCoord.y);
   vec4 b_src = texture2D(uSampler, vTextureCoord);
   vec4 b_dest = texture2D(uBackdrop, backdropCoord);
   vec4 b_res = b_dest;
   
   %BLEND_CODE%

   gl_FragColor = b_res;
}`;

/**
 * A blend filter is a special kind of {@link BackdropFilter} that is used to implement additional blend modes.
 *
 * The blend filter takes in a {@link IBlendShaderParts} and integrates that code in its shader template to
 * blend the source and destination colors.
 *
 * The backdrop texture uniform for blend filters is {@code "uBackdrop"}.
 */
export class BlendFilter extends BackdropFilter
{
    /** @param shaderParts - The blending code shader part. */
    constructor(shaderParts: IBlendShaderParts)
    {
        let fragCode = filterFrag;

        fragCode = fragCode.replace('%UNIFORM_CODE%', shaderParts.uniformCode || '');
        fragCode = fragCode.replace('%BLEND_CODE%', shaderParts.blendCode || '');

        super(undefined, fragCode, shaderParts.uniforms);

        this.backdropUniformName = 'uBackdrop';
    }
}
