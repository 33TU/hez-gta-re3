#include "common.h"
#include "main.h"
#include "Timecycle.h"
#include <AS3/AS3.h>
#include <vector>

void uploadRaster(rw::Raster *);
void applyGameStencil();
struct Vertex { rw::V3d position; rw::RGBA color; rw::TexCoords uv; };
struct Part { int first, count; Part():first(0),count(0){} };
struct Mesh { std::vector<Part> parts; };
static int meshOffset;
static Mesh *&meshFor(void *object) { return *(Mesh**)((char*)object+meshOffset); }
static void *newGeometry(void *object,int32,int32)
{
    meshFor(object)=nil;
    return object;
}
static rw::Matrix view;
static rw::Camera *camera;

static void begin(rw::Camera *cam)
{
    camera=cam;
    rw::Matrix::invert(&view,cam->getFrame()->getLTM());
}
static void setMatrix(rw::Matrix *world)
{
    rw::Matrix m;
    if(world) rw::Matrix::mult(&m,world,&view); else m=view;
    float dx=1.0f/camera->viewWindow.x, dy=1.0f/camera->viewWindow.y;
    float z=camera->farPlane/(camera->farPlane-camera->nearPlane);
    float matrix[16]={
        -dx*m.right.x,-dx*m.up.x,-dx*m.at.x,-dx*m.pos.x,
        dy*m.right.y,dy*m.up.y,dy*m.at.y,dy*m.pos.y,
        z*m.right.z,z*m.up.z,z*m.at.z,z*(m.pos.z-camera->nearPlane),
        m.right.z,m.up.z,m.at.z,m.pos.z
    };
    inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).objectMatrix(%0);" : : "r"(matrix));
}
static void *release(void *object,int32,int32)
{
    if(meshFor(object)){
        delete meshFor(object);
        inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).forget(%0);" : : "r"(object));
        meshFor(object)=nil;
    }
    return object;
}
static void vertices(rw::Geometry *g, std::vector<Vertex> &v)
{
    v.resize(g->numVertices);
    for(int i=0;i<g->numVertices;i++){
        v[i].position=g->morphTargets[0].vertices[i];
        v[i].color=g->colors?g->colors[i]:rw::makeRGBA(120,120,120,255);
        v[i].uv=g->numTexCoordSets?g->texCoords[0][i]:rw::TexCoords();
    }
}
static void makeMesh(rw::Geometry *g, Mesh &mesh)
{
    std::vector<Vertex> v;
    vertices(g,v);
    mesh.parts.resize(g->matList.numMaterials);
    for(int i=0;i<g->numTriangles;i++){
        if(g->triangles[i].matId < mesh.parts.size()) mesh.parts[g->triangles[i].matId].count++;
    }
    int at=0;
    std::vector<int> offsets(mesh.parts.size());
    for(size_t i=0;i<mesh.parts.size();i++){mesh.parts[i].first=offsets[i]=at;at+=mesh.parts[i].count*3;}
    if(!at) return;
    std::vector<uint16> indices(at);
    for(int i=0;i<g->numTriangles;i++){
        rw::Triangle &t=g->triangles[i];
        if(t.matId < mesh.parts.size())
            for(int j=0;j<3;j++) indices[offsets[t.matId]++]=t.v[j];
    }
    inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).mesh(%0,%1,%2,%3,%4);"
               : : "r"(g),"r"(&v[0]),"r"(g->numVertices),"r"(&indices[0]),"r"(at));
}
static void skinVertices(rw::Atomic *a,rw::Skin *s,rw::HAnimHierarchy *h)
{
    rw::Geometry *g=a->geometry;
    rw::Matrix inv, tmp;
    std::vector<rw::Matrix> bones(s->numBones);
    rw::Matrix::invert(&inv,a->getFrame()->getLTM());
    for(int i=0;i<s->numBones;i++){
        rw::Matrix bind=((rw::Matrix*)s->inverseMatrices)[i];
        bind.flags=0;
        if(h->flags&rw::HAnimHierarchy::LOCALSPACEMATRICES) tmp=h->matrices[i];
        else rw::Matrix::mult(&tmp,&h->matrices[i],&inv);
        rw::Matrix::mult(&bones[i],&bind,&tmp);
    }
    std::vector<Vertex> v;
    vertices(g,v);
    for(int i=0;i<g->numVertices;i++){
        CVector out(0,0,0);
        for(int j=0;j<s->numWeights;j++){
            float weight=s->weights[i*4+j];
            if(!weight)continue;
            const rw::Matrix &b=bones[s->indices[i*4+j]];
            rw::V3d p=v[i].position;
            out+=(CVector(b.right)*p.x+CVector(b.up)*p.y+CVector(b.at)*p.z+CVector(b.pos))*weight;
        }
        v[i].position=out;
    }
    inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).deform(%0,%1);" : : "r"(g),"r"(&v[0]));
}
static int drawFlags()
{
    applyGameStencil();
    return (rw::GetRenderState(rw::ZTESTENABLE)?1:0) | (rw::GetRenderState(rw::ZWRITEENABLE)?2:0) |
           (rw::GetRenderState(rw::VERTEXALPHA)?4:0) | (rw::GetRenderState(rw::SRCBLEND)<<4) |
           (rw::GetRenderState(rw::DESTBLEND)<<8);
}
static void render(rw::ObjPipeline*,rw::Atomic *a)
{
    rw::Geometry *g=a->geometry;
    if(!camera || !g || !g->numTriangles || !g->morphTargets[0].vertices) return;
    Mesh *&cached=meshFor(g);
    if(!cached){cached=new Mesh();makeMesh(g,*cached);}
    Mesh &mesh=*cached;
    rw::Skin *skin=rw::Skin::get(g);
    rw::HAnimHierarchy *hier=skin?rw::Skin::getHierarchy(a):nil;
    if(hier && hier->matrices && hier->numNodes==skin->numBones) skinVertices(a,skin,hier);
    setMatrix(a->getFrame()->getLTM());
    int flags=drawFlags();
    for(size_t i=0;i<mesh.parts.size();i++){
        Part &part=mesh.parts[i];if(!part.count) continue;
        rw::Material *m=g->matList.materials[i];
        rw::Raster *tex=m->texture?m->texture->raster:nil;
        uploadRaster(tex);
        const rw::RGBA &c=m->color;
        // librw enables vertex alpha for translucent materials on each mesh draw.
        // The game can change the material opacity between draws of the same geometry.
        int materialFlags = c.alpha < 255 ? flags | 4 : flags;
        uint32 color=c.red | (c.green<<8) | (c.blue<<16) | ((uint32)c.alpha<<24);
        int ambient=(g->flags&rw::Geometry::LIGHT)?
            (int)(255.0f*CTimeCycle::GetAmbientRed()*m->surfaceProps.ambient):0;
        inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).material(%0,%1,%2,%3,%4,%5,%6);"
                   : : "r"(g),"r"(tex),"r"(part.first),"r"(part.count),"r"(color),"r"(materialFlags),"r"(ambient));
    }
}
// RenderWare supplies screen vertices for the sky, HUD and text, and world
// vertices for water, shadows and mission markers. Both use 16-bit indices.
static void *immediateVertices;
static int immediateCount;

