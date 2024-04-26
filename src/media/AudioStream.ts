import { Writable } from "stream";
import { MediaUdp } from "../client/voice/MediaUdp.js";

class AudioStream extends Writable {
    public udp: MediaUdp;
    public count: number;
    public sleepTime: number;
    public startTime?: number;
    private noSleep: boolean;
    private paused: boolean = false;

    constructor(udp: MediaUdp, noSleep = false) {
        super();
        this.udp = udp;
        this.count = 0;
        this.sleepTime = 20;
        this.noSleep = noSleep;
    }

    async _write(chunk: any, _: BufferEncoding, callback: (error?: Error | null) => void) {
        this.count++;
        if (!this.startTime)
            this.startTime = performance.now();

        this.udp.sendAudioFrame(chunk);

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

export {
    AudioStream
};
