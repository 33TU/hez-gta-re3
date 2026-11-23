// The browser can lock an embedded view. Flash's Stage.mouseLock requires fullscreen.
export function installGameMouse(game, view) {
    if (typeof view.requestPointerLock !== "function") return;
    const ownsPointer = () => document.pointerLockElement === view;
    const emit = (type, a = 0, b = 0) => game.re3Mouse?.(type, a, b);
    let wanted = false, pending = false, frame = 0, dx = 0, dy = 0, wheel = 0;

    function release() {
        wanted = false;
        if (ownsPointer()) document.exitPointerLock();
    }
    function denied() {
        pending = false;
        if (wanted && !ownsPointer()) {
            wanted = false;
            document.querySelector("#capture-error").hidden = false;
        }
    }
    function resetInput() {
        cancelAnimationFrame(frame);
        frame = dx = dy = wheel = 0;
        emit("lock", Number(ownsPointer()));
    }
    function capture() {
        if (pending || ownsPointer()) return;
        game.focus({preventScroll:true});
        wanted = pending = true;
        try {
            const request = view.requestPointerLock();
            request?.catch(denied);
        } catch {
            denied();
        }
    }
    document.addEventListener("pointerlockerror", denied);
    document.addEventListener("pointerlockchange", () => {
        pending = false;
        if (ownsPointer() && !wanted) { release(); return; }
        if (ownsPointer()) document.querySelector("#capture-error").hidden = true;
        else wanted = false;
        resetInput();
    });
    document.addEventListener("fullscreenchange", () => { if (ownsPointer()) resetInput(); });
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", () => { if (document.hidden) release(); });

    // The initiating click focuses and captures. Subsequent presses go to re3.
    const bits = [1, 4, 2];
    view.addEventListener("mousedown", e => {
        if (!ownsPointer()) {
            if (e.button === 0) capture();
        } else if (bits[e.button]) {
            e.preventDefault();
            emit("down", bits[e.button]);
        }
    });
    view.addEventListener("mouseup", e => {
        if (ownsPointer() && bits[e.button]) emit("up", bits[e.button]);
    });
    view.addEventListener("contextmenu", e => { if (ownsPointer()) e.preventDefault(); });
    view.addEventListener("pointermove", e => {
        if (!ownsPointer() || e.pointerType !== "mouse") return;
        dx += e.movementX;
        dy += e.movementY;
        if (!frame) frame = requestAnimationFrame(() => {
            frame = 0;
            if (ownsPointer() && (dx || dy)) emit("move", dx, dy);
            dx = dy = 0;
        });
    });
    view.addEventListener("wheel", e => {
        if (!ownsPointer() || e.ctrlKey || !e.deltaY) return;
        e.preventDefault();
        wheel -= e.deltaMode === 0 ? e.deltaY / 33 : e.deltaY;
        const lines = Math.trunc(wheel);
        if (lines) { wheel -= lines; emit("wheel", Math.sign(lines)); }
    }, {passive:false});

    // These functions are called by the same-origin SWF through ExternalInterface.
    window.re3MouseReady = () => ownsPointer() ? 2 : 1;
    window.re3ReleaseMouse = () => {
        const active = ownsPointer() || pending || document.fullscreenElement === view;
        release();
        if (document.fullscreenElement === view) document.exitFullscreen().catch(() => {});
        return active;
    };
    window.re3Fullscreen = () => {
        if (document.fullscreenElement === view) return window.re3ReleaseMouse();
        capture();
        view.requestFullscreen?.()?.catch(() => {});
        return true;
    };
}
