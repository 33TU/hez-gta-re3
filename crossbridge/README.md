# GTA III on swf2es

This port builds re3 into a CrossBridge SWF. The browser plays the original opening mission using the data from your own installation of classic GTA III for PC. Stage3D renders the city, vehicles and HUD. The SWF mixes the original sound effects and streams radio and dialogue. Reloading starts a new game.

## Build

Install Git, Node.js 22.18 or later with npm, and Docker or Podman with support for Linux amd64 containers. The repository includes the [upstream CrossBridge launchers](https://github.com/33TU/crossbridge/tree/042987bd8c3b60552c5a18736f602d7ec683ad05/bin). npm selects PowerShell on Windows and Bash on Linux and macOS. The SDK runs inside the container.

Run these commands at the root of the fork.

```sh
git submodule update --init vendor/librw
npm ci
npm run build
```

The build compiles the current engine sources, applies the Flash-specific librw patch in a temporary directory and writes the output to `crossbridge/out/`. The AOT compiler and browser player use the same locked swf2es release. The build also bundles the browser player, its WebAssembly compiler and package license notices for offline use.

| Command | What it runs |
| --- | --- |
| `npm run build` | Build the SWF, compile its AOT modules, and bundle both browser players. |
| `npm run build:swf` | Compile the game with the pinned CrossBridge SDK image. |
| `npm run build:aot` | Compile the existing SWF to JavaScript modules. |
| `npm run build:web` | Bundle the AOT and JIT player pages. |
| `npm run crossbridge -- gcc --version` | Run a command directly in the SDK with the repository mounted at `/work`. |

Docker is the default runtime. To use Podman, set `CROSSBRIDGE_DOCKER=podman` in your environment (`$env:CROSSBRIDGE_DOCKER = "podman"` in PowerShell). Set `CROSSBRIDGE_IMAGE` to override the pinned SDK image.

## Prepare your local game data

Use an installed copy of **classic Grand Theft Auto III for PC**. Open its installation folder and look for `data/main.scm`, `models/gta3.img`, `anim/ped.ifp`, `text/american.gxt`, and the `audio` folder containing `sfx.sdt` and `sfx.raw`. The packer accepts uppercase and lowercase filenames. In a Wine installation, look under the prefix’s `drive_c/Program Files/Rockstar Games/Grand Theft Auto III`.

Install Python 3.8 or later and FFmpeg. Run `ffmpeg -version` to check that the audio converter can find it. After building the port, run the following commands from the repository root using your game’s installation path. Allow approximately 1.5 GiB for the prepared audio in addition to the game pack.

**Linux or macOS**

```sh
GTA3_DIR="/path/to/Grand Theft Auto III"
python3 crossbridge/tools/pack.py "$GTA3_DIR" crossbridge/out/game.bin
python3 crossbridge/tools/prepare_audio.py "$GTA3_DIR" crossbridge/out/audio
npm start
```

**Windows PowerShell**

```powershell
$gta3 = 'C:\Program Files\Rockstar Games\Grand Theft Auto III'
py -3 crossbridge/tools/pack.py "$gta3" crossbridge/out/game.bin
py -3 crossbridge/tools/prepare_audio.py "$gta3" crossbridge/out/audio
py -3 -m http.server 8000 --bind 127.0.0.1 --directory crossbridge/out
```

The packer writes `crossbridge/out/game.bin`. The audio converter writes `crossbridge/out/audio/bank.bin` and numbered chunks in per-track folders. Keep the entire `audio/` directory beside `game.bin`. With the server running, open the [AOT player](http://127.0.0.1:8000/) and click the game to enable sound.

The packer fills missing menu labels from re3’s matching language files. If an older pack shows `FESZ_RM missing` after a mission failure, rerun `pack.py` and reload. You can reuse `game.bin` and the entire `audio/` directory across builds by copying or symlinking them into `crossbridge/out/`. Git ignores this directory, which holds your private game data.

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

## Formatting

Run `npm run format` to format the browser pages, JavaScript build tools and package configuration with Biome. Use `npm run format:check` for a read-only check.
