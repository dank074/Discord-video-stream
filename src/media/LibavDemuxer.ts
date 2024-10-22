import LibAV from "@libav.js/variant-webcodecs";
import { uid } from "uid";
import { AVCodecID } from "./LibavCodecId.js";
import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";

let libavPromise: Promise<LibAV.LibAV>;

const allowedVideoCodec = new Set([
    AVCodecID.AV_CODEC_ID_H264,
    AVCodecID.AV_CODEC_ID_H265,
    AVCodecID.AV_CODEC_ID_VP8,
    AVCodecID.AV_CODEC_ID_VP9,
    AVCodecID.AV_CODEC_ID_AV1
]);

const allowedAudioCodec = new Set([
    AVCodecID.AV_CODEC_ID_OPUS
]);

export async function demux(input: Readable) {
    if (!libavPromise)
        // @ts-expect-error
        libavPromise = LibAV.LibAV({ yesthreads: true });
    const libav = await libavPromise;
    const filename = uid();
    await libav.mkreaderdev(filename);

    const ondata = (chunk: Buffer) => libav.ff_reader_dev_send(filename, chunk);
    const onend = () => libav.ff_reader_dev_send(filename, null);
    input.on("data", ondata);
    input.on("end", onend);

    const [fmt_ctx, streams] = await libav.ff_init_demuxer_file(filename, "matroska");
    const pkt = await libav.av_packet_alloc();

    const cleanup = () => {
        input.off("data", ondata);
        input.off("end", onend);
        libav.avformat_close_input_js(fmt_ctx);
        libav.av_packet_free(pkt);
        libav.unlink(filename);
    }

    const vStream = streams.find((stream) => stream.codec_type == libav.AVMEDIA_TYPE_VIDEO)
    const aStream = streams.find((stream) => stream.codec_type == libav.AVMEDIA_TYPE_AUDIO)
    let vInfo = null, aInfo = null;

    if (vStream) {
        if (!allowedVideoCodec.has(vStream.codec_id))
        {
            const codecName = await libav.avcodec_get_name(vStream.codec_id);
            cleanup();
            throw new Error(`Video codec ${codecName} is not allowed`)
        }
        vInfo = {
            index: vStream.index,
            codec: vStream.codec_id,
            framerate_num: await libav.AVCodecParameters_framerate_num(vStream.codecpar),
            framerate_den: await libav.AVCodecParameters_framerate_den(vStream.codecpar),
            stream: new PassThrough({ objectMode: true })
        }
    }
    if (aStream) {
        if (!allowedAudioCodec.has(aStream.codec_id))
        {
            const codecName = await libav.avcodec_get_name(aStream.codec_id);
            cleanup();
            throw new Error(`Audio codec ${codecName} is not allowed`);
        }
        aInfo = {
            index: aStream.index,
            codec: aStream.codec_id,
            sample_rate: await libav.AVCodecParameters_sample_rate(aStream.codecpar),
            stream: new PassThrough({ objectMode: true })
        }
    }

    (async () => {
        while (true)
        {
            const [status, streams] = await libav.ff_read_frame_multi(fmt_ctx, pkt, {
                limit: 16 * 1024,
                unify: true
            });
            for (const packet of streams[0])
            {
                if (vInfo && vInfo.index === packet.stream_index)
                    vInfo.stream.push(packet);
                else if (aInfo && aInfo.index === packet.stream_index)
                    aInfo.stream.push(packet);
            }
            if (status < 0 && status != -libav.EAGAIN) {
                // End of file, or some error happened
                vInfo?.stream.end();
                aInfo?.stream.end();
                cleanup();
                return;
            }
        }
    })();
    return { video: vInfo, audio: aInfo }
}
