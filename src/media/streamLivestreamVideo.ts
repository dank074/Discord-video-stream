import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import { IvfTransformer } from "../client/processing/IvfSplitter.js";
import prism from "prism-media";
import { AudioStream } from "./AudioStream.js";
import { MediaUdp } from '../client/voice/MediaUdp.js';
import { StreamOutput } from '@dank074/fluent-ffmpeg-multistream-ts';
import { Readable, Transform } from 'stream';
import { H264NalSplitter, H265NalSplitter } from '../client/processing/AnnexBNalSplitter.js';
import { VideoStream } from './VideoStream.js';
import { normalizeVideoCodec } from '../utils.js';
import PCancelable from 'p-cancelable';

class MediaBuffer {
    private audioBuffer: Array<{ data: Buffer, timestamp: number }> = [];
    private videoBuffer: Array<{ data: Buffer, timestamp: number }> = [];
    private readonly SYNC_THRESHOLD = 25;
    private readonly AUDIO_DELAY = 500;
    private syncInterval: NodeJS.Timeout;
    private startTime: number;

    constructor(private fps: number, private sampleRate: number, private mediaUdp: MediaUdp) {
        this.startTime = Date.now();
        this.syncInterval = setInterval(() => this.sync(), 1000 / fps);
    }

    public addAudioFrame(frame: Buffer) {
        const timestamp = Date.now() - this.startTime;
        this.audioBuffer.push({ data: frame, timestamp });
    }

    public addVideoFrame(frame: Buffer) {
        const timestamp = Date.now() - this.startTime;
        this.videoBuffer.push({ data: frame, timestamp });
    }

    private sync() {
        const currentTime = Date.now() - this.startTime;

        while (this.audioBuffer.length > 0 && this.videoBuffer.length > 0) {
            const audioFrame = this.audioBuffer[0];
            const videoFrame = this.videoBuffer[0];

            const audioTimestamp = audioFrame.timestamp + this.AUDIO_DELAY;
            const videoTimestamp = videoFrame.timestamp;

            //console.log(`Audio TS: ${audioTimestamp}, Video TS: ${videoTimestamp}, Current: ${currentTime}`);

            if (Math.abs(audioTimestamp - videoTimestamp) <= this.SYNC_THRESHOLD) {
                this.sendSyncedFrames(audioFrame.data, videoFrame.data);
                this.audioBuffer.shift();
                this.videoBuffer.shift();
            } else if (audioTimestamp < videoTimestamp) {
                if (audioTimestamp <= currentTime) {
                    this.mediaUdp.sendAudioFrame(audioFrame.data);
                    this.audioBuffer.shift();
                } else {
                    break;
                }
            } else {
                if (videoTimestamp <= currentTime) {
                    this.mediaUdp.sendVideoFrame(videoFrame.data);
                    this.videoBuffer.shift();
                } else {
                    break;
                }
            }
        }

        // Verwerfen Sie alte Frames
        while (this.audioBuffer.length > 0 && this.audioBuffer[0].timestamp + this.AUDIO_DELAY < currentTime - 1000) {
            this.audioBuffer.shift();
        }
        while (this.videoBuffer.length > 0 && this.videoBuffer[0].timestamp < currentTime - 1000) {
            this.videoBuffer.shift();
        }
    }

    private sendSyncedFrames(audioFrame: Buffer, videoFrame: Buffer) {
        this.mediaUdp.sendAudioFrame(audioFrame);
        this.mediaUdp.sendVideoFrame(videoFrame);
    }

    public stop() {
        clearInterval(this.syncInterval);
    }
}