static void immediate(bool world,rw::PrimitiveType kind,void *v,int n,void *indices,int count)
{
    if(kind<rw::PRIMTYPETRILIST || kind>rw::PRIMTYPETRIFAN || count<3) return;
    rw::Raster *raster=(rw::Raster*)rw::GetRenderState(rw::TEXTURERASTER);
    uploadRaster(raster);
    int flags=drawFlags();
    inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).immediate(%0,%1,%2,%3,%4,%5,%6,%7);"
               : : "r"((int)world),"r"((int)kind),"r"(v),"r"(n),"r"(indices),"r"(count),"r"(raster),"r"(flags));
}
static void screenDraw(rw::PrimitiveType kind,void *v,int32 n){immediate(false,kind,v,n,nil,n);}
static void screenIndexed(rw::PrimitiveType kind,void *v,int32 n,void *ix,int32 count){immediate(false,kind,v,n,ix,count);}
static void screenTriangle(void *v,int32 n,int32 a,int32 b,int32 c)
{
    uint16 indices[3]={(uint16)a,(uint16)b,(uint16)c};
    screenIndexed(rw::PRIMTYPETRILIST,v,n,indices,3);
}
static void worldVertices(void *v,int32 n,rw::Matrix *m,uint32)
{
    immediateVertices=v;immediateCount=n;setMatrix(m);
}
static void worldDraw(rw::PrimitiveType kind){immediate(true,kind,immediateVertices,immediateCount,nil,immediateCount);}
static void worldIndexed(rw::PrimitiveType kind,void *indices,int32 n){immediate(true,kind,immediateVertices,immediateCount,indices,n);}
void installGameDevice()
{
    rw::Device &dev=rw::engine->device;
    dev.zNear=0.0f;dev.zFar=1.0f;
    dev.beginUpdate=begin;
    dev.im2DRenderPrimitive=screenDraw;
    dev.im2DRenderIndexedPrimitive=screenIndexed;
    dev.im2DRenderTriangle=screenTriangle;
    dev.im3DTransform=worldVertices;
    dev.im3DRenderPrimitive=worldDraw;
    dev.im3DRenderIndexedPrimitive=worldIndexed;
    rw::engine->driver[rw::platform]->defaultPipeline->impl.render=render;
    rw::skinGlobals.pipelines[rw::platform]->impl.render=render;
    rw::matFXGlobals.pipelines[rw::platform]->impl.render=render;
    meshOffset=rw::Geometry::registerPlugin(sizeof(Mesh*),0x464c5302,newGeometry,release,nil);
}
