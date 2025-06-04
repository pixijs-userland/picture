import {
    TextureSystem,
    FilterSystem,
    BaseTexture,
    RenderTexture,
    Filter,
    FilterState,
    CLEAR_MODES,
    MSAA_QUALITY,
    State
} from '@pixi/core';
import { Matrix, Rectangle } from '@pixi/math';
import { DisplayObject } from '@pixi/display';
import { BackdropFilter } from './BlendFilter';

export interface IPictureFilterSystem extends FilterSystem
{
    prepareBackdrop(sourceFrame: Rectangle, flipY: Float32Array): RenderTexture;

    pushWithCheck(target: DisplayObject, filters: Array<Filter>, checkEmptyBounds?: boolean): boolean;
}

export interface IPictureTextureSystem extends TextureSystem
{
    bindForceLocation(texture: BaseTexture, location: number): void;
}

function containsRect(rectOut: Rectangle, rectIn: Rectangle): boolean
{
    const r1 = rectIn.x + rectIn.width;
    const b1 = rectIn.y + rectIn.height;
    const r2 = rectOut.x + rectOut.width;
    const b2 = rectOut.y + rectOut.height;

    return (rectIn.x >= rectOut.x)
        && (rectIn.x <= r2)
        && (rectIn.y >= rectOut.y)
        && (rectIn.y <= b2)
        && (r1 >= rectOut.x)
        && (r1 <= r2)
        && (b1 >= rectOut.y)
        && (b1 <= b2);
}

function bindForceLocation(this: IPictureTextureSystem, texture: BaseTexture, location = 0)
{
    const { gl } = this;

    if (this.currentLocation !== location)
    {
        this.currentLocation = location;
        gl.activeTexture(gl.TEXTURE0 + location);
    }
    this.bind(texture, location);
}

const tempMatrix = new Matrix();

