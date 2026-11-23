// Exercise real browser input, the re3 camera and controls, and game audio over CDP.
import { writeFileSync } from "node:fs";
import {chromium} from "playwright-core";

const [page = "http://127.0.0.1:8000/", capture] = process.argv.slice(2);
const browser = await chromium.launch({
    channel: process.env.CHROME ? undefined : "chrome",
    executablePath: process.env.CHROME,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const sleep = ms => new Promise(done => setTimeout(done, ms));

async function check() {
    const tab = await browser.newPage({viewport: {width:960, height:680}});
    const session = await tab.context().newCDPSession(tab);
    const send = session.send.bind(session);
    const listen = session.on.bind(session);
    const evaluate = async expression => {
        const reply = await send("Runtime.evaluate", {expression, returnByValue:true, awaitPromise:true});
        if(reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
        return reply.result;
    };
    const loadedModules = new Set();
    const isAot = !new URL(page).pathname.endsWith("/jit.html");
    let state, error, booted=false;
    const stations=new Set();
    listen("Runtime.consoleAPICalled", event => {
        const line=event.args.map(a => a.value).join(" ").trim();
        if (line.includes("Retail script ready")) {booted=true;console.log(line);}
        if (line.includes("Flash audio")) console.log(line);
        if (line.includes("Game error") || line.includes("Game audio unavailable") || line.includes("Game audio audio/")) error=line;
        const match=/Game frame (\d+) time (\d+).*?cutscene (\d+) player ([\d.-]+) ([\d.-]+) ([\d.-]+) vehicle (-?\d+) controls (\d+)(.*)/.exec(line);
        if (match) {
            state={frame:+match[1],time:+match[2],cutscene:+match[3],x:+match[4],y:+match[5],car:+match[7],controls:+match[8],missions:match[9]};
            const input=/camera ([\d.-]+) ([\d.-]+) ([\d.-]+) actions (\d) (\d) (\d)/.exec(line);
            if(input) {state.front=input.slice(1,4).map(Number);state.actions=input.slice(4).map(Number);}
            console.log(line);
        }
    });
    listen("Runtime.exceptionThrown", event => {error=event.exceptionDetails.exception?.description || event.exceptionDetails.text;});
    listen("Network.responseReceived", e => {
        if (e.response.status >= 400 && !e.response.url.endsWith("/favicon.ico")) error = "HTTP " + e.response.status + " for " + e.response.url;
        const compiled = /\/compiled\/([^/]+\.js)$/.exec(new URL(e.response.url).pathname);
        if (compiled && e.response.status===200) loadedModules.add(compiled[1]);
        const station=/\/audio\/(head|class|kjah|rise|lips|game|msx|flash|chat)\/\d+\.bin/.exec(e.response.url);
        if(station && e.response.status===200) stations.add(station[1]);
        if (/\/audio\/[^/]+\/\d+\.bin/.test(e.response.url)) console.log("Stream", new URL(e.response.url).pathname, e.response.status);
    });
    await send("Network.enable");
    await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", {source: `{
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(...args) {
            if (this.getAttribute("aria-label") === "Game scene") window.sceneCanvas = this;
            return getContext.apply(this, args);
        };
        window.audioCheck = {blocks:0, peak:0};
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function(...args) {
            const result = start.apply(this,args);
            if (this.context.state === "running" && this.buffer?.length === 4096) {
                const data = this.buffer.getChannelData(0);
                let peak = 0;
                for (const value of data) peak = Math.max(peak,Math.abs(value));
                if (peak > .001) audioCheck.blocks++;
                audioCheck.peak = Math.max(peak,audioCheck.peak);
            }
            return result;
        };
    }`});
    await send("Page.enable");
    await send("Page.navigate",{url:page});
    const key=(type,key,code,number)=>send("Input.dispatchKeyEvent",{type,key,code,windowsVirtualKeyCode:number,nativeVirtualKeyCode:number});
    const tap=async (name,code,n) => {await key("keyDown",name,code,n);await sleep(180);await key("keyUp",name,code,n);};
    const mouse=(type,options={})=>send("Input.dispatchMouseEvent",{type,x:480,y:310,...options});
    async function until(predicate,message,ms=8500) {
        const deadline=Date.now()+ms;
        while(Date.now()<deadline) {
            if(error) throw Error(error);
            if(await predicate()) return;
            await sleep(70);
        }
        throw Error(message);
    }
    const yaw=v=>Math.atan2(v[1],v[0]);
    const yawChange=(before,after)=>Math.abs(Math.atan2(Math.sin(yaw(after)-yaw(before)),Math.cos(yaw(after)-yaw(before))));
    async function settledCamera() {
        let previous=state;
        await until(()=>{
            if(state.frame===previous.frame) return false;
            const change=yawChange(previous.front,state.front);
            previous=state;
            return change<.02;
        },"Game camera did not settle");
        return state.front;
    }
    const dom=async expr=>(await evaluate(expr)).value;
    const locked=()=>dom("document.pointerLockElement===document.querySelector('#view')");
    const fullscreen=()=>dom("!!document.fullscreenElement");
    const relativeMove=(dx,dy)=>evaluate(`document.pointerLockElement.dispatchEvent(new PointerEvent("pointermove", {
        bubbles:true, pointerType:"mouse", pointerId:1, isPrimary:true, button:-1, movementX:${dx}, movementY:${dy}
    }))`);
    async function checkStats() {
        const button = tab.getByRole("button", {name:"Show stats"});
        const overlay = tab.locator("#view dl[aria-label=Performance]");
        await button.click();
        await until(async () => {
            const figures = await overlay.locator("dd").evaluateAll(cells =>
                Object.fromEntries(cells.map(cell => [cell.dataset.figure, cell.textContent])));
            return parseFloat(figures.fps) > 0 && parseFloat(figures.frame) > 0 &&
                Number(figures["gl-calls"]) > 0 && Number(figures["sub-draws"]) >= Number(figures["gl-calls"]);
        }, "Stats did not report live Stage3D draws and frame measurements");
        console.log("Stage3D stats", await overlay.innerText());
        if (await locked() || await button.getAttribute("aria-pressed") !== "true") throw Error("Stats button did not toggle independently of mouse capture");
        await button.click();
        if (!await overlay.isHidden() || await button.getAttribute("aria-pressed") !== "false") throw Error("Stats did not hide");
        // re3 consumes the right mouse button. Shift+F10 opens the player's host menu.
        const menuKey = () => tab.locator("#game canvas").last().dispatchEvent("keydown", {
            code:"F10", key:"F10", shiftKey:true, bubbles:true, composed:true, cancelable:true,
        });
        await menuKey();
        await tab.getByRole("menuitem", {name:"Show stats", exact:true}).click();
        if (await button.getAttribute("aria-pressed") !== "true") throw Error("Stats button did not follow the context menu");
        await menuKey();
        await tab.getByRole("menuitem", {name:"Hide stats", exact:true}).click();
        if (await locked()) throw Error("Selecting a stats menu item captured the mouse");
        await tab.keyboard.press("Control+Shift+f");
        if (!await overlay.isVisible()) throw Error("Stats shortcut did not show the meter");
    }
    async function checkDisplay() {
        const resolution = tab.getByLabel("Resolution");
        const rate = tab.getByLabel("Frame rate");
        const target = tab.locator('#view [data-figure="fps"]');
        await tab.evaluate(() => {
            const gl = window.sceneCanvas.getContext("webgl2");
            const upload = gl.bufferSubData;
            gl.bufferSubData = function(target, dest, data, offset, length) {
                // The timecycle tint submits four Im2D vertices (x, y, z, w, RGBA, u, v),
                // from the top left down the left edge, then back up the right edge.
                if (target === gl.ARRAY_BUFFER && length === 4 * 28) {
                    const vertices = new Float32Array(data.buffer, data.byteOffset + offset, 4 * 7);
                    const corner = (index, x, y, u, v) => {
                        const i = index * 7;
                        return vertices[i] === x && vertices[i + 1] === y &&
                            vertices[i + 5] === u && vertices[i + 6] === v;
                    };
                    const width = vertices[2 * 7], height = vertices[2 * 7 + 1];
                    if (corner(0, 0, 0, 0, 0) && corner(1, 0, height, 0, 1) &&
                        corner(2, width, height, 1, 1) && corner(3, width, 0, 1, 0)) {
                        window.tintSize = width + "x" + height;
                    }
                }
                return upload.apply(this, arguments);
            };
        });
        for (const [width, height, fps] of [[1280,720,60], [1920,1080,256], [1280,960,30], [640,480,30]]) {
            const size = width + "x" + height;
            await resolution.selectOption(size);
            await rate.selectOption(String(fps));
            await until(() => dom("window.sceneCanvas?.width === " + width + " && window.sceneCanvas.height === " + height),
                "Stage3D did not resize to " + width + " × " + height);
            await until(() => tab.evaluate(size => window.tintSize === size, size),
                "Timecycle tint did not resize to " + size);
            await checkSceneSize(width / height);
            await until(async () => (await target.innerText()).includes("/ " + fps + " fps"),
                "Movie did not adopt the selected frame rate " + fps);
        }
        await tab.evaluate(() => { delete window.sceneCanvas.getContext("webgl2").bufferSubData; });
        console.log("Switched Stage3D back buffers, full-screen tint and frame rates during the game");
    }
    async function checkSceneSize(aspect = 4 / 3) {
        await until(() => dom(`(() => {
            const view = document.querySelector("#view").getBoundingClientRect();
            const scene = window.sceneCanvas?.getBoundingClientRect();
            const width = Math.min(view.width, view.height * ${aspect});
            return scene && Math.abs(scene.width - width) < 2 && Math.abs(scene.height - width / ${aspect}) < 2 &&
                Math.abs((scene.left - view.left) * 2 + scene.width - view.width) < 2 &&
                Math.abs((scene.top - view.top) * 2 + scene.height - view.height) < 2;
        })()`), "Stage3D scene did not fit the view");
    }
    async function checkMouse() {
        if (!await locked() || await fullscreen()) throw Error("First click did not capture in the window");
        await tab.setViewportSize({width:480,height:640});
        await checkSceneSize();
        await tab.setViewportSize({width:960,height:680});
        await checkSceneSize();
        const before=await settledCamera();
        // CDP moves to absolute positions. Feed a known relative delta to the real lock owner.
        await relativeMove(145,0);
        await until(()=>yawChange(before,state.front)>.12,"Captured windowed mouse did not turn the camera");
        console.log("Windowed capture turned camera",before,state.front);
        for(const [i,button] of ["left","right","middle"].entries()){
            await mouse("mousePressed",{button,clickCount:1});
            await until(()=>state.actions[i]===1,"Missing re3 action on "+button+" press");
            await mouse("mouseReleased",{button,clickCount:1});
            await until(()=>state.actions[i]===0,"Stuck re3 action on "+button+" release");
        }
        await mouse("mousePressed",{button:"right",clickCount:1});
        await until(()=>state.actions[1]===1,"Right button did not target before release");
        await tap("Escape","Escape",27);
        await until(async()=>!await locked(),"Escape did not release the pointer");
        await until(()=>state.actions[1]===0,"Target stayed held after release");
        await mouse("mouseReleased",{button:"right",clickCount:1});
        const freeFront=await settledCamera();
        await mouse("mouseMoved",{x:690,y:360});
        const freeFrame=state.frame;
        await until(()=>state.frame>freeFrame,"No frame after free pointer movement");
        if (yawChange(freeFront,state.front)>.08) throw Error("Uncaptured mouse still turned the camera");

        await mouse("mousePressed",{button:"left",clickCount:1});
        await until(locked,"Click did not recapture the mouse");
        const pressFrame=state.frame;
        await until(()=>state.frame>pressFrame,"No frame during capture click");
        if(state.actions[0]) throw Error("The capture click also attacked");
        await mouse("mouseReleased",{button:"left",clickCount:1});
        await tap("m","KeyM",77);
        await until(fullscreen,"M did not enter fullscreen");
        if (!await locked()) throw Error("M lost capture when entering fullscreen");
        const overlay = tab.locator("#view dl[aria-label=Performance]");
        const corner = await overlay.getAttribute("data-corner");
        await tab.keyboard.press("Control+Shift+f");
        if (!await overlay.isVisible() || await overlay.getAttribute("data-corner") === corner || !await locked()) {
            throw Error("Fullscreen stats shortcut did not move the meter while keeping mouse capture");
        }
        await checkSceneSize();
        const lockedFront=await settledCamera();
        await relativeMove(-155,5);
        await until(()=>yawChange(lockedFront,state.front)>.12,"Fullscreen mouse did not turn the camera");
        await tap("Escape","Escape",27);
        await until(async()=>!await locked() && !await fullscreen(),"Escape did not leave fullscreen capture");
        await mouse("mousePressed",{button:"left",clickCount:1});
        await mouse("mouseReleased",{button:"left",clickCount:1});
        await until(locked,"Mouse did not recapture after fullscreen");
        console.log("Escape released and click recaptured without attacking");
    }
    let mouseChecked=false, tuned=false;
    let focused=false, lastSkip=0, lastEnter=0, origin;
    for(const deadline=Date.now()+230000; Date.now()<deadline;){
        if(error)throw Error(error);
        if (!booted) {
            const message = await dom("document.querySelector('#status')?.textContent || ''");
            if (/error|failed|refused|could not/i.test(message)) throw Error(message);
        }
        if(booted && !focused){
            await checkStats();
            const box=(await evaluate('JSON.stringify(document.querySelector("#game").getBoundingClientRect())')).value;
            const {x,y,width,height}=JSON.parse(box);
            for (const type of ["mousePressed","mouseReleased"])
                await send("Input.dispatchMouseEvent",{type,x:x+width/2,y:y+height/2,button:"left",clickCount:1});
            await until(locked,"The first click did not capture the mouse");
            if(await fullscreen()) throw Error("Windowed capture changed the view size");
            const ret=await evaluate('document.activeElement.id');
            if(ret.value!=="game")throw Error("Movie did not receive keyboard focus");
            focused=true;
        }
        if(focused && state?.frame>=100 && state.cutscene && Date.now()-lastSkip>700){
            await tap(" ","Space",32);lastSkip=Date.now();
        }
        if(state?.controls && state.car===-1 && !mouseChecked){
            await checkDisplay();
            await checkMouse();mouseChecked=true;
        }
        if(state?.controls && state.car===-1 && Date.now()-lastEnter>2500){
            await tap("f","KeyF",70);lastEnter=Date.now();
        }
        if(state?.car===111 && !origin){
            origin={...state};
            await evaluate("audioCheck.blocks=0; audioCheck.peak=0");
            await key("keyDown","ArrowUp","ArrowUp",38);
        }
        if(origin && stations.size && !tuned) {
            await mouse("mouseWheel",{deltaX:0,deltaY:-120});
            tuned=true;
        }
        if(origin && stations.size>=2 && state.car===111 && state.missions.includes("mission eight") && Math.hypot(state.x-origin.x,state.y-origin.y)>15){
            await key("keyUp","ArrowUp","ArrowUp",38);
            const audio=JSON.parse((await evaluate("JSON.stringify(audioCheck)")).value);
            if (audio.blocks<5) throw Error("Expected audible game audio in Web Audio: "+JSON.stringify(audio));
            console.log("Audible stereo buffers while driving",audio.blocks,"peak",audio.peak);
            if (isAot) {
                const res = await fetch(new URL("./compiled/manifest.json", page));
                if (!res.ok) throw Error("Missing AOT manifest");
                const manifest = await res.json();
                const expected = [...manifest.libraries, ...manifest.abcs].map(entry => entry.module);
                for (const name of expected) if (!loadedModules.has(name)) throw Error("AOT did not import " + name);
                console.log("Imported all", expected.length, "AOT modules");
            } else if (loadedModules.size) throw Error("JIT requested AOT modules");
            if (capture) {
                const shot=await send("Page.captureScreenshot",{format:"png"});
                writeFileSync(capture,Buffer.from(shot.data,"base64"));
            }
            console.log("Mouse wheel changed station",...stations);
            console.log("Opening mission drove the Kuruma",origin.x,origin.y,state.x,state.y);
            return;
        }
        await sleep(120);
    }
    throw Error("Timed out before keyboard input drove the mission car");
}

try { await check(); } finally { await browser.close(); }
