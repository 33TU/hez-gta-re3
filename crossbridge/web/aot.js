import {createCodegen} from "@swf2es/codegen";
import {builtinLibrary, nativeMemory, Player, playerglobalLibrary, Scripting} from "@swf2es/player";
import {precompiledModules} from "@swf2es/player-hosts/precompiled";
// The 0.1.38 web element exposes the IndexedDB cache. Use its playback and
// Stage3D adapters directly to supply the CLI's importable ES modules.
import {externalInterfaceHost} from "../../node_modules/@swf2es/web/dist/external.js";
import {fetchFor} from "../../node_modules/@swf2es/web/dist/fetching.js";
import {Playback} from "../../node_modules/@swf2es/web/dist/playback.js";
import {Stage3DSession} from "../../node_modules/@swf2es/web/dist/stage3d.js";
import {game, ready, showError, surface} from "./game.js";
import {bindStats} from "./stats.js";

async function play() {
    const url = new URL("./re3-game.swf", document.baseURI);
    const [wasm, response] = await Promise.all([
        WebAssembly.compileStreaming(fetch("./codegen.wasm")),
        fetch(url),
    ]);
    if (!response.ok) throw new Error(`Could not load the SWF (HTTP ${response.status}).`);
    const bridge = externalInterfaceHost({
        objectID: game.id,
        alive: () => game.isConnected,
        callback(name, call) {
            if (name === "re3Mouse") game.re3Mouse = call;
        },
    }, showError, caller => new URL(caller, url).origin === url.origin);
    const codegen = await createCodegen(wasm);
    const scripting = new Scripting(codegen, {
        url: url.href,
        fetch: fetchFor({air: null}, false),
        externalInterface: bridge,
        moduleCache: precompiledModules("./compiled/manifest.json", {importModules: true}),
        onUncaught: showError,
    });
    let playback;
    const stage = new Stage3DSession(game, scripting, surface, () => playback?.invalidate());
    await scripting.loadLibraries([builtinLibrary, playerglobalLibrary]);
    const player = new Player(new Uint8Array(await response.arrayBuffer()), scripting);
    game.addEventListener("pointerdown", () => player.audio?.resume?.());
    playback = await Playback.create(game, player, scripting,
        () => ({scale: "showAll", salign: null, wmode: "window", bgcolor: null}), showError, stage);
    await player.start();
    bindStats(player, () => ({codegen: codegen.memoryBytes(), native: nativeMemory()}), listener => {
        playback.onFrame = listener;
    });
    playback.run();
    ready();
}

play().catch(showError);
