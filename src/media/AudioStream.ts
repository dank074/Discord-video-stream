import { MediaUdp } from "../client/voice/MediaUdp.js";
import { BaseMediaStream } from "./BaseMediaStream.js";

export class AudioStream extends BaseMediaStream {
    public udp: MediaUdp;

    constructor(udp: MediaUdp, noSleep: boolean = false) {
        super("audio", noSleep);
        this.udp = udp;
    }

    protected override async _sendFrame(frame: Buffer): Promise<void> {
        await this.udp.sendAudioFrame(frame);
    }
}
