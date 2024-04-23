import { MediaUdp } from "../voice/MediaUdp";
import { BaseMediaPacketizer, max_int16bit } from "./BaseMediaPacketizer";

function uleb128_decode(buf: Buffer)
{
    let shift = 0;
    let num = 0;
    let i = 0;
    let next = 0;
    do
    {
        if (i >= buf.length)
            throw new Error("Unexpected end of buffer while parsing LEB128");
        next = buf[i++];
        num |= (next & 0x7f) << shift;
        shift += 7;
    }
    while (next & 0x80);
    return { num, bytesRead: i };
}

function uleb128_encode(num: number)
{
    const output: number[] = [];
    while (true) {
        const byte = num & 0x7f;
        num = num >> 7;
        if (num == 0)
        {
            output.push(byte);
            return Buffer.from(output);
        }
        output.push(byte | 0x80)
    }
}

/**
 * AV1 payload format
 * 
 */
export class VideoPacketizerAV1 extends BaseMediaPacketizer {
    constructor(connection: MediaUdp) {
        super(connection, 0x65, true);
        this.srInterval = 5 * connection.mediaConnection.streamOptions.fps * 3; // ~5 seconds, assuming ~3 packets per frame
    }

    private _splitObu(buf: Buffer)
    {
        const obus = [];
        while (buf.length > 0)
        {
            const header = buf[0];
            const obu_forbidden_bit = (header & 0b10000000) >> 7;
            const obu_type = (header & 0b01111000) >> 3;
            const obu_extension_flag = (header & 0b00000100) >> 2;
            const obu_has_size_field = (header & 0b00000010) >> 1;
            const obu_reserved_1bit = header & 1;
            if (!obu_has_size_field)
                throw new Error("Expected obu_has_size_field to be set")
            const obuSizePos = 1 + (obu_extension_flag ? 1 : 0);
            const { num: obuSize, bytesRead: leb128BytesCount } = uleb128_decode(buf.subarray(obuSizePos));
            const obuSizeTotal = obuSizePos + leb128BytesCount + obuSize;
            obus.push({
                header: {
                    obu_forbidden_bit,
                    obu_type,
                    obu_extension_flag,
                    obu_has_size_field,
                    obu_reserved_1bit
                },
                obu: buf.subarray(0, obuSizeTotal)
            });
            buf = buf.subarray(obuSizeTotal);
        }
        return obus;
    }

    public override sendFrame(frame: Buffer): void {
        super.sendFrame(frame);
        let bytesSent = 0, packetsSent = 0;

        const obus = this._splitObu(frame);
        for (let i = 0; i < obus.length; ++i)
        {
            const { obu } = obus[i];
            const data = this.partitionDataMTUSizedChunks(obu);
            const isFirstObu = i === 0;
            const isLastObu = i === obus.length - 1;
            
            for (let j = 0; j < data.length; j++) {
                const packet = this.createPacket(data[j], isFirstObu, isLastObu, j === 0, j === (data.length - 1));
    
                this.mediaUdp.sendPacket(packet);
                bytesSent += packet.length;
                packetsSent++;
            }
        }

        this.onFrameSent(packetsSent, bytesSent);
    }

    public createPacket(chunk: Buffer, isFirstObu: boolean, isLastObu: boolean, isFirstPacket: boolean, isLastPacket: boolean): Buffer {
        if (chunk.length > this.mtu) throw Error('error packetizing video frame: frame is larger than mtu');

        const packetHeader = this.makeRtpHeader(isLastObu && isLastPacket);

        const packetData = this.makeChunk(chunk, isFirstObu, isFirstPacket, isLastPacket);
    
        // nonce buffer used for encryption. 4 bytes are appended to end of packet
        const nonceBuffer = this.mediaUdp.getNewNonceBuffer();
        return Buffer.concat([packetHeader, this.encryptData(packetData, nonceBuffer), nonceBuffer.subarray(0, 4)]);
    }

    public override onFrameSent(packetsSent: number, bytesSent: number): void {
        super.onFrameSent(packetsSent, bytesSent);
        // video RTP packet timestamp incremental value = 90,000Hz / fps
        this.incrementTimestamp(90000 / this.mediaUdp.mediaConnection.streamOptions.fps);
    }

    private makeChunk(chunk: Buffer, isFirstObu: boolean, isFirstPacket: boolean, isLastPacket: boolean): Buffer {
        const headerExtensionBuf = this.createHeaderExtension();
    
        // AV1 aggregation header
        const aggregationHeader = Buffer.alloc(1);
        
        // Instead of just specifying isFirstPacket and isLastPacket, they make it
        // "is continuation of previous packet" and "is continuation of next packet"
        // which is just a logical NOT of isFirstPacket and isLastPacket
        // What's the rationale? No one knows, but it explains the ! below
        if (!isFirstPacket)
            aggregationHeader[0] |= 1 << 7;
        if (!isLastPacket)
            aggregationHeader[0] |= 1 << 6;
        if (isFirstObu)
            aggregationHeader[0] |= 1 << 3;
    
        return Buffer.concat([
            headerExtensionBuf,
            aggregationHeader,
            uleb128_encode(chunk.length),
            chunk
        ]);
    }
}