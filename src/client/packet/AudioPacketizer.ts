import { MediaUdp } from "../voice/MediaUdp.js";
import { BaseMediaPacketizer } from "./BaseMediaPacketizer.js";

export class AudioPacketizer extends BaseMediaPacketizer {
    constructor(connection: MediaUdp) {
        super(connection, 0x78);
        this.srInterval = 5 * 1000 / 20; // ~5 seconds for 20ms frame time
    }

    public override async sendFrame(frame: Buffer, frametime: number): Promise<void> {
        super.sendFrame(frame, frametime);
        const packet = await this.createPacket(frame);
        this.mediaUdp.sendPacket(packet);
        this.onFrameSent(packet.length, frametime);
    }

    public async createPacket(chunk: Buffer): Promise<Buffer> {
        const header = this.makeRtpHeader();

        const nonceBuffer = this.mediaUdp.getNewNonceBuffer();
        return Buffer.concat([header, await this.encryptData(chunk, nonceBuffer, header), nonceBuffer.subarray(0, 4)]);
    }

    public override async onFrameSent(bytesSent: number, frametime: number): Promise<void> {
        await super.onFrameSent(1, bytesSent, frametime);
        this.incrementTimestamp(frametime * (48000 / 1000));
    }
}