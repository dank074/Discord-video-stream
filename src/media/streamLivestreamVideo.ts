import ffmpeg from 'fluent-ffmpeg';
import { IvfTransformer }from "./IvfReader";
import prism from "prism-media";
import { AudioStream } from "./AudioStream";
import { MediaUdp } from '../client/voice/MediaUdp';
import { StreamOutput } from '@dank074/fluent-ffmpeg-multistream-ts';
import { streamOpts } from '../client/StreamOpts';
import { Readable, Transform } from 'stream';
import { H264NalSplitter } from './H264NalSplitter';
import { VideoStream } from './VideoStream';

export let command: ffmpeg.FfmpegCommand;

export function streamLivestreamVideo(input: string | Readable, mediaUdp: MediaUdp, includeAudio = true, copyH264Codec=false) {
    return new Promise<string>((resolve, reject) => {
        const videoStream: VideoStream = new VideoStream(mediaUdp, streamOpts.fps);
        
        let videoOutput: Transform;

        if(streamOpts.video_codec === 'H264') {
            videoOutput = new H264NalSplitter();
        } else {
            videoOutput = new IvfTransformer();
        }

        const headers: map = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3",
            "Connection": "keep-alive"
        }

        let isHttpUrl = false;
        let isHls = false;

        if(typeof input === "string")
        {
            isHttpUrl = input.startsWith('http') || input.startsWith('https');
            isHls = input.includes('m3u');
        }        

        try {
            command = ffmpeg(input)
            .addOption('-loglevel', '0')
            .addOption('-fflags', 'nobuffer')
            .addOption('-analyzeduration', '0')
            .on('end', () => {
                command = undefined;
                resolve("video ended")
            })
            .on("error", (err, stdout, stderr) => {
                command = undefined;
                reject('cannot play video ' + err.message)
            })
            .on('stderr', console.error);

            if(streamOpts.video_codec === 'VP8') {
                command.output(StreamOutput(videoOutput).url, { end: false })
                .noAudio()
                .size(`${streamOpts.width}x${streamOpts.height}`)
                .fpsOutput(streamOpts.fps)
                .videoBitrate(`${streamOpts.bitrateKbps}k`)
                .format('ivf')
                .outputOption('-deadline', 'realtime');
            } else {
                if(copyH264Codec) {
                    command.output(StreamOutput(videoOutput).url, { end: false })
                    .noAudio()
                    .videoCodec('copy')
                    .format('h264')
                    .outputOptions([
                        '-bsf:v h264_metadata=aud=insert'
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
                        '-preset ultrafast',
                        '-profile:v baseline',
                        `-g ${streamOpts.fps}`,
                        `-x264-params keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
                        '-bsf:v h264_metadata=aud=insert'
                    ]);
                }
            }

            videoOutput.pipe(videoStream, { end: false});
            
            if(includeAudio) {
                const audioStream: AudioStream = new AudioStream(mediaUdp);
        
                // make opus stream
                const opus = new prism.opus.Encoder({ channels: 2, rate: 48000, frameSize: 960 });
            
                command
                .output(StreamOutput(opus).url, { end: false})
                .noVideo()
                .audioChannels(2)
                .audioFrequency(48000)
                //.audioBitrate('128k')
                .format('s16le');

                opus.pipe(audioStream, {end: false});
            }
            
            if(streamOpts.hardware_acceleration) command.inputOption('-hwaccel', 'auto');
            
            if(isHttpUrl) {
                command.inputOption('-headers', 
                    Object.keys(headers).map(key => key + ": " + headers[key]).join("\r\n")
                );
                if(!isHls) {
                    command.inputOptions([
                        '-reconnect 1',
                        '-reconnect_at_eof 1',
                        '-reconnect_streamed 1',
                        '-reconnect_delay_max 4294'
                    ]);
                }
            }
            
            command.run();
        } catch(e) {
            //audioStream.end();
            //videoStream.end();
            command = undefined;
            reject("cannot play video " + e.message);
        }
    })
}

export function getInputMetadata(input: string | Readable): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve,reject) => {
        const instance = ffmpeg(input).on('error', (err, stdout, stderr) => reject(err));
        
        instance.ffprobe((err, metadata) => {
            if(err) reject(err);
            instance.removeAllListeners();
            resolve(metadata);
            instance.kill('SIGINT');
        });
    })
}

export function inputHasAudio(metadata: ffmpeg.FfprobeData) {
    return metadata.streams.some( (value) => value.codec_type === 'audio');
}

export function inputHasVideo(metadata: ffmpeg.FfprobeData) {
    return metadata.streams.some( (value) => value.codec_type === 'video');
}

type map = {
    [key: string]: string;
  };