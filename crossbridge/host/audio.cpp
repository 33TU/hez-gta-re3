// GTA's sample manager backed by Flash's 44.1 kHz stereo SampleDataEvent.
#include "common.h"
#include "sampman.h"
#include "AudioManager.h"
#include "MusicManager.h"
#include <AS3/AS3.h>
#include <ctype.h>
#include <math.h>
#include <stdio.h>

cSampleManager SampleManager;
bool8 _bSampmanInitialised;
uint32 BankStartOffset[MAX_SFX_BANKS], nNumMP3s;

namespace
{
const int outputRate = 44100, mixFrames = 4096, chunkFrames = 22050 * 4;
const uint8 *bank;
uint32 bankBytes;
const int16 *pcm;
bool banks[MAX_SFX_BANKS];
float effectsGain, musicGain;
bool mono;
float output[mixFrames * 2];

struct Voice
{
	const int16 *samples;
	int length, loopStart, loopEnd;
	uint32 loops;
	double cursor, step;
	float volume, pan, distance, x, minDist, maxDist;
	bool positional, playing;
} voices[NUM_CHANNELS];

struct Track
{
	char name[16];
	uint32 frames;
};

Track tracks[TOTAL_STREAMED_SOUNDS];

struct Chunk
{
	int index, ready;
	int16 samples[chunkFrames * 2];
};

struct Stream
{
	const Track *track;
	uint32 cursor; // In output frames. Each input frame produces two output frames.
	float volume, pan;
	bool effects, playing, paused;
	Chunk cache[2];
} streams[MAX_STREAMS];

float
unitVolume(uint32 level)
{
	return Min(level, (uint32)MAX_VOLUME) / float(MAX_VOLUME);
}

float
panValue(uint32 pan)
{
	return Clamp((int(pan) - 63) / 63.f, -1.f, 1.f);
}

void
levels(float gain, float pan, float &left, float &right)
{
	if(mono)
		pan = 0;
	left = gain * (1.f - Max(0.f, pan));
	right = gain * (1.f + Min(0.f, pan));
}

void
mixVoice(Voice &v, float masterGain)
{
	float pan = v.pan, gain = v.volume * masterGain;
	if(v.positional) {
		// re3 passes ordinary camera-space positions, or a synthetic X for a 2D sound.
		if(v.maxDist >= 100000.f)
			pan = Clamp(v.x / 1000.f, -1.f, 1.f);
		else {
			if(v.distance > .01f)
				pan = Clamp(-v.x / v.distance, -1.f, 1.f);
			if(v.distance > v.minDist && v.maxDist > v.minDist)
				gain *= Max(0.f, (v.maxDist - v.distance) / (v.maxDist - v.minDist));
		}
	}
	float left, right;
	levels(gain / 32768.f, pan, left, right);
	for(int i = 0; i < mixFrames; ++i) {
		int end = v.loops == 1 ? v.length : v.loopEnd;
		if(v.cursor >= end) {
			if(v.loops == 1) {
				v.playing = false;
				break;
			}
			if(v.loops > 1)
				--v.loops;
			v.cursor = v.loopStart + fmod(v.cursor - end, double(end - v.loopStart));
		}
		int index = int(v.cursor);
		int next = index + 1;
		if(next == end)
			next = v.loops == 1 ? index : v.loopStart;
		float sample = v.samples[index] + (v.samples[next] - v.samples[index]) * float(v.cursor - index);
		output[2 * i] += left * sample;
		output[2 * i + 1] += right * sample;
		v.cursor += v.step;
	}
}

void
mixStream(Stream &s)
{
	float left, right;
	levels(s.volume * (s.effects ? effectsGain : musicGain) / 32768.f, s.pan, left, right);
	for(int i = 0; i < mixFrames; ++i) {
		uint32 frame = s.cursor / 2;
		if(frame >= s.track->frames) {
			s.playing = false;
			break;
		}
		int index = frame / chunkFrames;
		Chunk &chunk = s.cache[index % 2];
		if(chunk.index != index || !chunk.ready)
			break; // Wait for local I/O.
		if(chunk.ready < 0) {
			s.playing = false;
			break;
		}
		const int16 *src = &chunk.samples[(frame % chunkFrames) * 2];
		float l = src[0], r = src[1];
		if((s.cursor & 1) && frame + 1 < s.track->frames) {
			const int16 *next = src;
			if((frame + 1) % chunkFrames != 0)
				next = src + 2;
			else {
				const Chunk &following = s.cache[(index + 1) % 2];
				if(following.index == index + 1 && following.ready > 0)
					next = following.samples;
			}
			l = .5f * (l + next[0]);
			r = .5f * (r + next[1]);
		}
		if(mono)
			l = r = .5f * (l + r);
		output[2 * i] += left * l;
		output[2 * i + 1] += right * r;
		++s.cursor;
	}
}
} // namespace

