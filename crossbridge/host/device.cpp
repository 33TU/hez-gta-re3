#include "common.h"
#include "skeleton.h"
#include <AS3/AS3.h>
#include <stdio.h>
#include <stdlib.h>
#include <set>

// The menu submits unindexed screen-space triangle lists and fans through librw.
static void *renderState[rw::GSALPHATESTREF + 1];
static std::set<rw::Raster *> uploaded;

static void *releaseTexture(void *object, int32, int32)
{
    if(uploaded.erase((rw::Raster *)object))
        inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).releaseTexture(%0);" : : "r"(object));
    return object;
}

static void setState(int32 state, void *value)
{
    if(state >= 0 && state <= rw::GSALPHATESTREF) renderState[state] = value;
}

static void *getState(int32 state)
{
    return state >= 0 && state <= rw::GSALPHATESTREF ? renderState[state] : nil;
}

void applyGameStencil()
{
    static bool active;
    if(!renderState[rw::STENCILENABLE]){
        if(active)
            inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).resetStencil();");
        active = false;
        return;
    }
    active = true;
    uint32 cutoff = getState(rw::ALPHATESTFUNC) == (void*)rw::ALPHAGREATEREQUAL ?
        (uint32)getState(rw::ALPHATESTREF) : 0;
    inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).setStencil(%0,%1,%2,%3,%4,%5,%6,%7);"
        : : "r"(getState(rw::STENCILFUNCTION)), "r"(getState(rw::STENCILPASS)),
            "r"(getState(rw::STENCILZFAIL)), "r"(getState(rw::STENCILFAIL)),
            "r"(getState(rw::STENCILFUNCTIONREF)), "r"(getState(rw::STENCILFUNCTIONMASK)),
            "r"(getState(rw::STENCILFUNCTIONWRITEMASK)), "r"(cutoff));
}

static rw::Raster *cameraRaster(rw::Raster *raster)
{
    if(raster->type != rw::Raster::CAMERA && raster->type != rw::Raster::ZBUFFER) return nil;
    raster->width = raster->width ? raster->width : RsGlobal.maximumWidth;
    raster->height = raster->height ? raster->height : RsGlobal.maximumHeight;
    return raster;
}

static int video(rw::DeviceReq req, void *out, int32 arg)
{
    if(req == rw::DEVICEGETVIDEOMODEINFO){
        rw::VideoMode mode = {RsGlobal.maximumWidth, RsGlobal.maximumHeight, 32, 0};
        *(rw::VideoMode *)out = mode;
        return 1;
    }
    if(req == rw::DEVICEGETCURRENTVIDEOMODE) return 0;
    return rw::null::deviceSystem(req, out, arg);
}

void uploadRaster(rw::Raster *raster)
{
    if(raster && uploaded.insert(raster).second){
        rw::Image *image = raster->toImage();
        if(!image){ fprintf(stderr, "Cannot decode menu raster\n"); exit(1); }
        image->convertTo32();
        for(int y=0; y<image->height; y++){
            unsigned char *pixel = image->pixels + y*image->stride;
            for(int x=0; x<image->width; x++, pixel+=4){
                unsigned char red = pixel[0];
                pixel[0] = pixel[2];
                pixel[2] = red;
            }
        }
        inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).texture(%0,%1,%2,%3);"
            : : "r"(raster), "r"(image->pixels), "r"(image->width), "r"(image->height));
        image->destroy();
    }
}

static void draw(rw::PrimitiveType prim, void *vertices, int32 count)
{
    if(count < 3) return;
    if(prim != rw::PRIMTYPETRILIST && prim != rw::PRIMTYPETRIFAN){
        fprintf(stderr, "Unexpected menu primitive %d\n", (int)prim);
        exit(1);
    }
    rw::Raster *raster = (rw::Raster *)getState(rw::TEXTURERASTER);
    uploadRaster(raster);
    inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).primitive(%0,%1,%2,%3);"
        : : "r"(prim), "r"(vertices), "r"(count), "r"(raster));
}

void installMenuDevice()
{
    renderState[rw::STENCILFUNCTIONMASK] = renderState[rw::STENCILFUNCTIONWRITEMASK] = (void*)0xff;
    // Preserve the D3D8 palette until the Stage3D upload expands it to BGRA.
    rw::d3d::isP8supported = true;
    rw::Raster::registerPlugin(0, 0x464c5301, nil, releaseTexture, nil);
    rw::Device &dev = rw::engine->device;
    dev.setRenderState = setState;
    dev.getRenderState = getState;
    dev.system = video;
    dev.im2DRenderPrimitive = draw;
    rw::engine->driver[rw::platform]->rasterCreate = cameraRaster;
}
