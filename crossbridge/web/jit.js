import { configure } from "@swf2es/web";
import { game, ready, showError, surface } from "./game.js";
import { bindStats } from "./stats.js";

// re3 services streaming and audio on the game thread. CrossBridge also ships unused worker symbols.
configure({ codegen: "./codegen.wasm", stage3D: surface, workers: false, performanceMeter: false });
game.addEventListener("error", (event) => showError(event.detail.error));
game.src = "./revc-game.swf";
game.ready.then(() => {
  bindStats(
    game.player,
    () => game.wasmMemory,
    (listener) => {
      game.frameListener = listener;
    },
  );
  ready();
}, showError);
