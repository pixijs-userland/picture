import {
    TextureSystem,
    FilterSystem,
    BaseTexture,
    RenderTexture,
    Filter,
    FilterState,
    CLEAR_MODES,
    State,
    Renderer
} from '@pixi/core';
import { Matrix, Rectangle } from '@pixi/math';
import { DisplayObject } from '@pixi/display';
import { BackdropFilter } from './BlendFilter';

interface IPictureRenderer extends Renderer
{
    texture: IPictureTextureSystem
}

export interface IPictureFilterSystem extends FilterSystem
{
    renderer: IPictureRenderer;
    prepareBackdrop(sourceFrame: Rectangle, flipY: Float32Array): RenderTexture;

    pushWithCheck(target: DisplayObject, filters: Array<Filter>, checkEmptyBounds?: boolean): boolean;
}

export interface IPictureTextureSystem extends TextureSystem
{
    bindForceLocation(texture: BaseTexture, location: number): void;
}

interface IPictureFilterState extends FilterState
{
    backdrop?: RenderTexture;
    backdropFlip?: Float32Array;
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
    const state: IPictureFilterState = this.statePool.pop() || new FilterState();
    const renderTextureSystem = this.renderer.renderTexture;

    let resolution = filters[0].resolution;
    let padding = filters[0].padding;
    let autoFit = filters[0].autoFit;
    let legacy = filters[0].legacy;

    for (let i = 1; i < filters.length; i++)
    {
        const filter = filters[i];

        resolution = Math.min(resolution, filter.resolution);
        padding = this.useMaxPadding
            ? Math.max(padding, filter.padding)
            : padding + filter.padding;
        autoFit = autoFit && filter.autoFit;

        legacy = legacy || filter.legacy;
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

    let canUseBackdrop = true;

    if (autoFit)
    {
        const sourceFrameProjected = (this as any).tempRect.copyFrom(renderTextureSystem.sourceFrame);

        // Project source frame into world space (if projection is applied)
        if (renderer.projection.transform)
        {
            (this as any).transformAABB(
                tempMatrix.copyFrom(renderer.projection.transform).invert(),
                sourceFrameProjected
            );
        }

        state.sourceFrame.fit(sourceFrameProjected);
    }
    else
    {
        // check if backdrop is obtainable after rejecting autoFit
        canUseBackdrop = containsRect(this.renderer.renderTexture.sourceFrame, state.sourceFrame);
    }

    if (checkEmptyBounds && state.sourceFrame.width <= 1 && state.sourceFrame.height <= 1)
    {
        filterStack.pop();
        state.clear();
        this.statePool.push(state);

        return false;
    }
    (this as any).roundFrame(
        state.sourceFrame,
        renderTextureSystem.current ? renderTextureSystem.current.resolution : renderer.resolution,
        renderTextureSystem.sourceFrame,
        renderTextureSystem.destinationFrame,
        renderer.projection.transform,
    );

    // round to whole number based on resolution
    state.sourceFrame.ceil(resolution);

    // detect backdrop uniform
    if (canUseBackdrop)
    {
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

                if (!state.backdrop)
                {
                    const flip = new Float32Array([0.0, 1.0]);

                    state.backdrop = this.prepareBackdrop(state.sourceFrame, flip);
                    state.backdropFlip = flip;
                }
            }
        }

        if (state.backdrop)
        {
            resolution = state.resolution = state.backdrop.resolution;
        }
    }

    state.renderTexture = this.getOptimalFilterTexture(state.sourceFrame.width, state.sourceFrame.height, resolution);
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

function applyFilter(state: IPictureFilterState, filter: BackdropFilter, filterManager: FilterSystem,
    input: RenderTexture, output: RenderTexture, clearMode?: CLEAR_MODES, _currentState?: FilterState)
{
    const { backdropUniformName: bName, uniforms } = filter;

    if (bName)
    {
        if (state.backdrop) uniforms[bName] = state.backdrop;
        const flip = uniforms[`${bName}_flipY`];

        if (state.backdropFlip && flip)
        {
            flip[0] = state.backdropFlip[0];
            flip[1] = state.backdropFlip[1];
        }
    }
    filter.apply(filterManager, input, output, clearMode, _currentState);
    if (bName)
    {
        uniforms[bName] = null;
    }
}

function pop(this: IPictureFilterSystem)
{
    const filterStack = this.defaultFilterStack;
    const state: IPictureFilterState = filterStack.pop();
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

    inputPixel[0] = inputSize[0] * state.resolution;
    inputPixel[1] = inputSize[1] * state.resolution;
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
        applyFilter(state, filters[0], this, state.renderTexture, lastState.renderTexture, CLEAR_MODES.BLEND, state);

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
            applyFilter(state, filters[i], this, flip, flop, CLEAR_MODES.CLEAR, state);

            const t = flip;

            flip = flop;
            flop = t;
        }

        applyFilter(state, filters[i], this, flip, lastState.renderTexture, CLEAR_MODES.BLEND, state);

        this.returnFilterTexture(flip);
        this.returnFilterTexture(flop);
    }
    if (tmpState)
    {
        filters[filterLen - 1].state = tmpState;
    }

    // release the backdrop!
    if (state.backdrop)
    {
        this.returnFilterTexture(state.backdrop);
        state.backdrop = undefined;
    }

    state.clear();
    this.statePool.push(state);
}

let hadBackbufferError = false;

/**
 * Takes a part of current render target corresponding to bounds
 * fits sourceFrame to current render target frame to evade problems
 */
function prepareBackdrop(this: IPictureFilterSystem, bounds: Rectangle, flipY: Float32Array): RenderTexture
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
