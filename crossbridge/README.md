# GTA III on swf2es

This port builds re3 into a CrossBridge SWF. The browser plays the original opening mission using the data from your own installation of classic GTA III for PC. Stage3D renders the city, vehicles and HUD. The SWF mixes the original sound effects and streams radio and dialogue. Reloading starts a new game.

## Build

Use Linux with Git, Node.js 22.18 or later, npm, Python 3.8 or later, FFmpeg, and the CrossBridge launcher on your PATH. The launcher runs the pinned SDK image in Docker. Set `CROSSBRIDGE_DOCKER=podman` to use Podman. [CrossBridge launcher setup](https://github.com/33TU/crossbridge#quick-start)

Run these commands at the root of the fork.

```sh
git submodule update --init vendor/librw
npm ci
npm run build
```

The build compiles the current engine sources, applies the Flash-specific librw patch in a temporary directory and writes the output to `crossbridge/out/`. The AOT compiler and browser player use the same locked swf2es release. The build also bundles the browser player, its WebAssembly compiler and package license notices for offline use.

## Prepare your local game data

Set `GTA3_DIR` to the folder containing `data`, `models` and `audio` from the classic game.

```sh
GTA3_DIR="/path/to/Grand Theft Auto III"
python3 crossbridge/tools/pack.py "$GTA3_DIR" crossbridge/out/game.bin
python3 crossbridge/tools/prepare_audio.py "$GTA3_DIR" crossbridge/out/audio
npm start
```

The packer fills missing menu labels from re3’s matching language files. If your existing pack shows `FESZ_RM missing` after a mission failure, rerun the `pack.py` command and reload. The existing audio directory can be reused. The audio conversion writes approximately 1.5 GiB. If you already have a prepared pack, you can place or symlink `game.bin` and its sibling `audio/` directory into `crossbridge/out/`. The output directory also holds your private game data after preparation and is ignored by Git.

## Play

Open the [AOT player](http://127.0.0.1:8000/) for normal play. It imports the runtime libraries and game code as ES modules from `compiled/manifest.json`. Keep the corresponding `.js` and `.log` files together. The AOT page permits WebAssembly and same-origin scripts in its content security policy. The [JIT player](http://127.0.0.1:8000/jit.html) compiles the same SWF in the browser. For a quick code change, run `npm run build:swf` and reload the JIT page. Run `npm run build:aot` to refresh the AOT modules. Changes to the browser host use `npm run build:web`.

Click inside the game to focus it, capture the mouse and enable sound. Esc releases the pointer and M toggles fullscreen. Space skips the opening cinematic. Once Claude has control, press F or Enter to enter the Kuruma, wait for 8-Ball, then steer with WASD or the arrow keys. Scroll up or press R to change radio stations.

**Resolution** changes the Stage3D back buffer and the game camera while playing. Choose 640 × 480 or 1280 × 960 for 4:3, or 1280 × 720 or 1920 × 1080 for widescreen. **Frame rate** sets a render target up to 256 FPS. **Display refresh** measures the browser’s animation-frame cadence. The simulation runs at 30 Hz. Both browser players remember these choices on the same origin and default to 640 × 480 at 30 FPS.

**Show stats** below the game toggles the swf2es performance meter. It shows FPS, frame time, Stage3D draw counts and memory. While playing or in fullscreen, Ctrl+Shift+F shows the meter, cycles its corner, then hides it.

For swf2es Desktop, open `crossbridge/out/re3-game.swf` with `game.bin` and `audio/` beside it. For Adobe AIR, run `adl app.xml . -- "pack=$PWD/game.bin"` from the output directory, using a native filesystem path for the AIR SDK. Clicking captures in fullscreen in both standalone players.

## Browser check

With the local server running and Google Chrome installed, these commands exercise mouse capture and release, keyboard input, streamed audio and driving the mission car. The AOT check verifies that the browser loaded all the modules listed in the manifest. Set `CHROME` to use a different Chromium executable.

```sh
npm run check:browser -- http://127.0.0.1:8000/
npm run check:browser -- http://127.0.0.1:8000/jit.html
```
