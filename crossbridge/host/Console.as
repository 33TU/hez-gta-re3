package com.adobe.flascc
{
	import C_Run.Exit;
	import com.adobe.flascc.vfs.ISpecialFile;
	import flash.display.*;
	import flash.display3D.*;
	import flash.display3D.textures.*;
	import flash.events.*;
	import flash.external.ExternalInterface;
	import flash.net.*;
	import flash.media.*;
	import flash.text.*;
	import flash.utils.*;

	public class Console extends Sprite implements ISpecialFile
	{
		private var ctx:Context3D, shader:Program3D, overlay:Program3D, bootFn:int, frameFn:int, keyFn:int;
		private var audioRoot:String = "audio/", audioReady:Boolean, bankPtr:int, bankBytes:int, mixFn:int;
		private var sound:Sound, outputChannel:SoundChannel, chunkLoads:Array = [];
		private var stopped:Boolean;
		private var mouseDX:Number = 0, mouseDY:Number = 0;
		// Button and frame bits exchanged with game.cpp.
		private static const MOUSE_LEFT:int = 1;
		private static const MOUSE_RIGHT:int = 2;
		private static const MOUSE_MIDDLE:int = 4;
		private static const MOUSE_WHEEL_UP:int = 8;
		private static const MOUSE_WHEEL_DOWN:int = 16;
		private static const FRAME_RUNNING:int = 1;
		private static const FRAME_IN_CUTSCENE:int = 2;
		private static const FRAME_IN_VEHICLE:int = 4;
		private static const FRAME_HAS_CONTROL:int = 8;
		private static const FRAME_VEHICLE_NEARBY:int = 16;
		private var heldButtons:int, tappedButtons:int, wheelQueue:Array = [], wheelPulse:Boolean;
		private var pageMouse:Boolean, pageLocked:Boolean;
		private var lastLocked:Boolean, captureKeyDown:Boolean, acceptMotionAt:int;
		private var frameArgs:Vector.<int> = new Vector.<int>(3, true);
		private var noArgs:Vector.<int> = new Vector.<int>();
		private var air:Object, capture:Boolean, pack:ByteArray, loader:URLLoader, total:uint, done:uint;
		private var dirs:Object = {"/": true}, started:Boolean, mounted:Boolean, frame:int, controlFrames:int, drivingFrames:int;
		private var status:TextField = new TextField(), pressed:Object = {};
		private var gpu:Object = {}, textureData:Object = {}, geometry:Object = {}, quads:Object = {};
		private const screen:Vector.<Number> = Vector.<Number>([2 / 640, 0, 0, -1, 0, -2 / 480, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1]);
		private var renderWidth:int = 640, renderHeight:int = 480, resizeFn:int;
		private var mapMatrix:Vector.<Number> = new Vector.<Number>(16, true);

		public function Console(container:DisplayObjectContainer = null)
		{
			CModule.rootSprite = container ? container.root : this;
			if (CModule.runningAsWorker())
				return;
			if (container)
				container.addChild(this);
			if (stage)
				init();
			else
				addEventListener(Event.ADDED_TO_STAGE, init);
		}

		private function init(e:Event = null):void
		{
			stage.scaleMode = StageScaleMode.SHOW_ALL;
			stage.align = "";
			stage.frameRate = 30;
			status.defaultTextFormat = new TextFormat("_sans", 18, 0xffffff);
			status.x = 12;
			status.y = 430;
			status.width = 620;
			status.height = 48;
			status.background = true;
			status.backgroundColor = 0x181818;
			addChild(status);
			status.text = "Loading GTA III from the local installation…";
			CModule.vfs.console = this;
			CModule.startAsync(this);
			try
			{
				air = getDefinitionByName("flash.desktop.NativeApplication").nativeApplication;
				air.addEventListener("invoke", function(evt:Object):void
					{
						if (pack || loader || mounted)
							return;
						capture = evt.arguments.indexOf("capture") >= 0;
						for each (var a:String in evt.arguments)
							if (a.indexOf("pack=") == 0)
							{
								var f:Class = getDefinitionByName("flash.filesystem.File") as Class;
								var stream:Object = new (getDefinitionByName("flash.filesystem.FileStream") as Class)();
								var packFile:Object = new f(a.substr(5));
								audioRoot = packFile.parent.resolvePath("audio").url + "/";
								stream.open(packFile, "read");
								var b:ByteArray = new ByteArray();
								stream.readBytes(b);
								stream.close();
								beginPack(b);
								return;
							}
							fetchPack();
					});
			}
			catch (err:Error)
			{
				fetchPack();
			}
		}

		private function fetchPack():void
		{
			loader = new URLLoader();
			loader.dataFormat = URLLoaderDataFormat.BINARY;
			loader.addEventListener(ProgressEvent.PROGRESS, function(e:ProgressEvent):void
				{
					status.text = "Reading local game data… " + int(e.bytesLoaded / 1048576) + " MiB";
				});
			loader.addEventListener(Event.COMPLETE, function(e:Event):void
				{
					var b:ByteArray = loader.data;
					loader = null;
					beginPack(b);
				});
			loader.addEventListener(IOErrorEvent.IO_ERROR, function(e:IOErrorEvent):void
				{
					fail(e.text);
				});
			loader.load(new URLRequest("game.bin"));
		}

		private function fail(s:String):void
		{
			trace("Game error", s);
			stopGame(s, 1);
		}

		private function stopGame(message:String, code:int):void
		{
			stopped = true;
			removeEventListener(Event.ENTER_FRAME, draw);
			started = false;
			chunkLoads.length = 0;
			if (outputChannel)
				outputChannel.stop();
			status.visible = true;
			status.text = message;
			if (capture && air)
				air.exit(code);
		}

		private function callGame(fn:int, args:Vector.<int>):int
		{
			if (stopped)
				return 0;
			try
			{
				return CModule.callI(fn, args);
			}
			catch (ex:Exit)
			{
				var message:String = "GTA III exited with code " + ex.code + ".";
				trace(message);
				stopGame(message, ex.code);
				return 0;
			}
		}

		private function beginPack(b:ByteArray):void
		{
			b.position = 0;
			b.endian = "littleEndian";
			if (b.readUTFBytes(4) != "GTA3")
			{
				fail("Invalid game data pack");
				return;
			}
			total = b.readUnsignedInt();
			pack = b;
		}

		private function unpack():void
		{
			var until:int = getTimer() + 20;
			while (done < total && getTimer() <= until)
			{
				var k:uint = pack.readUnsignedShort(), n:uint = pack.readUnsignedInt(), raw:uint = pack.readUnsignedInt();
				var path:String = pack.readUTFBytes(k), directory:String = "";
				if (!/^[A-Z0-9_. \/-]+$/.test(path) || path.indexOf("..") != -1 || n > pack.bytesAvailable)
					throw Error("Invalid game file " + path);
				var parts:Array = path.split("/");
				for (var j:int = 0; j < parts.length - 1; j++)
				{
					directory += "/" + parts[j];
					if (!dirs[directory])
					{
						CModule.vfs.addDirectory(directory);
						dirs[directory] = true;
					}
				}
				var file:ByteArray = new ByteArray();
				pack.readBytes(file, 0, n);
				file.uncompress();
				file.position = 0;
				if (file.length != raw)
					throw Error("Incomplete " + path);
				CModule.vfs.addFile("/" + path, file);
				done++;
			}
			status.text = "Mounting GTA III files… " + done + " / " + total;
			if (done == total)
			{
				pack.clear();
				pack = null;
				mounted = true;
				trace("Mounted", total, "game files");
				fetchAudioBank();
			}
		}

		private function fetchAudioBank():void
		{
			loader = new URLLoader();
			loader.dataFormat = URLLoaderDataFormat.BINARY;
			loader.addEventListener(ProgressEvent.PROGRESS, function(e:ProgressEvent):void
				{
					status.text = "Reading game audio… " + int(e.bytesLoaded / 1048576) + " MiB";
				});
			loader.addEventListener(Event.COMPLETE, function(e:Event):void
				{
					var b:ByteArray = loader.data;
					try
					{
						bankBytes = b.length;
						bankPtr = CModule.malloc(bankBytes);
						if (!bankPtr)
							throw Error("Could not allocate the game audio bank");
						CModule.ram.position = bankPtr;
						CModule.ram.writeBytes(b);
						loader = null;
						audioReady = true;
					}
					catch (err:Error)
					{
						unavailable(err);
					}
					b.clear();
				});
			function unavailable(e:Object):void
			{
				trace("Game audio unavailable", e.toString());
				if (bankPtr)
					CModule.free(bankPtr);
				bankPtr = 0;
				bankBytes = 0;
				loader = null;
				audioReady = true;
			}

			loader.addEventListener(IOErrorEvent.IO_ERROR, unavailable);
			loader.addEventListener(SecurityErrorEvent.SECURITY_ERROR, unavailable);
			status.text = "Reading game audio…";
			try
			{
				loader.load(new URLRequest(audioRoot + "bank.bin"));
			}
			catch (err:Error)
			{
				unavailable(err);
			}

		}
		public function audioChunk(slot:int, name:String, block:int, dest:int, ready:int, size:int):void
		{
			var req:URLLoader = new URLLoader();
			var prior:URLLoader = chunkLoads[slot] as URLLoader;
			chunkLoads[slot] = req;
			if (prior)
			{
				try
				{
					prior.close();
				}
				catch (closed:Error)
				{
				}
			}
			req.dataFormat = URLLoaderDataFormat.BINARY;
			var url:String = audioRoot + name.split(String.fromCharCode(0))[0] + "/" + block + ".bin";
			function failed(message:String):void
			{
				if (chunkLoads[slot] !== req)
					return;
				chunkLoads[slot] = null;
				CModule.write32(ready, -1);
				trace("Game audio", url, message);
			}

			function ioError(e:Event):void
			{
				failed(e.toString());
			}

			req.addEventListener(IOErrorEvent.IO_ERROR, ioError);
			req.addEventListener(SecurityErrorEvent.SECURITY_ERROR, ioError);
			req.addEventListener(Event.COMPLETE, function(e:Event):void
				{
					if (chunkLoads[slot] !== req)
						return;
					try
					{
						var b:ByteArray = req.data;
						b.uncompress();
						if (b.length != size)
							throw Error("Incomplete audio block");
						CModule.ram.position = dest;
						CModule.ram.writeBytes(b);
						chunkLoads[slot] = null;
						CModule.write32(ready, 1);
					}
					catch (err:Error)
					{
						failed(err.message);
					}
				});
			try
			{
				req.load(new URLRequest(url));
			}
			catch (err:Error)
			{
				failed(err.message);

			}
		}
		private function startAudio():void
		{
			sound = new Sound();
			sound.addEventListener(SampleDataEvent.SAMPLE_DATA, function(e:SampleDataEvent):void
				{
					if (stopped)
						return;
					var ptr:int = callGame(mixFn, noArgs);
					if (stopped)
						return;
					e.data.endian = Endian.LITTLE_ENDIAN;
					e.data.writeBytes(CModule.ram, ptr, 4096 * 8);
				});
			try
			{
				outputChannel = sound.play();
			}
			catch (err:Error)
			{
				trace("Flash sound output", err.message);
			}
			if (stopped)
			{
				if (outputChannel)
					outputChannel.stop();
				return;
			}
			if (!outputChannel)
			{
				trace("Game audio unavailable: sound output could not start");
				CModule.free(bankPtr);
				bankPtr = 0;
				bankBytes = 0;
			}
		}

		public function startGame(boot:int, tick:int, key:int, mix:int, resize:int):void
		{
			mixFn = mix;
			resizeFn = resize;
			bootFn = boot;
			frameFn = tick;
			keyFn = key;
			try
			{
				if (ExternalInterface.available)
				{
					ExternalInterface.addCallback("re3Display", setDisplay);
					ExternalInterface.call("re3DisplayReady");
				}
			}
			catch (noPageDisplay:Error)
			{
			}
			try
			{
				if (ExternalInterface.available)
				{
					var mode:int = int(ExternalInterface.call("re3MouseReady"));
					if (mode)
					{
						ExternalInterface.addCallback("re3Mouse", pageMouseEvent);
						pageMouse = true;
						pageMouseEvent("lock", int(mode == 2));
					}
				}
			}
			catch (unavailable:Error)
			{
			}
			stage.addEventListener(KeyboardEvent.KEY_DOWN, keyboard);
			stage.addEventListener(KeyboardEvent.KEY_UP, keyboard);
			stage.addEventListener(MouseEvent.MOUSE_MOVE, mouseMove);
			for each (var eventType:String in [MouseEvent.MOUSE_DOWN, MouseEvent.MOUSE_UP,
						MouseEvent.RIGHT_MOUSE_DOWN, MouseEvent.RIGHT_MOUSE_UP,
						MouseEvent.MIDDLE_MOUSE_DOWN, MouseEvent.MIDDLE_MOUSE_UP])
				stage.addEventListener(eventType, mouseButton);
			stage.addEventListener(MouseEvent.MOUSE_WHEEL, mouseWheel);
			stage.addEventListener(Event.MOUSE_LEAVE, function(e:Event):void
				{
					if (!pageMouse && !stage.mouseLock)
						resetMouse();
				});
			stage.addEventListener(FullScreenEvent.FULL_SCREEN, function(e:FullScreenEvent):void
				{
					resetMouse();
				});
			stage.addEventListener(Event.DEACTIVATE, function(e:Event):void
				{
					resetMouse();
					captureKeyDown = false;
					for (var k:String in pressed)
						if (pressed[k])
							sendKey(int(k), false);
				});
			var slot:Stage3D = stage.stage3Ds[0];
			slot.addEventListener(Event.CONTEXT3D_CREATE, ready);
			slot.addEventListener(ErrorEvent.ERROR, function(e:ErrorEvent):void
				{
					fail(e.text);
				});
			slot.requestContext3D("auto", "baseline");
		}

		private function setDisplay(w:int, h:int, fps:int):void
		{
			if (stopped || w < 32 || h < 32 || w > 2048 || h > 2048 || fps < 1 || fps > 1000)
				return;
			stage.scaleMode = StageScaleMode.NO_SCALE;
			stage.align = StageAlign.TOP_LEFT;
			stage.frameRate = fps;
			if (w == renderWidth && h == renderHeight)
				return;
			renderWidth = w;
			renderHeight = h;
			screen[0] = 2 / w;
			screen[5] = -2 / h;
			status.y = h - 50;
			status.width = w - 24;
			if (ctx)
				ctx.configureBackBuffer(w, h, 0, true);
			if (started)
				callGame(resizeFn, Vector.<int>([w, h]));
		}

		private function resetMouse():void
		{
			mouseDX = mouseDY = 0;
			heldButtons = tappedButtons = 0;
			wheelQueue.length = 0;
			wheelPulse = false;
		}

		private function pageMouseEvent(type:String, a:Number = 0, b:Number = 0):void
		{
			if (type == "lock")
			{
				resetMouse();
				pageLocked = Boolean(a);
				acceptMotionAt = getTimer() + 80;
			}
			else if (started && pageLocked)
			{
				switch (type)
				{
					case "move":
						if (getTimer() >= acceptMotionAt)
						{
							mouseDX += a;
							mouseDY += b;
						}
						break;
					case "down":
						heldButtons |= int(a);
						tappedButtons |= int(a);
						break;
					case "up":
						heldButtons &= ~int(a);
						break;
					case "wheel":
						if (wheelQueue.length < 16)
							wheelQueue.push(a > 0 ? MOUSE_WHEEL_UP : MOUSE_WHEEL_DOWN);
						break;
				}
			}
		}

		private function syncMouseLock():void
		{
			if (lastLocked != stage.mouseLock)
			{
				resetMouse();
				lastLocked = stage.mouseLock;
				// Some hosts report their cursor warp as movement when acquiring the lock.
				if (lastLocked)
					acceptMotionAt = getTimer() + 80;
			}
		}

		private function mouseMove(e:MouseEvent):void
		{
			if (pageMouse || !started)
				return;
			syncMouseLock();
			if (lastLocked && getTimer() >= acceptMotionAt)
			{
				mouseDX += e.movementX;
				mouseDY += e.movementY;
			}
		}

		private function mouseButton(e:MouseEvent):void
		{
			if (pageMouse)
				return;
			syncMouseLock();
			if (!lastLocked)
			{
				if (e.type == MouseEvent.MOUSE_DOWN)
				{
					if (stage.displayState == StageDisplayState.NORMAL)
						toggleMouseCapture();
					else
					{
						try
						{
							stage.mouseLock = true;
						}
						catch (err:Error)
						{
						}
					}
				}
				return;
			}
			if (!started)
				return;
			var bit:int;
			switch (e.type)
			{
				case MouseEvent.MOUSE_DOWN:
				case MouseEvent.MOUSE_UP:
					bit = MOUSE_LEFT;
					break;
				case MouseEvent.RIGHT_MOUSE_DOWN:
				case MouseEvent.RIGHT_MOUSE_UP:
					bit = MOUSE_RIGHT;
					break;
				default:
					bit = MOUSE_MIDDLE;
			}
			if (e.type == MouseEvent.MOUSE_DOWN || e.type == MouseEvent.RIGHT_MOUSE_DOWN || e.type == MouseEvent.MIDDLE_MOUSE_DOWN)
			{
				heldButtons |= bit;
				tappedButtons |= bit;
			}
			else
				heldButtons &= ~bit;
		}

		private function mouseWheel(e:MouseEvent):void
		{
			if (!pageMouse && stage.mouseLock && started && e.delta && wheelQueue.length < 16)
				wheelQueue.push(e.delta > 0 ? MOUSE_WHEEL_UP : MOUSE_WHEEL_DOWN);
		}

		public function sampleMouseButtons():int
		{
			var buttons:int = heldButtons | tappedButtons;
			tappedButtons = 0;
			// re3 detects wheel-button edges. Deliver these on its logical clock.
			if (wheelPulse)
				wheelPulse = false;
			else if (wheelQueue.length)
			{
				buttons |= int(wheelQueue.shift());
				wheelPulse = true;
			}
			return buttons;
		}

		private function tickGame():int
		{
			syncMouseLock();
			frameArgs[0] = int(capture);
			frameArgs[1] = int(mouseDX);
			frameArgs[2] = int(mouseDY);
			mouseDX -= frameArgs[1];
			mouseDY -= frameArgs[2];
			return callGame(frameFn, frameArgs);
		}

		private function toggleMouseCapture():void
		{
			try
			{
				if (pageMouse)
				{
					ExternalInterface.call("re3Fullscreen");
					return;
				}
				if (stage.displayState == StageDisplayState.NORMAL)
				{
					stage.displayState = StageDisplayState.FULL_SCREEN_INTERACTIVE;
					stage.mouseLock = true;
				}
				else
					stage.displayState = StageDisplayState.NORMAL;
			}
			catch (err:Error)
			{
				trace("Mouse capture", err.message);
			}
		}

		private function sendKey(code:int, down:Boolean):void
		{
			pressed[code] = down;
			if (started)
				callGame(keyFn, Vector.<int>([code, int(down)]));
		}

		private function keyboard(e:KeyboardEvent):void
		{
			var down:Boolean = e.type == KeyboardEvent.KEY_DOWN;
			if (e.keyCode == 77)
			{
				if (started && down && !captureKeyDown)
					toggleMouseCapture();
				captureKeyDown = down;
				return;
			}
			if (e.keyCode == 27 && pageMouse && down && ExternalInterface.call("re3ReleaseMouse"))
				return;
			if (e.keyCode == 27 && stage.displayState != StageDisplayState.NORMAL)
			{
				if (down)
					stage.displayState = StageDisplayState.NORMAL;
				return;
			}
			if (Boolean(pressed[e.keyCode]) != down)
				sendKey(e.keyCode, down);
		}

		private function agal(fragment:Boolean, ops:Array):ByteArray
		{
			var b:ByteArray = new ByteArray();
			b.endian = "littleEndian";
			b.writeByte(0xa0);
			b.writeUnsignedInt(1);
			b.writeByte(0xa1);
			b.writeByte(fragment ? 1 : 0);
			for each (var op:uint in ops)
				b.writeUnsignedInt(op);
			b.position = 0;
			return b;
		}

		private function ready(e:Event):void
		{
			if (stopped)
				return;
			ctx = stage.stage3Ds[0].context3D;
			ctx.configureBackBuffer(renderWidth, renderHeight, 0, true);
			ctx.setCulling("none");
			shader = ctx.createProgram();
			shader.upload(agal(false, [0x18, 0x030f0000, 0xe4000000, 0, 0xe4000000, 1,
							0, 0x040f0000, 0xe4000002, 0, 0, 0, 1, 0x020f0000, 0xe4000001, 0, 0xe4000004, 1, 0x16, 0x040f0001, 0xe4000000, 2, 0, 0]),
					agal(true, [0x28, 0x020f0000, 0xe4000000, 4, 0, 0x10100005,
							3, 0x020f0000, 0xe4000000, 2, 0xe4000001, 4,
							3, 0x020f0000, 0xe4000000, 2, 0xe4000001, 1,
							2, 0x020f0001, 0xff000000, 2, 0, 1, 0x27, 0, 1, 2, 0, 0,
							0, 0x030f0000, 0xe4000000, 2, 0, 0]));
			overlay = ctx.createProgram();
			overlay.upload(agal(false, [0x18, 0x030f0000, 0xe4000000, 0, 0xe4000000, 1,
							0, 0x040f0000, 0xe4000002, 0, 0, 0, 0, 0x040f0001, 0xe4000001, 0, 0, 0]),
					agal(true, [0x28, 0x020f0000, 0xe4000000, 4, 0, 0x10000005,
							3, 0x030f0000, 0xe4000000, 2, 0xe4000001, 4]));
			ctx.setProgram(shader);
			var white:ByteArray = new ByteArray();
			white.writeUnsignedInt(0xffffffff);
			textureData[0] = {data: white, w: 1, h: 1};
			gpu = {};
			quads = {};
			for (var k:String in textureData)
				uploadTexture(int(k));
			for each (var mesh:Object in geometry)
				uploadMesh(mesh);
			addEventListener(Event.ENTER_FRAME, draw);
		}

		private function draw(e:Event):void
		{
			try
			{
				if (pack)
				{
					unpack();
					return;
				}
				if (!mounted || !audioReady)
					return;
				if (!started)
				{
					if (bankPtr)
						startAudio();
					var booted:int = callGame(bootFn, Vector.<int>([bankPtr, bankBytes, renderWidth, renderHeight]));
					if (stopped)
						return;
					if (!booted)
						throw Error("Game startup failed");
					started = true;
					status.visible = false;
				}
				ctx.clear(.3, .45, .58, 1, 1);
				var flags:int = tickGame();
				if (stopped)
					return;
				if ((flags & FRAME_RUNNING) == 0)
				{
					stopGame("Game closed.", 0);
					if (pageMouse)
						ExternalInterface.call("re3ReleaseMouse", true);
					else if (stage.displayState != StageDisplayState.NORMAL)
						stage.displayState = StageDisplayState.NORMAL;
					if (air && !capture)
						air.exit(0);
					return;
				}
				frame++;
				if (capture)
				{
					if ((flags & FRAME_IN_CUTSCENE) && frame % 15 == 0)
						sendKey(32, true);
					if (pressed[32] && frame % 15 == 3)
						sendKey(32, false);
					if (frame > 60 && (flags & FRAME_HAS_CONTROL) && !(flags & FRAME_IN_CUTSCENE))
					{
						if (++controlFrames == 1)
							save(frame);
						if (flags & FRAME_IN_VEHICLE)
						{
							if (++drivingFrames == 10)
								sendKey(38, true);
							if (drivingFrames == 90)
							{
								sendKey(38, false);
								save(frame);
							}
						}
						else if ((flags & FRAME_VEHICLE_NEARBY) && controlFrames % 80 == 4)
							sendKey(70, true);
						if (pressed[70] && controlFrames % 80 == 8)
							sendKey(70, false);
					}
				}
				if (capture && (frame == 2 || frame == 40 || frame == 100 || frame == 160 || frame == 240 || frame == 310))
					save(frame);
				ctx.present();
				if (capture && (frame == 1000 || drivingFrames == 100))
				{
					removeEventListener(Event.ENTER_FRAME, draw);
					air.exit(0);
				}
			}
			catch (err:Error)
			{
				fail(err.getStackTrace() || err.toString());
			}
		}

		private function uploadTexture(id:int):void
		{
			var t:Object = textureData[id], tex:Texture = ctx.createTexture(t.w, t.h, "bgra", false);
			tex.uploadFromByteArray(t.data, 0);
			gpu[id] = tex;
		}

		public function texture(id:int, ptr:int, w:int, h:int):void
		{
			var data:ByteArray = new ByteArray();
			data.writeBytes(CModule.ram, ptr, w * h * 4);
			textureData[id] = {data: data, w: w, h: h};
			uploadTexture(id);
		}

		public function releaseTexture(id:int):void
		{
			if (gpu[id])
				gpu[id].dispose();
			delete gpu[id];
			delete textureData[id];
		}

		// Draw state packed by render.cpp.
		private static const DRAW_DEPTH_TEST:int = 1;
		private static const DRAW_DEPTH_WRITE:int = 2;
		private static const DRAW_VERTEX_ALPHA:int = 4;
		private static const SRC_BLEND_SHIFT:int = 4;
		private static const DEST_BLEND_SHIFT:int = 8;
		private static const BLEND_FACTOR_MASK:int = 15;
		private const blendModes:Array = [null, "zero", "one", "sourceColor", "oneMinusSourceColor",
				"sourceAlpha", "oneMinusSourceAlpha", "destinationAlpha", "oneMinusDestinationAlpha",
				"destinationColor", "oneMinusDestinationColor", "sourceAlpha"];
		private function blend(flags:int):void
		{
			ctx.setBlendFactors(blendModes[(flags >>> SRC_BLEND_SHIFT) & BLEND_FACTOR_MASK] || "sourceAlpha",
					blendModes[(flags >>> DEST_BLEND_SHIFT) & BLEND_FACTOR_MASK] || "oneMinusSourceAlpha");
		}

		private function constants(m:Vector.<Number>, color:uint, threshold:Number, ambient:int = 0):void
		{
			ctx.setProgramConstantsFromVector("vertex", 0, m, 4);
			ctx.setProgramConstantsFromVector("vertex", 4, Vector.<Number>([ambient / 255, ambient / 255, ambient / 255, 0]), 1);
			ctx.setProgramConstantsFromVector("fragment", 0, Vector.<Number>([threshold, 0, 0, 0,
							(color & 255) / 255, ((color >>> 8) & 255) / 255, ((color >>> 16) & 255) / 255, (color >>> 24) / 255]), 2);
		}

		private var scratch:Vector.<uint> = new Vector.<uint>();
		// Most screen draws (sky bands, character quads and the HUD) reuse
		// an immutable triangle list for a given primitive type and size.
		private function screenPrimitive(kind:int, ptr:int, n:int, textureId:int, flags:int):void
		{
			var key:String = "screen/" + kind + "/" + n, b:Object = quads[key];
			if (!b)
			{
				var indices:Vector.<uint> = new Vector.<uint>();
				for (var i:int = 0; i < n; i++)
				{
					if (kind == 3)
						indices.push(i);
					else if (i >= 2)
						indices.push(kind == 4 ? i - 2 : 0, i - 1, i);
				}
				var ib:IndexBuffer3D = ctx.createIndexBuffer(indices.length);
				ib.uploadFromVector(indices, 0, indices.length);
				b = quads[key] = {ib: ib, vb: ctx.createVertexBuffer(n, 7)};
			}
			ctx.setProgram(overlay);
			ctx.setProgramConstantsFromVector("vertex", 0, screen, 4);
			ctx.setDepthTest((flags & DRAW_DEPTH_WRITE) != 0, (flags & DRAW_DEPTH_TEST) ? "lessEqual" : "always");
			blend(flags);
			var vb:VertexBuffer3D = b.vb;
			vb.uploadFromByteArray(CModule.ram, ptr, 0, n);
			ctx.setVertexBufferAt(0, vb, 0, "float3");
			ctx.setVertexBufferAt(1, vb, 4, "bytes4");
			ctx.setVertexBufferAt(2, vb, 5, "float2");
			ctx.setTextureAt(0, gpu[textureId]);
			ctx.drawTriangles(b.ib);
		}

		public function immediate(world:int, kind:int, ptr:int, n:int, indices:int, count:int, id:int, flags:int):void
		{
			if (!world && !indices)
			{
				screenPrimitive(kind, ptr, n, id, flags);
				return;
			}
			var stride:int = world ? 6 : 7;
			var nidx:int = kind == 3 ? count : (count - 2) * 3;
			var capacity:int = 4;
			while (capacity < n || capacity < nidx)
				capacity *= 2;
			var key:String = stride + "/" + capacity, b:Object = quads[key];
			if (!b)
				b = quads[key] = {ib: ctx.createIndexBuffer(capacity), vb: ctx.createVertexBuffer(capacity, stride)};
			if (indices && kind == 3)
				b.ib.uploadFromByteArray(CModule.ram, indices, 0, count);
			else
			{
				scratch.length = nidx;
				var cursor:int = 0, prev:int = 0, first:int = 0, older:int = 0;
				for (var i:int = 0; i < count; i++)
				{
					var vertex:int = indices ? CModule.read16(indices + 2 * i) : i;
					if (i == 0)
						first = vertex;
					if (kind == 3)
						scratch[cursor++] = vertex;
					else if (i >= 2)
					{
						scratch[cursor++] = kind == 5 ? first : older;
						scratch[cursor++] = prev;
						scratch[cursor++] = vertex;
					}
					older = prev;
					prev = vertex;
				}
				b.ib.uploadFromVector(scratch, 0, nidx);
			}
			b.vb.uploadFromByteArray(CModule.ram, ptr, 0, n);
			ctx.setProgram(world ? shader : overlay);
			if (world)
				constants(mapMatrix, 0xffffffff, 0);
			else
				ctx.setProgramConstantsFromVector("vertex", 0, screen, 4);
			ctx.setDepthTest((flags & DRAW_DEPTH_WRITE) != 0, (flags & DRAW_DEPTH_TEST) ? "lessEqual" : "always");
			blend(flags);
			ctx.setVertexBufferAt(0, b.vb, 0, "float3");
			ctx.setVertexBufferAt(1, b.vb, world ? 3 : 4, "bytes4");
			ctx.setVertexBufferAt(2, b.vb, world ? 4 : 5, "float2");
			ctx.setTextureAt(0, gpu[id]);
			ctx.drawTriangles(b.ib, 0, int(nidx / 3));
		}

		private function uploadMesh(m:Object):void
		{
			m.vb = ctx.createVertexBuffer(m.n, 6);
			m.vb.uploadFromByteArray(m.data, 0, 0, m.n);
			m.ib = ctx.createIndexBuffer(m.count);
			m.ib.uploadFromByteArray(m.indices, 0, 0, m.count);
		}

		public function mesh(id:int, ptr:int, n:int, indices:int, count:int):void
		{
			var data:ByteArray = new ByteArray(), ix:ByteArray = new ByteArray();
			data.writeBytes(CModule.ram, ptr, 24 * n);
			ix.writeBytes(CModule.ram, indices, count * 2);
			var m:Object = geometry[id] = {data: data, indices: ix, n: n, count: count};
			uploadMesh(m);
		}

		public function deform(id:int, ptr:int):void
		{
			var m:Object = geometry[id];
			m.vb.uploadFromByteArray(CModule.ram, ptr, 0, m.n);
		}

		public function forget(id:int):void
		{
			var m:Object = geometry[id];
			if (m)
			{
				m.vb.dispose();
				m.ib.dispose();
				delete geometry[id];
			}
		}

		public function objectMatrix(ptr:int):void
		{
			for (var i:int = 0; i < 16; i++)
				mapMatrix[i] = CModule.readFloat(ptr + 4 * i);
		}

		public function material(id:int, tex:int, first:int, tris:int, color:uint, flags:int, ambient:int):void
		{
			var b:Object = geometry[id];
			ctx.setProgram(shader);
			constants(mapMatrix, color, (flags & DRAW_VERTEX_ALPHA) ? 0.02 : 0.4, ambient);
			ctx.setDepthTest((flags & DRAW_DEPTH_WRITE) != 0, (flags & DRAW_DEPTH_TEST) ? "lessEqual" : "always");
			blend(flags);
			ctx.setVertexBufferAt(0, b.vb, 0, "float3");
			ctx.setVertexBufferAt(1, b.vb, 3, "bytes4");
			ctx.setVertexBufferAt(2, b.vb, 4, "float2");
			ctx.setTextureAt(0, gpu[tex]);
			ctx.drawTriangles(b.ib, first, tris);
		}

		private function save(n:int):void
		{
			var bmp:BitmapData = new BitmapData(renderWidth, renderHeight, false, 0);
			ctx.drawToBitmapData(bmp);
			var data:ByteArray = bmp.encode(bmp.rect, new PNGEncoderOptions());
			var file:Class = getDefinitionByName("flash.filesystem.File") as Class;
			var stream:Object = new (getDefinitionByName("flash.filesystem.FileStream") as Class)();
			stream.open(new file(file.applicationDirectory.resolvePath("frame-" + n + ".png").nativePath), "write");
			stream.writeBytes(data);
			stream.close();
			bmp.dispose();
		}

		public function write(fd:int, p:int, n:int, err:int):int
		{
			trace(CModule.readString(p, n));
			return n;
		}

		public function read(fd:int, p:int, n:int, err:int):int
		{
			return 0;
		}

		public function fcntl(fd:int, cmd:int, data:int, err:int):int
		{
			return 0;
		}

		public function ioctl(fd:int, cmd:int, data:int, err:int):int
		{
			return 0;
		}

		public function exit(code:int):Boolean
		{
			return false;
		}

	}
}
