#include "common.h"
#include "crossplatform.h"
#include "platform.h"
#include "Game.h"
#include "Frontend.h"
#include "Timer.h"
#include "ControllerConfig.h"
#include "PlayerPed.h"
#include "PlayerInfo.h"
#include "Script.h"
#include "Pools.h"
#include "Vehicle.h"
#include "Pad.h"
#include "Camera.h"
#include "Automobile.h"
#include "templates.h"
#include "CutsceneMgr.h"
#include "main.h"
#include <AS3/AS3.h>
#include <stdio.h>
void installMenuDevice();
void installGameDevice();

void configureGameAudio(const uint8 *, uint32);
int mixGameAudio();
void serviceGameAudio();

static int boot(const uint8 *bank, uint32 bytes)
{
    configureGameAudio(bank, bytes);
    printf("Opening game files\n");
    if(!RsInitialize() || !CGame::InitialiseOnceBeforeRW() || !RsRwInitialize(nil)) return 0;
    RsGlobal.width=RsGlobal.maximumWidth=640; RsGlobal.height=RsGlobal.maximumHeight=480;
    installMenuDevice();
    installGameDevice();
    rw::Texture::setLoadTextures(false);
    printf("Opening RenderWare world\n");
    if(!CGame::InitialiseRenderWare()) return 0;
    RwRect rect={0,0,640,480};
    RsEventHandler(rsCAMERASIZE,&rect);
    ControlsManager.MakeControllerActionsBlank();
    ControlsManager.InitDefaultControlConfiguration();
    ControlsManager.InitDefaultControlConfigMouse(MousePointerStateHelper.GetMouseSetUp());
    printf("Loading settings and handling\n");
    if(!CGame::InitialiseOnceAfterRW()) return 0;
    FrontEndMenuManager.m_bMenuActive=false;
    FrontEndMenuManager.m_bGameNotLoaded=false;
    FrontEndMenuManager.m_bStartUpFrontEndRequested=false;
    if(!CGame::Initialise("DATA\\GTA3.DAT")) return 0;
    gGameState=GS_PLAYING_GAME;
    printf("Retail script ready: %u mission scripts\n",CTheScripts::NumberOfMissionScripts);
    return 1;
}
// Camera motion is read each rendered frame. Buttons and wheel edges are
// consumed by re3's logical frame, which can run at a different rate.
static int mouseDX, mouseDY;
void readGameMouse(float &x, float &y)
{
    x = mouseDX;
    y = mouseDY;
    mouseDX = mouseDY = 0;
}

void readGameMouseButtons(CMouseControllerState &state)
{
    int buttons;
    inline_as3("import com.adobe.flascc.CModule; %0 = Object(CModule.vfs.console).sampleMouseButtons();" : "=r"(buttons));
    state.LMB = (buttons & 1) != 0;
    state.RMB = (buttons & 2) != 0;
    state.MMB = (buttons & 4) != 0;
    state.WHEELUP = (buttons & 8) != 0;
    state.WHEELDN = (buttons & 16) != 0;
}

static int tick(int diagnostic, int dx, int dy)
{
    mouseDX = dx;
    mouseDY = dy;
    RsEventHandler(rsIDLE,(void*)1);
    serviceGameAudio();
    static int frames;
    CPlayerPed *player=FindPlayerPed();
    bool inCar=player && player->InVehicle();
    bool cutscene=CCutsceneMgr::IsRunning();
    bool control=player && !CPad::GetPad(0)->ArePlayerControlsDisabled();
    CVehicle *nearby=nil;
    float closest=1e8f;
    if(diagnostic && player && !inCar){
        CVehiclePool *cars=CPools::GetVehiclePool();
        for(int i=0;i<cars->GetSize();i++){
            CVehicle *v=cars->GetSlot(i);
            if(v && v->GetStatus()!=STATUS_WRECKED){
                float d=(player->GetPosition()-v->GetPosition()).MagnitudeSqr();
                if(d<closest){closest=d;nearby=v;}
            }
        }
    }
    if(++frames==1 || frames%50==0){
        printf("Game frame %d time %u cutscene %d",frames,(unsigned)CTimer::GetTimeInMilliseconds(),(int)cutscene);
        if(player){CEntity *subject=inCar?(CEntity*)player->m_pMyVehicle:(CEntity*)player;
            printf(" player %.1f %.1f %.1f vehicle %d",subject->GetPosition().x,subject->GetPosition().y,
                   subject->GetPosition().z,inCar?subject->GetModelIndex():-1);}
        const CVector &front = TheCamera.GetForward();
        CPad *pad = CPad::GetPad(0);
        printf(" controls %d camera %.3f %.3f %.3f actions %d %d %d", int(control),
               front.x, front.y, front.z, !!pad->GetWeapon(), !!pad->GetTarget(),
               inCar ? !!pad->GetLookBehindForCar() : !!pad->GetLookBehindForPed());
        if(nearby)printf(" nearest car %d at %.1f %.1f %.1f",nearby->GetModelIndex(),
                         nearby->GetPosition().x,nearby->GetPosition().y,nearby->GetPosition().z);
        for(CRunningScript *s=CTheScripts::pActiveScripts;s;s=s->GetNext())
            if(s->m_bIsMissionScript || s->m_bMissionFlag) printf(" mission %.8s",s->m_abScriptName);
        printf("\n");
    }
    return (RsGlobal.quit?0:1)|(cutscene?2:0)|(inCar?4:0)|(control?8:0)|(closest<36.0f?16:0);
}
static int key(int code,int down){
    RsKeyCodes k;
    switch(code){
    case 8:k=rsBACKSP;break;case 9:k=rsTAB;break;case 13:k=rsENTER;break;case 27:k=rsESC;break;case 37:k=rsLEFT;break;case 38:k=rsUP;break;
    case 39:k=rsRIGHT;break;case 40:k=rsDOWN;break;case 16:k=rsLSHIFT;break;case 17:k=rsLCTRL;break;
    default: if(code<32 || code>90) return 0; k=(RsKeyCodes)code;break;
    }
    RsKeyStatus event={(RwInt32)k};
    RsKeyboardEventHandler(down?rsKEYDOWN:rsKEYUP,&event);
    return 0;
}
int main()
{
    inline_as3("import com.adobe.flascc.CModule; Object(CModule.vfs.console).startGame(%0,%1,%2,%3);" : : "r"(boot),"r"(tick),"r"(key),"r"(mixGameAudio));
    AS3_GoAsync();
}
