import {
  METER_STYLE,
  PerformanceMeter,
  nextCorner,
  storedCorner,
  storedMeter,
  storeCorner,
  storeMeter,
} from "../../node_modules/@swf2es/web/dist/meter.js";

let sceneGL = null;
let meter;

export function setSceneContext(gl) {
  sceneGL = gl;
  meter?.attach(gl, true);
}

export function bindStats(player, memory, setFrameListener) {
  const view = document.querySelector("#view");
  const button = document.querySelector("#stats");
  const style = document.createElement("style");
  style.textContent = METER_STYLE;
  view.append(style);
  meter = new PerformanceMeter(view, memory);
  meter.attach(sceneGL, true);

  // Playback's drew flag is for the Flash display list. re3 submits Stage3D
  // draws during advance(). The meter counts only actual GL draw calls.
  const heard = (frame) =>
    meter.heard(frame.frames && !frame.drew ? { ...frame, drew: true } : frame);
  let shown = storedMeter();
  let corner = storedCorner();
  let start = corner;
  function show(on) {
    shown = on;
    meter.show(on);
    setFrameListener(on ? heard : null);
    button.setAttribute("aria-pressed", String(on));
    storeMeter(on);
  }
  function place(at) {
    corner = at;
    meter.place(at);
    storeCorner(at);
  }
  meter.place(corner);
  show(shown);
  button.disabled = false;
  function toggle() {
    start = corner;
    show(!shown);
  }
  button.addEventListener("click", toggle);
  player.hostMenu = () => {
    const items = [{ caption: shown ? "Hide stats" : "Show stats", enabled: true, select: toggle }];
    if (shown)
      items.push({
        caption: "Move stats",
        enabled: true,
        select() {
          place(nextCorner(corner));
          start = corner;
        },
      });
    return items;
  };

  // Keep the shortcut usable under pointer lock and in fullscreen. An
  // ordinary F press and its release still belong to re3's vehicle control.
  let shortcutDown = false;
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.code !== "KeyF") return;
      if (
        !shortcutDown &&
        (event.repeat || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (shortcutDown) return;
      shortcutDown = true;
      if (!shown) {
        start = corner;
        show(true);
      } else {
        place(nextCorner(corner));
        if (corner === start) show(false);
      }
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (event) => {
      if (shortcutDown && event.code === "KeyF") {
        shortcutDown = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  window.addEventListener("blur", () => {
    shortcutDown = false;
  });
}
