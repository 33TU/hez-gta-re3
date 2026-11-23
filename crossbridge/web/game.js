import {WebGLContext3D} from "@swf2es/context3d/webgl";
import {installGameMouse} from "./mouse.mjs";

export const game = document.querySelector("#game");
const view = document.querySelector("#view");
installGameMouse(game, view);
// The Stage3D back buffer stays 640 × 480. Scale it together with the Flash overlay.
new ResizeObserver(([entry]) => {
    const {width, height} = entry.contentRect;
    view.style.setProperty("--game-scale", String(Math.min(width / 640, height / 480)));
}).observe(view);

export function surface() {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "Game scene");
    const gl = canvas.getContext("webgl2", {alpha: false, antialias: false, depth: true, stencil: true});
    if (!gl) throw new Error("GTA III requires WebGL 2.");
    return {canvas, context: new WebGLContext3D(gl)};
}

export function showError(error) {
    document.querySelector("#status").textContent = String(error);
    console.error(error);
}

export function ready() {
    document.querySelector("#status").textContent =
        "Click to capture the mouse and enable sound. Esc releases it. M toggles fullscreen. " +
        "Space skips the cutscene. WASD or arrows move and steer. F or Enter gets in or out.";
}
