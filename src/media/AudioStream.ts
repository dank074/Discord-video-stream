import { MediaUdp } from "../client/voice/MediaUdp.js";
import { combineLoHi } from "./utils.js";
import { BaseMediaStream } from "./BaseMediaStream.js";
import type { Packet } from "@libav.js/variant-webcodecs";

class AudioStream extends BaseMediaStream {
    public udp: MediaUdp;
    public count: number;
    public sleepTime: number;
    public startTime?: number;

    private noSleep: boolean;

    constructor(udp: MediaUdp, noSleep = false) {
        super({ objectMode: true });
        this.udp = udp;
        this.count = 0;
        this.sleepTime = 20;
        this.noSleep = noSleep;
    }

    async _write(frame: Packet, _: BufferEncoding, callback: (error?: Error | null) => void) {
        this.count++;
        if (!this.startTime)
            this.startTime = performance.now();

        await this._waitForOtherStream();

        const { data, ptshi, pts, time_base_num, time_base_den } = frame;
        await this.udp.sendAudioFrame(Buffer.from(data));
        if (ptshi !== undefined && pts !== undefined && time_base_num !== undefined && time_base_den !== undefined)
            this.pts = combineLoHi(ptshi, pts) / time_base_den * time_base_num;
        
        const next = ((this.count + 1) * this.sleepTime) - (performance.now() - this.startTime);

        if (this.noSleep)
        {
            callback();
        }
        else
        {
            setTimeout(() => {
                callback();
            }, next);
        }
    }
}

export {
    AudioStream
};
