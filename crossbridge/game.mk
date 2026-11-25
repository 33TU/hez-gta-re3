# src/CMakeLists.txt includes every .cpp under src and generates GitSHA1.cpp.
sources := $(shell find re3/src -type f -name '*.cpp' | LC_ALL=C sort) generated/GitSHA1.cpp
objects := $(patsubst %.cpp,obj/%.o,$(sources))
include_dirs := $(shell find re3/src -type f \( -name '*.cpp' -o -name '*.h' -o -name '*.c' \) -printf '%h\n' | LC_ALL=C sort -u)
gameflags := -O1 -emit-llvm -DNDEBUG -DMASTER -DLIBRW -DRW_NULL -D__STDC_LIMIT_MACROS -DCMAKE_BUILD -DCMAKE_NO_AUTOLINK -DUSE_OUR_VERSIONING
headers := -include host/compat.h -Ire3 -Ilibrw $(addprefix -I,$(include_dirs))
.DELETE_ON_ERROR:

# The Flash host supplies streaming and audio and skips the native startup movies.
platform_objects := obj/re3/src/core/IntroMovie.o obj/re3/src/core/CdStreamPosix.o obj/re3/src/audio/sampman_null.o obj/re3/src/audio/eax/eax-util.o
engine := $(filter-out $(platform_objects),$(objects))
host := $(patsubst %.cpp,obj/%.o,$(wildcard host/*.cpp))
revc-game.swf: $(engine) $(host) avm2/librw.a Console.abc
	$(CXX) $(filter %.o %.a,$^) -symbol-abc=Console.abc -swf-size=640x480 -swf-version=18 -emit-swf -o $@

obj/%.o: %.cpp
	@mkdir -p "$(dir $@)"
	$(CXX) $(gameflags) $(headers) -MMD -MP -MF "$@.d" -c "$<" -o "$@"

-include $(engine:.o=.o.d) $(host:.o=.o.d)
