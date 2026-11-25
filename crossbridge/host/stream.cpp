#include "common.h"
#include "CdStream.h"
#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>

static FILE *images[MAX_CDIMAGES];
static char paths[MAX_CDIMAGES][256];
static int imageCount, lastSector;
static uint32 imageSize;
#ifdef FLUSHABLE_STREAMING
bool flushStream[MAX_CDCHANNELS];
#endif

void
CdStreamInit(int32)
{
}

void
CdStreamRemoveImages()
{
	while(imageCount)
		fclose(images[--imageCount]);
	imageSize = 0;
}

void
CdStreamShutdown()
{
	CdStreamRemoveImages();
}

bool
CdStreamAddImage(const char *name)
{
	if(imageCount >= MAX_CDIMAGES || strlen(name) + 2 > sizeof(paths[0]))
		return false;
	char *path = paths[imageCount];
	path[0] = '/';
	for(size_t i = 0; i <= strlen(name); ++i)
		path[i + 1] = name[i] == '\\' ? '/' : toupper((uint8)name[i]);
	FILE *f = fopen(path, "rb");
	if(!f)
		return false;
	if(!imageCount) {
		fseek(f, 0, SEEK_END);
		imageSize = ftell(f);
	}
	images[imageCount++] = f;
	return true;
}

uint32
GetGTA3ImgSize()
{
	return imageSize;
}

int32
CdStreamGetNumImages()
{
	return imageCount;
}

char *
CdStreamGetImageName(int32 n)
{
	return n >= 0 && n < imageCount ? paths[n] : nil;
}

int32
CdStreamGetLastPosn()
{
	return lastSector;
}

int32
CdStreamGetStatus(int32)
{
	return STREAM_NONE;
}

int32
CdStreamSync(int32)
{
	return STREAM_NONE;
}

int32
CdStreamRead(int32 channel, void *dst, uint32 sector, uint32 count)
{
	uint32 index = _GET_INDEX(sector);
	if(index >= (uint32)imageCount || channel < 0 || channel >= MAX_CDCHANNELS ||
	   fseek(images[index], _GET_OFFSET(sector) * CDSTREAM_SECTOR_SIZE, SEEK_SET) ||
	   fread(dst, CDSTREAM_SECTOR_SIZE, count, images[index]) != count) {
		fprintf(stderr, "Unreadable IMG region %u + %u\n", sector, count);
		exit(1);
	}
	lastSector = sector + count;
	return STREAM_SUCCESS;
}
