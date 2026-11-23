"""Prepare Vice City's private effects bank and seekable stereo streams for the SWF."""
import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import zlib

RATE = 22050
CHUNK = RATE * 4 * 4  # Four seconds of stereo signed 16-bit PCM.

def write_file(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        tmp.write(data)
    os.replace(tmp.name, path)

@contextmanager
def open_track(path):
    # Vice City's ADF radio files are MP3 frames with each byte XORed with 0x22.
    with path.open("rb") as source:
        if path.suffix.lower() != ".adf":
            yield source
            return
        table = bytes(n ^ 0x22 for n in range(256))
        with tempfile.TemporaryFile() as decoded:
            while block := source.read(1 << 20):
                decoded.write(block.translate(table))
            decoded.seek(0)
            yield decoded

def prepare(install, output):
    source = next(p for p in install.iterdir() if p.name.lower() == "audio")
    files = {p.name.lower(): p for p in source.iterdir() if p.is_file()}
    desc = files["sfx.sdt"].read_bytes()
    raw = files["sfx.raw"].read_bytes()
    for offset, size, freq, _, _ in struct.iter_unpack("<IIIIi", desc):
        if offset % 2 or size % 2 or offset + size > len(raw) or not freq:
            raise ValueError("Incompatible SFX index or sample data")
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    tracks = {}
    for name, path in sorted(files.items()):
        if path.suffix.lower() not in (".mp3", ".wav", ".adf"):
            continue
        track_name = name
        if not track_name.isascii() or not path.stem.replace("_", "").isalnum() or len(track_name) >= 16:
            raise ValueError(f"Unexpected track name {name}")
        folder = output / track_name
        folder.mkdir(exist_ok=True)
        frames = 0
        with open_track(path) as track, subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-threads", "1", "-i", "pipe:0",
                               "-f", "s16le", "-ac", "2", "-ar", str(RATE), "pipe:1"],
                              stdin=track, stdout=subprocess.PIPE) as decoder:
            while data := decoder.stdout.read(CHUNK):
                write_file(folder / f"{frames // (RATE * 4)}.bin", zlib.compress(data, 1))
                frames += len(data) // 4
            if decoder.wait() or not frames:
                raise ValueError(f"Could not decode {name}")
        tracks[track_name] = frames
    header = struct.pack("<4sIII", b"G3A1", len(desc) // 20, len(tracks), len(raw))
    index = b"".join(struct.pack("<16sI", name.encode("ascii"), frames)
                     for name, frames in tracks.items())
    write_file(output / "bank.bin", header + desc + index + raw)
    print(f"{len(desc)//20} effects and {len(tracks)} streamed tracks")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("install", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    prepare(args.install, args.output)
