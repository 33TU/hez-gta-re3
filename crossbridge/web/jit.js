import {configure} from "@swf2es/web";
import {game, ready, showError, surface} from "./game.js";

configure({codegen: "./codegen.wasm", stage3D: surface});
game.addEventListener("error", event => showError(event.detail.error));
game.src = "./re3-game.swf";
game.ready.then(ready, showError);
