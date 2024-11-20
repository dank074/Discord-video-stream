import { MediaUdp } from "../client/voice/MediaUdp.js";
import { combineLoHi } from "./utils.js";
import { BaseMediaStream } from "./BaseMediaStream.js";
import type { Packet } from "@libav.js/variant-webcodecs";

export class VideoStream extends BaseMediaStream {
    public udp: MediaUdp;
    public count: number;
    public sleepTime: number;
    public startTime?: number;

    private noSleep: boolean;

    constructor(udp: MediaUdp, fps: number = 30, noSleep = false) {
        super({ objectMode: true });
        this.udp = udp;
        this.count = 0;
        this.sleepTime = 1000 / fps;
        this.noSleep = noSleep;
    }

    async _write(frame: Packet, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.count++;
        if (!this.startTime)
            this.startTime = performance.now();

        await this._waitForOtherStream();

        const { data, ptshi, pts, time_base_num, time_base_den } = frame;
        await this.udp.sendVideoFrame(Buffer.from(data));
        if (ptshi !== undefined && pts !== undefined && time_base_num !== undefined && time_base_den !== undefined)
            this.pts = combineLoHi(ptshi, pts) / time_base_den * time_base_num;

        const next = ( (this.count + 1) * this.sleepTime) - (performance.now() - this.startTime);
        if (this.noSleep)
        {
            callback();
        }
        else
        {
            this.timeout = setTimeout(() => {
                callback();
            }, next);
        }
    }
}
