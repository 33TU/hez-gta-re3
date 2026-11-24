import { WebGLContext3D } from "@swf2es/context3d/webgl";
import { installDisplay } from "./display.js";
import { installGameMouse } from "./mouse.mjs";
import { setSceneContext } from "./stats.js";

export const game = document.querySelector("#game");
const view = document.querySelector("#view");
installGameMouse(game, view);
installDisplay(game, view);

export function surface() {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "Game scene");
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: true,
  });
  if (!gl) throw new Error("GTA Vice City requires WebGL 2.");
  const context = new WebGLContext3D(gl);
  setSceneContext(gl);
  return { canvas, context };
}

export function showError(error) {
  console.error(error);
  let message;
  try {
    message = String(error);
  } catch {
    message = "Game error. See the browser console for details.";
  }
  document.querySelector("#status").textContent = message;
}

export function ready() {
  document.querySelector("#status").textContent =
    "Click to capture the mouse and enable sound. Esc releases it. M toggles fullscreen. " +
    "Space skips the cutscene. WASD or arrows move and steer. F or Enter gets in or out.";
}