export function streamLivestreamVideo(input: string | Readable, mediaUdp: MediaUdp, includeAudio = true, customHeaders?: map) {
    return new PCancelable<string>(async (resolve, reject, onCancel) => {
        const streamOpts = mediaUdp.mediaConnection.streamOptions;
        const videoStream: VideoStream = new VideoStream(mediaUdp, streamOpts.fps, streamOpts.readAtNativeFps);
        const videoCodec = normalizeVideoCodec(streamOpts.videoCodec);
        const mediaBuffer = new MediaBuffer(streamOpts.fps, 48000, mediaUdp);
        let videoOutput: Transform;

        switch(videoCodec) {
            case 'H264':
                videoOutput = new H264NalSplitter();
                break;
            case 'H265':
                videoOutput = new H265NalSplitter();
                break;
            case "VP8":
                videoOutput = new IvfTransformer();
                break;
            default:
                throw new Error("Codec not supported");
        }

        let headers: map = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3",
            "Connection": "keep-alive"
        }

        headers = { ...headers, ...(customHeaders ?? {}) };

        let isHttpUrl = false;
        let isHls = false;

        if (typeof input === "string") {
            isHttpUrl = input.startsWith('http') || input.startsWith('https');
            isHls = input.includes('m3u');
        }

        try {
            const command = ffmpeg(input)
                .addOption('-loglevel', '0')
                .on('end', () => {
                    resolve("video ended")
                })
                .on("error", (err, stdout, stderr) => {
                    reject('cannot play video ' + err.message)
                })
                .on('stderr', console.error);

            if (videoCodec === 'VP8') {
                command.output(StreamOutput(videoOutput).url, { end: false })
                    .noAudio()
                    .size(`${streamOpts.width}x${streamOpts.height}`)
                    .fpsOutput(streamOpts.fps)
                    .videoBitrate(`${streamOpts.bitrateKbps}k`)
                    .format('ivf')
                    .outputOption('-deadline', 'realtime');
            } else if (videoCodec === "H265") {
                command.output(StreamOutput(videoOutput).url, { end: false })
                    .noAudio()
                    .size(`${streamOpts.width}x${streamOpts.height}`)
                    .fpsOutput(streamOpts.fps)
                    .videoBitrate(`${streamOpts.bitrateKbps}k`)
                    .format('hevc')
                    .outputOptions([
                        '-tune zerolatency',
                        '-pix_fmt yuv420p',
                        `-preset ${streamOpts.h26xPreset}`,
                        '-profile:v main',
                        `-g ${streamOpts.fps}`,
                        `-bf 0`,
                        `-x265-params keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
                        '-bsf:v hevc_metadata=aud=insert'
                    ]);
            } else {
                command.output(StreamOutput(videoOutput).url, { end: false })
                    .noAudio()
                    .size(`${streamOpts.width}x${streamOpts.height}`)
                    .fpsOutput(streamOpts.fps)
                    .videoBitrate(`${streamOpts.bitrateKbps}k`)
                    .format('h264')
                    .outputOptions([
                        '-tune zerolatency',
                        '-pix_fmt yuv420p',
                        `-preset ${streamOpts.h26xPreset}`,
                        '-profile:v baseline',
                        `-g ${streamOpts.fps}`,
                        `-bf 0`,
                        `-x264-params keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
                        '-bsf:v h264_metadata=aud=insert'
                    ]);
            }

            //videoOutput.pipe(videoStream, { end: false });
            videoOutput.on('data', (chunk) => {
                mediaBuffer.addVideoFrame(chunk);
            });

            if (includeAudio) {
                const audioStream: AudioStream = new AudioStream(mediaUdp, streamOpts.readAtNativeFps);

                // make opus stream
                const opus = new prism.opus.Encoder({ channels: 2, rate: 48000, frameSize: 960 });

                command
                    .output(StreamOutput(opus).url, { end: false })
                    .noVideo()
                    .audioChannels(2)
                    .audioFrequency(48000)
                    //.audioBitrate('128k')
                    .format('s16le');

                //opus.pipe(audioStream, { end: false });
                opus.on('data', (chunk) => {
                    mediaBuffer.addAudioFrame(chunk);
                });
            }

            if (streamOpts.hardwareAcceleratedDecoding) command.inputOption('-hwaccel', 'auto');

            if(streamOpts.readAtNativeFps) command.inputOption('-re')

            if(streamOpts.minimizeLatency) {
                command.addOptions([
                    '-fflags nobuffer',
                    '-analyzeduration 0'
                ])
            }

            if (isHttpUrl) {
                command.inputOption('-headers',
                    Object.keys(headers).map(key => key + ": " + headers[key]).join("\r\n")
                );
                if (!isHls) {
                    command.inputOptions([
                        '-reconnect 1',
                        '-reconnect_at_eof 1',
                        '-reconnect_streamed 1',
                        '-reconnect_delay_max 4294'
                    ]);
                }
            }

            command.run();
            onCancel(() => command.kill("SIGINT"));
        } catch (e) {
            //audioStream.end();
            //videoStream.end();
            reject("cannot play video " + (e as Error).message);
        }
    })
}

export function getInputMetadata(input: string | Readable): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
        const instance = ffmpeg(input).on('error', (err, stdout, stderr) => reject(err));

        instance.ffprobe((err, metadata) => {
            if (err) reject(err);
            instance.removeAllListeners();
            resolve(metadata);
            instance.kill('SIGINT');
        });
    })
}

export function inputHasAudio(metadata: ffmpeg.FfprobeData) {
    return metadata.streams.some((value) => value.codec_type === 'audio');
}

export function inputHasVideo(metadata: ffmpeg.FfprobeData) {
    return metadata.streams.some((value) => value.codec_type === 'video');
}

type map = {
    [key: string]: string;
};
