import { Writable } from "stream";
import { MediaUdp } from "../client/voice/MediaUdp.js";
import type { Packet } from "@libav.js/variant-webcodecs";

class AudioStream extends Writable {
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

    _write(chunk: Packet, _: BufferEncoding, callback: (error?: Error | null) => void) {
        this.count++;
        if (!this.startTime)
            this.startTime = performance.now();

        this.udp.sendAudioFrame(Buffer.from(chunk.data));
        
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
