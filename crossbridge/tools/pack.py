"""Pack a local classic GTA Vice City install for the CrossBridge VFS. Each file inflates separately."""
from pathlib import Path
import argparse
import os
import struct
import tempfile
import zlib


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("install", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
files = {}
folders = {"data", "models", "anim", "txd", "text"}
if not args.install.is_dir():
    parser.error(f"Game directory not found: {args.install}")
for entry in args.install.iterdir():
    if entry.is_dir() and entry.name.lower() in folders:
        for source in entry.rglob("*"):
            if source.is_file():
                files[source.relative_to(args.install).as_posix().upper()] = source
required = ("DATA/GTA_VC.DAT", "DATA/MAIN.SCM", "MODELS/GTA3.IMG", "MODELS/GTA3.DIR",
            "TEXT/AMERICAN.GXT", "ANIM/PED.IFP", "ANIM/CUTS.IMG", "ANIM/CUTS.DIR")
for name in required:
    if name not in files:
        parser.error("Missing " + name)
args.output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
with tempfile.NamedTemporaryFile(dir=args.output.parent, delete=False) as output:
    output.write(b"GTAV" + struct.pack("<I", len(files)))
    for name, source in sorted(files.items()):
        key = name.encode("ascii")
        raw = source.read_bytes()
        data = zlib.compress(raw, 1)
        output.write(struct.pack("<HII", len(key), len(data), len(raw)))
        output.write(key)
        output.write(data)
os.replace(output.name, args.output)
print(f"{len(files)} game files, {args.output.stat().st_size:,} packed bytes")
