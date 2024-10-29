import { MediaUdp } from "../voice/MediaUdp.js";
import { BaseMediaPacketizer } from "./BaseMediaPacketizer.js";

const frame_size = (48000 / 100) * 2;

export class AudioPacketizer extends BaseMediaPacketizer {
    constructor(connection: MediaUdp) {
        super(connection, 0x78);
        this.srInterval = 5 * 48000 / frame_size; // ~5 seconds
    }

    public override async sendFrame(frame: Buffer): Promise<void> {
        super.sendFrame(frame);
        const packet = await this.createPacket(frame);
        this.mediaUdp.sendPacket(packet);
        this.onFrameSent(packet.length);
    }

    public async createPacket(chunk: Buffer): Promise<Buffer> {
        const header = this.makeRtpHeader();

        const nonceBuffer = this.mediaUdp.getNewNonceBuffer();
        return Buffer.concat([header, await this.encryptData(chunk, nonceBuffer, header), nonceBuffer.subarray(0, 4)]);
    }

    public override async onFrameSent(bytesSent: number): Promise<void> {
        await super.onFrameSent(1, bytesSent);
        this.incrementTimestamp(frame_size);
    }
}