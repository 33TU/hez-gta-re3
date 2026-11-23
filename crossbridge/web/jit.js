import {configure} from "@swf2es/web";
import {game, ready, showError, surface} from "./game.js";

// re3 services streaming and audio on the game thread. CrossBridge also ships unused worker symbols.
configure({codegen: "./codegen.wasm", stage3D: surface, workers: false});
game.addEventListener("error", event => showError(event.detail.error));
game.src = "./re3-game.swf";
game.ready.then(ready, showError);
