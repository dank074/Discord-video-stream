import { MediaUdp } from "../voice/MediaUdp.js";
import { BaseMediaPacketizer } from "./BaseMediaPacketizer.js";

const frame_size = (48000 / 100) * 2;

export class AudioPacketizer extends BaseMediaPacketizer {
    constructor(connection: MediaUdp) {
        super(connection, 0x78);
        this.srInterval = 5 * 48000 / frame_size; // ~5 seconds
    }

    public override sendFrame(frame:any): void {
        super.sendFrame(frame);
        const packet = this.createPacket(frame);
        this.mediaUdp.sendPacket(packet);
        this.onFrameSent(packet.length);
    }

    public createPacket(chunk: any): Buffer {
        const header = this.makeRtpHeader();

        const nonceBuffer = this.mediaUdp.getNewNonceBuffer();
        return Buffer.concat([header, this.encryptData(chunk, nonceBuffer), nonceBuffer.subarray(0, 4)]);
    }

    public override onFrameSent(bytesSent: number): void {
        super.onFrameSent(1, bytesSent);
        this.incrementTimestamp(frame_size);
    }
}