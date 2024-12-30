import type { MediaUdp } from "../voice/MediaUdp.js";
import { BaseMediaPacketizer } from "./BaseMediaPacketizer.js";
import { CodecPayloadType } from "../voice/BaseMediaConnection.js";

export class AudioPacketizer extends BaseMediaPacketizer {
    constructor(connection: MediaUdp) {
        super(connection, CodecPayloadType.opus.payload_type);
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

        const [ciphertext, nonceBuffer] = await this.encryptData(chunk, header);
        return Buffer.concat([header, ciphertext, nonceBuffer.subarray(0, 4)]);
    }

    public override async onFrameSent(bytesSent: number, frametime: number): Promise<void> {
        await super.onFrameSent(1, bytesSent, frametime);
        this.incrementTimestamp(frametime * (48000 / 1000));
    }
}