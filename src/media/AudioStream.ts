import { MediaUdp } from "../client/voice/MediaUdp.js";
import { combineLoHi } from "./utils.js";
import { BaseMediaStream } from "./BaseMediaStream.js";
import type { Packet } from "@libav.js/variant-webcodecs";

class AudioStream extends BaseMediaStream {
    public udp: MediaUdp;

    constructor(udp: MediaUdp) {
        super({ objectMode: true });
        this.udp = udp;
    }

    async _write(frame: Packet, _: BufferEncoding, callback: (error?: Error | null) => void) {
        await this._waitForOtherStream();

        const { data, ptshi, pts, time_base_num, time_base_den } = frame;
        await this.udp.sendAudioFrame(Buffer.from(data));
        if (ptshi !== undefined && pts !== undefined && time_base_num !== undefined && time_base_den !== undefined)
            this.pts = combineLoHi(ptshi, pts) / time_base_den * time_base_num;

        callback();
    }
}

export {
    AudioStream
};
