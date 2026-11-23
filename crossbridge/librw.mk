# The pinned librw null backend includes the portable native raster readers.
sources := $(wildcard librw/src/*.cpp librw/src/d3d/*.cpp librw/src/gl/*.cpp librw/src/ps2/*.cpp librw/src/lodepng/*.cpp)
objects := $(patsubst librw/%.cpp,$(objdir)/%.o,$(sources))
flags := -DRW_NULL -DNDEBUG -DLODEPNG_NO_COMPILE_CPP -O1

$(objdir)/librw.a: $(objects)
	$(AR) rcs $@ $^

$(objdir)/%.o: librw/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(flags) $(CXXFLAGS) -c $< -o $@
