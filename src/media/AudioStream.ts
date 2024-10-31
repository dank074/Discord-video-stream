import { MediaUdp } from "../client/voice/MediaUdp.js";
import { BaseMediaStream } from "./BaseMediaStream.js";

export class AudioStream extends BaseMediaStream {
    public udp: MediaUdp;

    constructor(udp: MediaUdp) {
        super();
        this.udp = udp;
        this._type = "audio";
    }

    protected override async _sendFrame(frame: Buffer): Promise<void> {
        await this.udp.sendAudioFrame(frame);
    }
}
