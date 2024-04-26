import { Writable } from "stream";
import { MediaUdp } from "../client/voice/MediaUdp.js";

export class VideoStream extends Writable {
    public udp: MediaUdp;
    public count: number;
    public sleepTime: number;
    public startTime?: number;
    private noSleep: boolean;
    private paused: boolean = false;

    constructor(udp: MediaUdp, fps: number = 30, noSleep = false) {
        super();
        this.udp = udp;
        this.count = 0;
        this.sleepTime = 1000 / fps;
        this.noSleep = noSleep;
    }

    public setSleepTime(time: number) {
        this.sleepTime = time;
    }

    async _write(frame: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.count++;
        if (!this.startTime)
            this.startTime = performance.now();

        this.udp.sendVideoFrame(frame);

        if (this.noSleep)
        {
            callback();
        }
        else
        {
            do {
                this.count++;
                const next = (this.count + 1) * this.sleepTime - (performance.now() - this.startTime);
                await this.delay(next);
            } while (this.paused);
            callback();
        }
    }

    private delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    pause() {
        this.paused = true;
    }

    resume() {
        this.paused = false;
    }
}