function pushWithCheck(this: IPictureFilterSystem,
    target: DisplayObject, filters: Array<BackdropFilter>, checkEmptyBounds = true)
{
    const renderer = this.renderer;
    const filterStack = this.defaultFilterStack;
    const state = this.statePool.pop() || new FilterState();
    const renderTextureSystem = renderer.renderTexture;
    let currentResolution: number;
    let currentMultisample: MSAA_QUALITY;

    if (renderTextureSystem.current)
    {
        const renderTexture = renderTextureSystem.current;

        currentResolution = renderTexture.resolution;
        currentMultisample = renderTexture.multisample;
    }
    else
    {
        currentResolution = renderer.resolution;
        currentMultisample = renderer.multisample;
    }

    let resolution = filters[0].resolution || currentResolution;
    let multisample = filters[0].multisample ?? currentMultisample;

    let padding = filters[0].padding;
    let autoFit = filters[0].autoFit;
    // We don't know whether it's a legacy filter until it was bound for the first time,
    // therefore we have to assume that it is if legacy is undefined.
    let legacy = filters[0].legacy ?? true;

    for (let i = 1; i < filters.length; i++)
    {
        const filter = filters[i];

        // let's use the lowest resolution
        resolution = Math.min(resolution, filter.resolution || currentResolution);
        // let's use the lowest number of samples
        multisample = Math.min(multisample, filter.multisample ?? currentMultisample);
        // figure out the padding required for filters
        padding = this.useMaxPadding
            // old behavior: use largest amount of padding!
            ? Math.max(padding, filter.padding)
            // new behavior: sum the padding
            : padding + filter.padding;
        // only auto fit if all filters are autofit
        autoFit = autoFit && filter.autoFit;

        legacy = legacy || (filter.legacy ?? true);
    }

    if (filterStack.length === 1)
    {
        this.defaultFilterStack[0].renderTexture = renderTextureSystem.current;
    }

    filterStack.push(state);

    state.resolution = resolution;

    state.legacy = legacy;

    state.target = target;
    state.sourceFrame.copyFrom(target.filterArea || target.getBounds(true));

    state.sourceFrame.pad(padding);

    // TODO: use backdrop in case of multisample, only after blit()
    let canUseBackdrop = !currentMultisample;

    const sourceFrameProjected = (this as any).tempRect.copyFrom(renderTextureSystem.sourceFrame);

    // Project source frame into world space (if projection is applied)
    if (renderer.projection.transform)
    {
        (this as any).transformAABB?.(
            tempMatrix.copyFrom(renderer.projection.transform).invert(),
            sourceFrameProjected
        );
    }

    if (autoFit)
    {
        state.sourceFrame.fit(sourceFrameProjected);

        if (state.sourceFrame.width <= 0 || state.sourceFrame.height <= 0)
        {
            state.sourceFrame.width = 0;
            state.sourceFrame.height = 0;
        }
    }
    else
    {
        // check if backdrop is obtainable after rejecting autoFit
        canUseBackdrop = containsRect(this.renderer.renderTexture.sourceFrame, state.sourceFrame);

        if (!state.sourceFrame.intersects(sourceFrameProjected))
        {
            state.sourceFrame.width = 0;
            state.sourceFrame.height = 0;
        }
    }

    // Round sourceFrame in screen space based on render-texture.
    (this as any).roundFrame(
        state.sourceFrame,
        renderTextureSystem.current ? renderTextureSystem.current.resolution : renderer.resolution,
        renderTextureSystem.sourceFrame,
        renderTextureSystem.destinationFrame,
        renderer.projection.transform,
    );

    if (checkEmptyBounds && state.sourceFrame.width <= 1 && state.sourceFrame.height <= 1)
    {
        filterStack.pop();
        state.clear();
        this.statePool.push(state);

        return false;
    }

    // detect backdrop uniform
    if (canUseBackdrop)
    {
        let backdrop = null;
        let backdropFlip = null;

        for (let i = 0; i < filters.length; i++)
        {
            const bName = filters[i].backdropUniformName;

            if (bName)
            {
                const { uniforms } = filters[i];

                if (!uniforms[`${bName}_flipY`])
                {
                    uniforms[`${bName}_flipY`] = new Float32Array([0.0, 1.0]);
                }
                const flip = uniforms[`${bName}_flipY`];

                if (backdrop === null)
                {
                    backdrop = this.prepareBackdrop(state.sourceFrame, flip);
                    backdropFlip = flip;
                }
                else
                {
                    flip[0] = backdropFlip[0];
                    flip[1] = backdropFlip[1];
                }

                uniforms[bName] = backdrop;
                if (backdrop)
                {
                    filters[i]._backdropActive = true;
                }
            }
        }

        if (backdrop)
        {
            resolution = state.resolution = backdrop.resolution;
        }
    }

    state.renderTexture = this.getOptimalFilterTexture(state.sourceFrame.width, state.sourceFrame.height,
        resolution, multisample);
    state.filters = filters;

    state.destinationFrame.width = state.renderTexture.width;
    state.destinationFrame.height = state.renderTexture.height;

    const destinationFrame = (this as any).tempRect;

    destinationFrame.x = 0;
    destinationFrame.y = 0;
    destinationFrame.width = state.sourceFrame.width;
    destinationFrame.height = state.sourceFrame.height;

    state.renderTexture.filterFrame = state.sourceFrame;
    state.bindingSourceFrame.copyFrom(renderTextureSystem.sourceFrame);
    state.bindingDestinationFrame.copyFrom(renderTextureSystem.destinationFrame);

    state.transform = renderer.projection.transform;
    renderer.projection.transform = null;
    renderTextureSystem.bind(state.renderTexture, state.sourceFrame, destinationFrame);

    const cc = filters[filters.length - 1].clearColor as any;

    if (cc)
    {
        // take clear color from filter, it helps for advanced DisplacementFilter
        renderer.framebuffer.clear(cc[0], cc[1], cc[2], cc[3]);
    }
    else
    {
        renderer.framebuffer.clear(0, 0, 0, 0);
    }

    return true;
}

function push(this: IPictureFilterSystem,
    target: DisplayObject, filters: Array<Filter>)
{
    return this.pushWithCheck(target, filters, false);
}

