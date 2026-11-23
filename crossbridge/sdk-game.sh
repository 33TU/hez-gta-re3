#!/usr/bin/env bash
set -euo pipefail
sdk=$FLASCC/usr/lib
java -jar "$sdk/asc2.jar" -merge -md -AS3 -strict \
    -import "$sdk/builtin.abc" -import "$sdk/ISpecialFile.abc" -import "$sdk/IVFS.abc" \
    -import "$sdk/Exit.abc" -import "$sdk/CModule.abc" -import "$sdk/playerglobal.abc" host/Console.as -outdir . -out Console
test -s Console.abc
make -f librw.mk -j4 CXX="$FLASCC/usr/bin/g++" AR="$FLASCC/usr/bin/ar" objdir=avm2 CXXFLAGS=-emit-llvm
make -f game.mk -j6 CXX="$FLASCC/usr/bin/g++" re3-game.swf
