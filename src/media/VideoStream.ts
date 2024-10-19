import { Writable } from "stream";
import { MediaUdp } from "../client/voice/MediaUdp.js";
import type { Packet } from "@libav.js/variant-webcodecs";

export class VideoStream extends Writable {
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

    public setSleepTime(time: number) {
        this.sleepTime = time;
    }

    _write(frame: Packet, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.count++;
        if (!this.startTime)
            this.startTime = performance.now();

        this.udp.sendVideoFrame(Buffer.from(frame.data));

        const next = ( (this.count + 1) * this.sleepTime) - (performance.now() - this.startTime);

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