void
configureGameAudio(const uint8 *data, uint32 size)
{
	bank = data;
	bankBytes = size;
}

int
mixGameAudio()
{
	memset(output, 0, sizeof(output));
	float gain = effectsGain;
	if(MusicManager.GetMusicMode() == MUSICMODE_CUTSCENE &&
	   MusicManager.GetNextTrack() != STREAMED_SOUND_NEWS_INTRO &&
	   MusicManager.GetNextTrack() != STREAMED_SOUND_CUTSCENE_SAL4_BDBD)
		gain *= .25f;
	for(int i = 0; i < NUM_CHANNELS; ++i)
		if(voices[i].playing)
			mixVoice(voices[i], gain);
	for(int i = 0; i < MAX_STREAMS; ++i)
		if(streams[i].playing && !streams[i].paused)
			mixStream(streams[i]);
	for(size_t i = 0; i < ARRAY_SIZE(output); ++i)
		output[i] = Clamp(output[i], -1.f, 1.f);
	return (int)output;
}

void
serviceGameAudio()
{
	for(int i = 0; i < MAX_STREAMS; ++i) {
		Stream &s = streams[i];
		if(!s.track)
			continue;
		int first = s.cursor / 2 / chunkFrames;
		for(int block = first; block <= first + 1; ++block) {
			uint32 start = block * chunkFrames;
			if(start >= s.track->frames)
				break;
			Chunk &c = s.cache[block % 2];
			if(c.index == block)
				continue;
			c.index = block;
			c.ready = 0;
			int bytes = 4 * Min(uint32(chunkFrames), s.track->frames - start);
			inline_as3(
			    "import com.adobe.flascc.CModule; Object(CModule.vfs.console).audioChunk(%0,CModule.readString(%1,16),%2,%3,%4,%5);"
			    :
			    : "r"(2 * i + block % 2), "r"(s.track->name), "r"(block), "r"(c.samples), "r"(&c.ready),
			      "r"(bytes));
		}
	}
}

cSampleManager::cSampleManager()
{
}

cSampleManager::~cSampleManager()
{
}

bool8
cSampleManager::InitialiseSampleBanks()
{
	if(!bank || bankBytes < 16 || memcmp(bank, "G3A1", 4))
		return false;
	const uint32 *header = (const uint32 *)bank;
	uint32 count = header[1], numTracks = header[2], rawBytes = header[3];
	if(count != TOTAL_AUDIO_SAMPLES || numTracks > 1024 ||
	   16 + uint64(count) * sizeof(tSample) + uint64(numTracks) * sizeof(Track) + rawBytes != bankBytes)
		return false;
	memcpy(m_aSamples, bank + 16, sizeof(m_aSamples));
	const Track *entries = (const Track *)(bank + 16 + sizeof(m_aSamples));
	for(uint32 i = 0; i < count; ++i) {
		const tSample &s = m_aSamples[i];
		if((s.nOffset | s.nSize) & 1 || s.nOffset > rawBytes || s.nSize > rawBytes - s.nOffset)
			return false;
	}
	for(int t = 0; t < TOTAL_STREAMED_SOUNDS; ++t) {
		char name[16] = {};
		const char *src = strrchr(StreamedNameTable[t], '\\') + 1;
		for(int k = 0; k < 15 && src[k] && src[k] != '.'; ++k)
			name[k] = tolower(src[k]);
		for(uint32 j = 0; j < numTracks; ++j)
			if(!strncmp(name, entries[j].name, sizeof(name)) && entries[j].frames <= 0x3fffffffu) {
				tracks[t] = entries[j];
				break;
			}
	}
	pcm = (const int16 *)(entries + numTracks);
	printf("Flash audio: %u effects, %u stream assets\n", count, numTracks);
	return true;
}

