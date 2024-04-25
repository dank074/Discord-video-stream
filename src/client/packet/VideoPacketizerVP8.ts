import { MediaUdp } from "../voice/MediaUdp.js";
import { BaseMediaPacketizer, max_int16bit } from "./BaseMediaPacketizer.js";

/**
 * VP8 payload format
 * 
 */
export class VideoPacketizerVP8 extends BaseMediaPacketizer {
    private _pictureId: number;

    constructor(connection: MediaUdp) {
        super(connection, 0x65, true);
        this._pictureId = 0;
        this.srInterval = 5 * connection.mediaConnection.streamOptions.fps * 3; // ~5 seconds, assuming ~3 packets per frame
    }

    private incrementPictureId(): void {
        this._pictureId = (this._pictureId + 1) % max_int16bit;
    }

    public override sendFrame(frame: Buffer): void {
        super.sendFrame(frame);
        const data = this.partitionDataMTUSizedChunks(frame);

        let bytesSent = 0;
        for (let i = 0; i < data.length; i++) {
            const packet = this.createPacket(data[i], i === (data.length - 1), i === 0);

            this.mediaUdp.sendPacket(packet);
            bytesSent += packet.length;
        }

        this.onFrameSent(data.length, bytesSent);
    }

    public createPacket(chunk: any, isLastPacket = true, isFirstPacket = true): Buffer {
        if(chunk.length > this.mtu) throw Error('error packetizing video frame: frame is larger than mtu');

        const packetHeader = this.makeRtpHeader(isLastPacket);

        const packetData = this.makeChunk(chunk, isFirstPacket);
    
        // nonce buffer used for encryption. 4 bytes are appended to end of packet
        const nonceBuffer = this.mediaUdp.getNewNonceBuffer();
        return Buffer.concat([packetHeader, this.encryptData(packetData, nonceBuffer), nonceBuffer.subarray(0, 4)]);
    }

    public override onFrameSent(packetsSent: number, bytesSent: number): void {
        super.onFrameSent(packetsSent, bytesSent);
        // video RTP packet timestamp incremental value = 90,000Hz / fps
        this.incrementTimestamp(90000 / this.mediaUdp.mediaConnection.streamOptions.fps);
        this.incrementPictureId();
    }

    private makeChunk(frameData:any, isFirstPacket: boolean): Buffer {
        const headerExtensionBuf = this.createHeaderExtension();
    
        // vp8 payload descriptor
        const payloadDescriptorBuf = Buffer.alloc(2);
    
        payloadDescriptorBuf[0] = 0x80;
        payloadDescriptorBuf[1] = 0x80;
        if (isFirstPacket) {
            payloadDescriptorBuf[0] |= 0b00010000; // mark S bit, indicates start of frame
        }
    
        // vp8 pictureid payload extension
        const pictureIdBuf = Buffer.alloc(2);
    
        pictureIdBuf.writeUIntBE(this._pictureId, 0, 2);
        pictureIdBuf[0] |= 0b10000000;
    
        return Buffer.concat([headerExtensionBuf, payloadDescriptorBuf, pictureIdBuf, frameData]);
    }
}