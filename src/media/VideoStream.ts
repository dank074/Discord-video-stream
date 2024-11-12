import { MediaUdp } from "../client/voice/MediaUdp.js";
import { BaseMediaStream } from "./BaseMediaStream.js";

export class VideoStream extends BaseMediaStream {
    public udp: MediaUdp;

    constructor(udp: MediaUdp) {
        super("video");
        this.udp = udp;
    }

    protected override async _sendFrame(frame: Buffer): Promise<void> {
        await this.udp.sendVideoFrame(frame);
    }
}
