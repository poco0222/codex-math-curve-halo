#import <Foundation/Foundation.h>
#include <math.h>
#include <stdio.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>

// The private aggregate is only a capture transport; it never changes system output.
typedef void (*HaloSamples)(void *, const float *, uint32_t, uint32_t, uint32_t, bool);
typedef struct {
    AudioObjectID tap, aggregate, output;
    AudioDeviceIOProcID io;
    AudioStreamBasicDescription format;
    HaloSamples callback;
    void *context;
} HaloAudio;

static OSStatus property(AudioObjectID object, AudioObjectPropertySelector selector, UInt32 size, void *value) {
    AudioObjectPropertyAddress address = {selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    return AudioObjectGetPropertyData(object, &address, 0, NULL, &size, value);
}
static int failure(OSStatus status) {
    fprintf(stderr, "Codex Halo audio: CoreAudio status=%d\n", (int)status);
    return status == kAudioDevicePermissionsError || status == (OSStatus)'perm' ? 1 : 3;
}
void halo_audio_close(HaloAudio *audio, int32_t *errors) {
    int32_t local[4] = {0};
    if (!errors) errors = local;
    if (!audio) return;
    if (audio->io) {
        errors[0] = AudioDeviceStop(audio->aggregate, audio->io);
        errors[1] = AudioDeviceDestroyIOProcID(audio->aggregate, audio->io);
        // Failed unregister means the OS may still call this address. Rust has
        // disabled processing and retains its paired context until process exit.
        if (errors[1]) return;
    }
    if (audio->aggregate) errors[2] = AudioHardwareDestroyAggregateDevice(audio->aggregate);
    if (@available(macOS 14.2, *)) {
        if (audio->tap) errors[3] = AudioHardwareDestroyProcessTap(audio->tap);
    }
    free(audio);
}
HaloAudio *halo_audio_open(int *error, double *rate, uint32_t *channels) {
    *error = 2;
    if (@available(macOS 14.2, *)) {
        @autoreleasepool {
            HaloAudio *audio = calloc(1, sizeof(HaloAudio));
            if (!audio) { *error = 3; return NULL; }
            OSStatus status = property(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultOutputDevice, sizeof(audio->output), &audio->output);
            CFStringRef uid = NULL;
            if (!status && audio->output) status = property(audio->output, kAudioDevicePropertyDeviceUID, sizeof(uid), &uid);
            if (status || !uid) { *error = failure(status); halo_audio_close(audio, NULL); return NULL; }
            CATapDescription *description = [[CATapDescription alloc] initExcludingProcesses:@[] andDeviceUID:(__bridge NSString *)uid withStream:0];
            CFRelease(uid);
            description.name = @"Codex Halo System Audio";
            description.privateTap = YES;
            description.muteBehavior = CATapUnmuted;
            status = AudioHardwareCreateProcessTap(description, &audio->tap);
            if (!status) status = property(audio->tap, kAudioTapPropertyFormat, sizeof(audio->format), &audio->format);
            if (!status && (audio->format.mFormatID != kAudioFormatLinearPCM ||
                !(audio->format.mFormatFlags & kAudioFormatFlagIsFloat) ||
                (audio->format.mFormatFlags & kAudioFormatFlagIsBigEndian) ||
                audio->format.mBitsPerChannel != 32 || audio->format.mChannelsPerFrame == 0 ||
                audio->format.mChannelsPerFrame > 32 || !isfinite(audio->format.mSampleRate) || audio->format.mSampleRate < 8000)) {
                status = kAudioDeviceUnsupportedFormatError;
            }
            if (!status) {
                NSDictionary *device = @{
                    @kAudioAggregateDeviceNameKey: @"Codex Halo Audio Capture",
                    @kAudioAggregateDeviceUIDKey: NSUUID.UUID.UUIDString,
                    @kAudioAggregateDeviceIsPrivateKey: @YES,
                    @kAudioAggregateDeviceTapAutoStartKey: @YES,
                    @kAudioAggregateDeviceTapListKey: @[@{
                        @kAudioSubTapUIDKey: description.UUID.UUIDString,
                        @kAudioSubTapDriftCompensationKey: @YES
                    }]
                };
                status = AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)device, &audio->aggregate);
            }
            if (status) { *error = failure(status); halo_audio_close(audio, NULL); return NULL; }
            *rate = audio->format.mSampleRate;
            *channels = audio->format.mChannelsPerFrame;
            *error = 0;
            return audio;
        }
    }
    return NULL;
}
static OSStatus samples(AudioObjectID device, const AudioTimeStamp *now, const AudioBufferList *input,
    const AudioTimeStamp *inputTime, AudioBufferList *output, const AudioTimeStamp *outputTime, void *context) {
    (void)device; (void)now; (void)inputTime; (void)output; (void)outputTime;
    HaloAudio *audio = context;
    if (!input || !audio->callback) return noErr;
    UInt32 offset = 0;
    for (UInt32 i = 0; i < input->mNumberBuffers; ++i) {
        const AudioBuffer *buffer = &input->mBuffers[i];
        if (!buffer->mData || !buffer->mNumberChannels || offset + buffer->mNumberChannels > audio->format.mChannelsPerFrame) return noErr;
        audio->callback(audio->context, buffer->mData, buffer->mDataByteSize / sizeof(float),
            buffer->mNumberChannels, offset, i + 1 == input->mNumberBuffers);
        offset += buffer->mNumberChannels;
    }
    return noErr;
}
int halo_audio_start(HaloAudio *audio, HaloSamples callback, void *context) {
    audio->callback = callback;
    audio->context = context;
    OSStatus status = AudioDeviceCreateIOProcID(audio->aggregate, samples, audio, &audio->io);
    if (!status) status = AudioDeviceStart(audio->aggregate, audio->io);
    return status ? failure(status) : 0;
}
int halo_audio_health(HaloAudio *audio) {
    AudioObjectID output = 0;
    OSStatus status = property(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultOutputDevice, sizeof(output), &output);
    if (status || output != audio->output) return status ? failure(status) : 3;
    UInt32 alive = 0;
    status = property(audio->output, kAudioDevicePropertyDeviceIsAlive, sizeof(alive), &alive);
    if (status || !alive) return status ? failure(status) : 3;
    AudioStreamBasicDescription format = {0};
    status = property(audio->tap, kAudioTapPropertyFormat, sizeof(format), &format);
    if (status) return failure(status);
    return format.mSampleRate != audio->format.mSampleRate || format.mChannelsPerFrame != audio->format.mChannelsPerFrame ? 3 : 0;
}