bool8
cSampleManager::Initialise()
{
	// A missing optional bank retains gameplay and the engine's silent fallback.
	if(!InitialiseSampleBanks())
		printf("Flash audio: no compatible effects bank\n");
	banks[SFX_BANK_0] = pcm != NULL;
	m_nEffectsVolume = m_nEffectsFadeVolume = m_nMusicVolume = m_nMusicFadeVolume = MAX_VOLUME;
	UpdateEffectsVolume();
	_bSampmanInitialised = true;
	return true;
}

void
cSampleManager::Terminate()
{
	memset(voices, 0, sizeof(voices));
	for(int i = 0; i < MAX_STREAMS; ++i)
		StopStreamedFile(i);
	_bSampmanInitialised = false;
}

void
cSampleManager::SetSpeakerConfig(int32)
{
}

uint32
cSampleManager::GetMaximumSupportedChannels()
{
	return MAXCHANNELS;
}

uint32
cSampleManager::GetNum3DProvidersAvailable()
{
	return 1;
}

void
cSampleManager::SetNum3DProvidersAvailable(uint32)
{
}

char *
cSampleManager::Get3DProviderName(uint8)
{
	static char name[] = "Flash stereo";
	return name;
}

void
cSampleManager::Set3DProviderName(uint8, char *)
{
}

int8
cSampleManager::GetCurrent3DProviderIndex()
{
	return 0;
}

int8
cSampleManager::SetCurrent3DProvider(uint8)
{
	return 0;
}

bool8
cSampleManager::IsMP3RadioChannelAvailable()
{
	return false;
}

void
cSampleManager::ReleaseDigitalHandle()
{
}

void
cSampleManager::ReacquireDigitalHandle()
{
}

bool8
cSampleManager::CheckForAnAudioFileOnCD()
{
	return true;
}

char
cSampleManager::GetCDAudioDriveLetter()
{
	return 0;
}

void
cSampleManager::UpdateEffectsVolume()
{
	effectsGain = unitVolume(m_nEffectsVolume) * unitVolume(m_nEffectsFadeVolume);
	musicGain = unitVolume(m_nMusicVolume) * unitVolume(m_nMusicFadeVolume);
}

void
cSampleManager::SetEffectsMasterVolume(uint8 v)
{
	m_nEffectsVolume = v;
	UpdateEffectsVolume();
}

void
cSampleManager::SetMusicMasterVolume(uint8 v)
{
	m_nMusicVolume = v;
	UpdateEffectsVolume();
}

void
cSampleManager::SetEffectsFadeVolume(uint8 v)
{
	m_nEffectsFadeVolume = v;
	UpdateEffectsVolume();
}

void
cSampleManager::SetMusicFadeVolume(uint8 v)
{
	m_nMusicFadeVolume = v;
	UpdateEffectsVolume();
}

void
cSampleManager::SetMonoMode(uint8 v)
{
	mono = v;
}

bool8
cSampleManager::LoadSampleBank(uint8 b)
{
	return banks[b] = pcm != NULL;
}

void
cSampleManager::UnloadSampleBank(uint8 b)
{
	banks[b] = false;
}

int8
cSampleManager::IsSampleBankLoaded(uint8 b)
{
	return banks[b] ? LOADING_STATUS_LOADED : LOADING_STATUS_NOT_LOADED;
}

uint8
cSampleManager::IsPedCommentLoaded(uint32 id)
{
	return pcm && id < TOTAL_AUDIO_SAMPLES ? LOADING_STATUS_LOADED : LOADING_STATUS_NOT_LOADED;
}

bool8
cSampleManager::LoadPedComment(uint32 id)
{
	return IsPedCommentLoaded(id) == LOADING_STATUS_LOADED;
}

int32
cSampleManager::GetBankContainingSound(uint32 id)
{
	return id >= BankStartOffset[SFX_BANK_PED_COMMENTS] ? SFX_BANK_PED_COMMENTS : SFX_BANK_0;
}

uint32
cSampleManager::GetSampleBaseFrequency(uint32 id)
{
	return m_aSamples[id].nFrequency;
}

uint32
cSampleManager::GetSampleLoopStartOffset(uint32 id)
{
	return m_aSamples[id].nLoopStart;
}

int32
cSampleManager::GetSampleLoopEndOffset(uint32 id)
{
	return m_aSamples[id].nLoopEnd;
}

uint32
cSampleManager::GetSampleLength(uint32 id)
{
	return m_aSamples[id].nSize / 2;
}

bool8
cSampleManager::UpdateReverb()
{
	return false;
}

void
cSampleManager::SetChannelReverbFlag(uint32, bool8)
{
}

