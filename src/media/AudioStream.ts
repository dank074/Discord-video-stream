import { setImmediate } from "timers/promises";
import { MediaUdp } from "../client/voice/MediaUdp.js";
import { combineLoHi } from "./utils.js";
import { BaseMediaStream } from "./BaseMediaStream.js";
import type { Packet } from "@libav.js/variant-webcodecs";

class AudioStream extends BaseMediaStream {
    public udp: MediaUdp;
    public count: number;
    public sleepTime: number;
    public startTime?: number;
    public syncStream?: BaseMediaStream;

    private noSleep: boolean;
    private _syncTolerance: number = 0;

    constructor(udp: MediaUdp, noSleep = false) {
        super({ objectMode: true });
        this.udp = udp;
        this.count = 0;
        this.sleepTime = 20;
        this.noSleep = noSleep;
    }

    get syncTolerance() {
        return this._syncTolerance;
    }

    set syncTolerance(n: number) {
        if (n < 0)
            return;
        this._syncTolerance = n;
    }

    async _write(frame: Packet, _: BufferEncoding, callback: (error?: Error | null) => void) {
        this.count++;
        if (!this.startTime)
            this.startTime = performance.now();

        // We are ahead, wait for the other stream to catch up
        while (
            this.syncStream &&
            !this.syncStream.writableEnded &&
            this.syncStream.pts !== undefined &&
            this._pts !== undefined &&
            this._pts - this.syncStream.pts > this._syncTolerance
        )
            await setImmediate();

        const { data, ptshi, pts, time_base_num, time_base_den } = frame;
        this.udp.sendAudioFrame(Buffer.from(data));
        if (ptshi !== undefined && pts !== undefined && time_base_num !== undefined && time_base_den !== undefined)
            this._pts = combineLoHi(ptshi, pts) / time_base_den * time_base_num;
        
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