function pop(this: IPictureFilterSystem)
{
    const filterStack = this.defaultFilterStack;
    const state = filterStack.pop();
    const filters = state.filters as Array<BackdropFilter>;

    this.activeState = state;

    const globalUniforms = this.globalUniforms.uniforms;

    globalUniforms.outputFrame = state.sourceFrame;
    globalUniforms.resolution = state.resolution;

    const inputSize = globalUniforms.inputSize;
    const inputPixel = globalUniforms.inputPixel;
    const inputClamp = globalUniforms.inputClamp;

    inputSize[0] = state.destinationFrame.width;
    inputSize[1] = state.destinationFrame.height;
    inputSize[2] = 1.0 / inputSize[0];
    inputSize[3] = 1.0 / inputSize[1];

    inputPixel[0] = Math.round(inputSize[0] * state.resolution);
    inputPixel[1] = Math.round(inputSize[1] * state.resolution);
    inputPixel[2] = 1.0 / inputPixel[0];
    inputPixel[3] = 1.0 / inputPixel[1];

    inputClamp[0] = 0.5 * inputPixel[2];
    inputClamp[1] = 0.5 * inputPixel[3];
    inputClamp[2] = (state.sourceFrame.width * inputSize[2]) - (0.5 * inputPixel[2]);
    inputClamp[3] = (state.sourceFrame.height * inputSize[3]) - (0.5 * inputPixel[3]);

    // only update the rect if its legacy..
    if (state.legacy)
    {
        const filterArea = globalUniforms.filterArea;

        filterArea[0] = state.destinationFrame.width;
        filterArea[1] = state.destinationFrame.height;
        filterArea[2] = state.sourceFrame.x;
        filterArea[3] = state.sourceFrame.y;

        globalUniforms.filterClamp = globalUniforms.inputClamp;
    }

    this.globalUniforms.update();

    const lastState = filterStack[filterStack.length - 1];

    if (state.renderTexture.framebuffer.multisample > 1)
    {
        this.renderer.framebuffer.blit();
    }

    let filterLen = filters.length;
    let tmpState: State = null;

    if (filterLen >= 2 && filters[filterLen - 1].trivial)
    {
        tmpState = filters[filterLen - 2].state;
        filters[filterLen - 2].state = filters[filterLen - 1].state;
        filterLen--;
    }

    if (filterLen === 1)
    {
        filters[0].apply(this, state.renderTexture, lastState.renderTexture, CLEAR_MODES.BLEND, state);

        this.returnFilterTexture(state.renderTexture);
    }
    else
    {
        let flip = state.renderTexture;
        let flop = this.getOptimalFilterTexture(
            flip.width,
            flip.height,
            state.resolution
        );

        flop.filterFrame = flip.filterFrame;

        let i = 0;

        for (i = 0; i < filterLen - 1; ++i)
        {
            if (i === 1 && state.multisample > 1)
            {
                flop = this.getOptimalFilterTexture(
                    flip.width,
                    flip.height,
                    state.resolution
                );

                flop.filterFrame = flip.filterFrame;
            }

            filters[i].apply(this, flip, flop, CLEAR_MODES.CLEAR, state);

            const t = flip;

            flip = flop;
            flop = t;
        }

        filters[i].apply(this, flip, lastState.renderTexture, CLEAR_MODES.BLEND, state);

        if (i > 1 && state.multisample > 1)
        {
            this.returnFilterTexture(state.renderTexture);
        }

        this.returnFilterTexture(flip);
        this.returnFilterTexture(flop);
    }
    if (tmpState)
    {
        filters[filterLen - 1].state = tmpState;
    }

    // release the backdrop!
    let backdropFree = false;

    for (let i = 0; i < filters.length; i++)
    {
        if (filters[i]._backdropActive)
        {
            const bName = filters[i].backdropUniformName;

            if (!backdropFree)
            {
                this.returnFilterTexture(filters[i].uniforms[bName]);
                backdropFree = true;
            }
            filters[i].uniforms[bName] = null;
            filters[i]._backdropActive = false;
        }
    }

    // lastState.renderTexture is blitted when lastState is popped

    state.clear();
    this.statePool.push(state);
}

let hadBackbufferError = false;

/**
 * Takes a part of current render target corresponding to bounds
 * fits sourceFrame to current render target frame to evade problems
 */
function prepareBackdrop(bounds: Rectangle, flipY: Float32Array): RenderTexture
{
    const renderer = this.renderer;
    const renderTarget = renderer.renderTexture.current;
    const fr = this.renderer.renderTexture.sourceFrame;
    const tf = renderer.projection.transform || Matrix.IDENTITY;

    // TODO: take non-standart sourceFrame/destinationFrame into account, all according to ShukantPal refactoring

    let resolution = 1;

    if (renderTarget)
    {
        resolution = renderTarget.baseTexture.resolution;
        flipY[1] = 1.0;
    }
    else
    {
        if (this.renderer.background.alpha >= 1)
        {
            if (!hadBackbufferError)
            {
                hadBackbufferError = true;
                console.warn('pixi-picture: you are trying to use Blend Filter on main framebuffer!');
                console.warn('pixi-picture: please set backgroundAlpha=0 in renderer creation params');
            }

            return null;
        }
        resolution = renderer.resolution;
        flipY[1] = -1.0;
    }

    // bounds.fit(fr);

    const x = Math.round((bounds.x - fr.x + tf.tx) * resolution);
    const dy = bounds.y - fr.y + tf.ty;
    const y = Math.round((flipY[1] < 0.0 ? fr.height - (dy + bounds.height) : dy) * resolution);
    const w = Math.round(bounds.width * resolution);
    const h = Math.round(bounds.height * resolution);

    const gl = renderer.gl;
    const rt = this.getOptimalFilterTexture(w, h, 1);

    if (flipY[1] < 0)
    {
        flipY[0] = h / rt.height;
    }
    else
    {
        flipY[0] = 0;
    }

    rt.filterFrame = fr;
    rt.setResolution(resolution);
    renderer.texture.bindForceLocation(rt.baseTexture, 0);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, x, y, w, h);

    return rt;
}

export function applyMixins()
{
    (TextureSystem as any).prototype.bindForceLocation = bindForceLocation;
    (FilterSystem as any).prototype.push = push;
    (FilterSystem as any).prototype.pushWithCheck = pushWithCheck as any;
    (FilterSystem as any).prototype.pop = pop;
    (FilterSystem as any).prototype.prepareBackdrop = prepareBackdrop;
}