bool8
cSampleManager::InitialiseChannel(uint32 ch, uint32 id, uint8 b)
{
	if(!pcm || id >= TOTAL_AUDIO_SAMPLES || !m_aSamples[id].nSize || (b != SFX_BANK_PED_COMMENTS && !banks[b]))
		return false;
	const tSample &sample = m_aSamples[id];
	Voice &v = voices[ch];
	memset(&v, 0, sizeof(v));
	v.samples = pcm + sample.nOffset / 2;
	v.length = v.loopEnd = sample.nSize / 2;
	v.loops = 1;
	v.volume = 1;
	SetChannelFrequency(ch, sample.nFrequency);
	return true;
}

void
cSampleManager::SetChannelEmittingVolume(uint32 ch, uint32 v)
{
	voices[ch].volume = unitVolume(v);
}

void
cSampleManager::SetChannel3DPosition(uint32 ch, float x, float y, float z)
{
	voices[ch].positional = true;
	voices[ch].x = x;
	voices[ch].distance = sqrtf(x * x + y * y + z * z);
}

void
cSampleManager::SetChannel3DDistances(uint32 ch, float farDist, float nearDist)
{
	voices[ch].minDist = nearDist;
	voices[ch].maxDist = farDist;
}

void
cSampleManager::SetChannelVolume(uint32 ch, uint32 v)
{
	voices[ch].volume = unitVolume(v);
}

void
cSampleManager::SetChannelPan(uint32 ch, uint32 pan)
{
	voices[ch].pan = panValue(pan);
}

void
cSampleManager::SetChannelFrequency(uint32 ch, uint32 rate)
{
	voices[ch].step = double(rate) / outputRate;
}

void
cSampleManager::SetChannelLoopPoints(uint32 ch, uint32 start, int32 end)
{
	Voice &v = voices[ch];
	v.loopEnd = end > 0 ? Min(v.length, end / 2) : v.length;
	v.loopStart = start / 2 < uint32(v.loopEnd) ? start / 2 : 0;
	if(!v.loopEnd)
		v.loopEnd = v.length;
}

void
cSampleManager::SetChannelLoopCount(uint32 ch, uint32 count)
{
	voices[ch].loops = count;
}

bool8
cSampleManager::GetChannelUsedFlag(uint32 ch)
{
	return voices[ch].playing;
}

void
cSampleManager::StartChannel(uint32 ch)
{
	voices[ch].playing = voices[ch].samples != NULL;
}

void
cSampleManager::StopChannel(uint32 ch)
{
	voices[ch].playing = false;
}

void
cSampleManager::PreloadStreamedFile(uint8 id, uint8 slot)
{
	StopStreamedFile(slot);
	if(id >= TOTAL_STREAMED_SOUNDS || !tracks[id].frames)
		return;
	Stream &s = streams[slot];
	s.track = &tracks[id];
	s.cursor = 0;
	s.cache[0].index = s.cache[1].index = -1;
}

void
cSampleManager::StartPreloadedStreamedFile(uint8 slot)
{
	Stream &s = streams[slot];
	s.playing = s.track != NULL;
}

bool8
cSampleManager::StartStreamedFile(uint8 id, uint32 ms, uint8 slot)
{
	PreloadStreamedFile(id, slot);
	Stream &s = streams[slot];
	if(!s.track)
		return false;
	s.cursor = uint32(fmod(double(ms) * (outputRate / 1000.), 2. * s.track->frames));
	StartPreloadedStreamedFile(slot);
	return true;
}

void
cSampleManager::StopStreamedFile(uint8 slot)
{
	streams[slot].track = NULL;
	streams[slot].playing = false;
	streams[slot].paused = false;
}

void
cSampleManager::PauseStream(bool8 paused, uint8 slot)
{
	streams[slot].paused = paused;
}

bool8
cSampleManager::IsStreamPlaying(uint8 slot)
{
	return streams[slot].playing;
}

int32
cSampleManager::GetStreamedFilePosition(uint8 slot)
{
	return int(streams[slot].cursor * (1000. / outputRate));
}

int32
cSampleManager::GetStreamedFileLength(uint8 id)
{
	return Max(1, int(tracks[id].frames * (2000. / outputRate)));
}

void
cSampleManager::SetStreamedVolumeAndPan(uint8 v, uint8 pan, uint8 effect, uint8 slot)
{
	Stream &s = streams[slot];
	s.volume = unitVolume(v);
	s.pan = panValue(pan);
	s.effects = effect;
}
