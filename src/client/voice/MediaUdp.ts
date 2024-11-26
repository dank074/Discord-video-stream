import udpCon from 'dgram';
import { isIPv4 } from 'net';
import { AudioPacketizer } from '../packet/AudioPacketizer.js';
import { BaseMediaPacketizer } from '../packet/BaseMediaPacketizer.js';
import {
    VideoPacketizerH264,
    VideoPacketizerH265
} from '../packet/VideoPacketizerAnnexB.js';
import { VideoPacketizerVP8 } from '../packet/VideoPacketizerVP8.js';
import { max_int32bit, normalizeVideoCodec, SupportedEncryptionModes } from '../../utils.js';
import { BaseMediaConnection } from './BaseMediaConnection.js';

// credit to discord.js
function parseLocalPacket(message: Buffer) {
    const packet = Buffer.from(message);

	const ip = packet.subarray(8, packet.indexOf(0, 8)).toString('utf8');

	if (!isIPv4(ip)) {
		throw new Error('Malformed IP address');
	}

	const port = packet.readUInt16BE(packet.length - 2);

	return { ip, port };
}

export class MediaUdp {
    private _mediaConnection: BaseMediaConnection;
    private _nonce: number;
    private _socket: udpCon.Socket | null = null;
    private _ready: boolean = false;
    private _audioPacketizer: BaseMediaPacketizer;
    private _videoPacketizer?: BaseMediaPacketizer;
    private _encryptionMode: SupportedEncryptionModes | undefined;
    private _ip?: string;
    private _port?: number;

    constructor(voiceConnection: BaseMediaConnection) {
        this._nonce = 0;

        this._mediaConnection = voiceConnection;
        this._audioPacketizer = new AudioPacketizer(this);
        this.updateVideoPacketizer();
    }

    public getNewNonceBuffer(): Buffer {
        const nonceBuffer = this._encryptionMode === SupportedEncryptionModes.AES256 ? Buffer.alloc(12) : Buffer.alloc(24);
        this._nonce = (this._nonce + 1) % max_int32bit;
        
        nonceBuffer.writeUInt32BE(this._nonce, 0);
        return nonceBuffer;
    }

    public get audioPacketizer(): BaseMediaPacketizer {
        return this._audioPacketizer;
    }

    public get videoPacketizer(): BaseMediaPacketizer {
        // This will never be undefined anyway, so it's safe
        return this._videoPacketizer!;
    }

    public get mediaConnection(): BaseMediaConnection {
        return this._mediaConnection;
    }

    public get encryptionMode(): SupportedEncryptionModes | undefined {
        return this._encryptionMode;
    }

    public set encryptionMode(mode: SupportedEncryptionModes) {
        this._encryptionMode = mode;
    }

    public get ip()
    {
        return this._ip;
    }

    public get port()
    {
        return this._port;
    }

    public async sendAudioFrame(frame: Buffer, frametime: number): Promise<void> {
        if(!this.ready) return;
        await this.audioPacketizer.sendFrame(frame, frametime);
    }

    public async sendVideoFrame(frame: Buffer, frametime: number): Promise<void> {
        if(!this.ready) return;
        await this.videoPacketizer.sendFrame(frame, frametime);
    }

    public updateVideoPacketizer(): void {
        const videoCodec = normalizeVideoCodec(this.mediaConnection.streamOptions.videoCodec);
        switch (videoCodec)
        {
            case "H264":
                this._videoPacketizer = new VideoPacketizerH264(this);
                break;
            case "H265":
                this._videoPacketizer = new VideoPacketizerH265(this);
                break;
            case "VP8":
                this._videoPacketizer = new VideoPacketizerVP8(this);
                break;
            default:
                throw new Error(`Packetizer not implemented for ${videoCodec}`)
        }
    }

    public sendPacket(packet: Buffer): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
            this._socket?.send(packet, 0, packet.length, this._mediaConnection.port!, this._mediaConnection.address!, (error, bytes) => {
                if (error) {
                    console.log("ERROR", error);
                    reject(error);
                }
                resolve();
            });
        } catch(e) {reject(e)}
        });
    }

    handleIncoming(buf: any): void {
        //console.log("RECEIVED PACKET", buf);
    }

    public get ready(): boolean {
        return this._ready;
    }

    public set ready(val: boolean) {
        this._ready = val;
    }

    public stop(): void {
        try {
            this.ready = false;
            this._socket?.disconnect();
        }catch(e) {}
    }

    public createUdp(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this._socket = udpCon.createSocket('udp4');

            this._socket.on('error', (error: Error) => {
                console.error("Error connecting to media udp server", error);
                reject(error);
            });

            this._socket.once('message', (message) => {
                if (message.readUInt16BE(0) !== 2) {
                    reject('wrong handshake packet for udp')
                }
                try {
                    const packet = parseLocalPacket(message);
                    this._ip = packet.ip;
                    this._port = packet.port;
                    this._mediaConnection.setProtocols(packet.ip, packet.port);
                } catch(e) { reject(e) }
                
                resolve();
                this._socket!.on('message', this.handleIncoming);
            });

            const blank = Buffer.alloc(74);
            
            blank.writeUInt16BE(1, 0);
			blank.writeUInt16BE(70, 2);
            blank.writeUInt32BE(this._mediaConnection.ssrc!, 4);

            this._socket.send(blank, 0, blank.length, this._mediaConnection.port!, this._mediaConnection.address!, (error, bytes) => {
                if (error) {
                    reject(error)
                }
            });
        });
    }
}
