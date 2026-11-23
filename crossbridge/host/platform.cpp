// Platform services for the CrossBridge game loop.
#include "common.h"
#include "crossplatform.h"
#include "platform.h"
#include "FileMgr.h"
#include "PCSave.h"
#include <AS3/AS3.h>
#include <stdio.h>
#include <sys/stat.h>

RwUInt32 gGameState = GS_START_UP;
long _dwOperatingSystemVersion = 0;
// The host has no physical-RAM query. This budget selects re3's 50 MiB streaming floor.
size_t _dwMemAvailPhys = 64u * 1024 * 1024;

const char *_psGetUserFilesFolder() {
    static const char path[] = "/USERFILES";
    mkdir(path, 0755);
    return path;
}
void _InputTranslateShiftKeyUpDown(RsKeyCodes *) {}

double psTimer() {
    int milliseconds;
    inline_as3("import flash.utils.getTimer; %0 = getTimer();" : "=r"(milliseconds));
    return (uint32)milliseconds;
}

RwBool psInitialize() {
    CFileMgr::Initialise();
    C_PcSave::SetSaveDirectory(_psGetUserFilesFolder());
    return TRUE;
}
void psTerminate() {}
RwMemoryFunctions *psGetMemoryFunctions() { return nil; }
RwBool psInstallFileSystem() { return TRUE; } // CrossBridge's libc already uses the VFS.
RwBool psNativeTextureSupport() { return TRUE; }
RwBool psSelectDevice() { return TRUE; } // The linked device is librw's null renderer.
RwBool psCameraBeginUpdate(RwCamera *camera) {
    return RwCameraBeginUpdate(camera) != nil;
}
void psCameraShowRaster(RwCamera *) {}
RwImage *psGrabScreen(RwCamera *) { return nil; }
void psMouseSetPos(RwV2d *) {}
void _psSelectScreenVM(RwInt32) {}
RwBool _psSetVideoMode(RwInt32, RwInt32) { return FALSE; }
RwChar **_psGetVideoModeList() {
    static RwChar label[32];
    snprintf(label, sizeof(label), "%d x %d", int(RsGlobal.maximumWidth), int(RsGlobal.maximumHeight));
    static RwChar *modes[] = {label};
    return modes;
}
RwInt32 _psGetNumVideModes() { return _psGetVideoModeList() ? 1 : 0; }
void HandleExit() { RsGlobal.quit = TRUE; }
RwBool IsForegroundApp() { return !RsGlobal.quit; }
