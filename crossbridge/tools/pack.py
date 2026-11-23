"""Pack a local classic GTA III install for the CrossBridge VFS. Each file inflates separately."""
from pathlib import Path
import argparse
import os
import struct
import tempfile
import zlib


def gxt_sections(raw):
    # Classic GTA III uses a sorted index of eight-byte names into UTF-16 text.
    key_size, = struct.unpack_from("<I", raw, 4)
    data_at = 8 + key_size
    if raw[:4] != b"TKEY" or raw[data_at:data_at + 4] != b"TDAT":
        raise ValueError("Expected a classic GTA III GXT text file")
    data_size, = struct.unpack_from("<I", raw, data_at + 4)
    if len(raw) != data_at + 8 + data_size:
        raise ValueError("Invalid GXT data size")
    index = {name: offset for offset, name in struct.iter_unpack("<I8s", raw[8:data_at])}
    return index, raw[data_at + 8:]


def add_re3_labels(retail, supplement):
    index, original = gxt_sections(retail)
    extra, translated = gxt_sections(supplement)
    # Some supplied catalogs, including Japanese, predate the mission-retry menu.
    retry = b"FESZ_RM\0"
    if retry not in extra and retry not in index:
        extra[retry] = len(translated)
        translated += "RETRY?\0".encode("utf-16-le")
    missing = extra.keys() - index.keys()
    if not missing:
        return retail
    strings = bytearray(original)
    for key in sorted(missing):
        start = extra[key]
        end = start
        while end + 2 <= len(translated) and translated[end:end + 2] != b"\0\0":
            end += 2
        if end + 2 > len(translated):
            raise ValueError("Unterminated GXT text for " + repr(key))
        index[key] = len(strings)
        strings.extend(translated[start:end + 2])
    table = b"".join(struct.pack("<I8s", index[key], key) for key in sorted(index))
    result = b"TKEY" + struct.pack("<I", len(table)) + table + b"TDAT" + struct.pack("<I", len(strings)) + strings
    if len(result) > 0x40000:
        raise ValueError("Combined GXT exceeds re3's 256 KiB language file limit")
    return result


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
    elif entry.is_file() and entry.name.lower() == "gta3.ini":
        files["GTA3.INI"] = entry
required = ("DATA/MAIN.SCM", "MODELS/GTA3.IMG", "MODELS/GTA3.DIR",
            "TEXT/AMERICAN.GXT", "ANIM/PED.IFP", "ANIM/CUTS.IMG", "ANIM/CUTS.DIR")
for name in required:
    if name not in files:
        parser.error("Missing " + name)
text_dir = Path(__file__).resolve().parents[2] / "gamefiles" / "TEXT"
supplements = {"TEXT/" + path.name.upper(): path for path in text_dir.glob("*.gxt")}
args.output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
with tempfile.NamedTemporaryFile(dir=args.output.parent, delete=False) as output:
    output.write(b"GTA3" + struct.pack("<I", len(files)))
    for name, source in sorted(files.items()):
        key = name.encode("ascii")
        raw = source.read_bytes()
        if name in supplements:
            raw = add_re3_labels(raw, supplements[name].read_bytes())
        data = zlib.compress(raw, 1)
        output.write(struct.pack("<HII", len(key), len(data), len(raw)))
        output.write(key)
        output.write(data)
os.replace(output.name, args.output)
print(f"{len(files)} game files, {args.output.stat().st_size:,} packed bytes")
