import { VoiceOpCodes } from "./VoiceOpCodes.js";
import { MediaUdp } from "./MediaUdp.js";
import {
    AES256TransportEncryptor,
    Chacha20TransportEncryptor,
    type TransportEncryptor
} from "../encryptor/TransportEncryptor.js";
import { STREAMS_SIMULCAST, SupportedEncryptionModes, type SupportedVideoCodec } from "../../utils.js";
import type { ReadyMessage, SelectProtocolAck } from "./VoiceMessageTypes.js";
import WebSocket from 'ws';
import EventEmitter from "node:events";

type VoiceConnectionStatus =
{
    hasSession: boolean;
    hasToken: boolean;
    started: boolean;
    resuming: boolean;
}

type WebRtcParameters = {
    address: string,
    port: number,
    audioSsrc: number,
    videoSsrc: number,
    rtxSsrc: number
    supportedEncryptionModes: SupportedEncryptionModes[]
}

export const CodecPayloadType = {
    "opus": {
        name: "opus", type: "audio", priority: 1000, payload_type: 120
    },
    "H264": {
        name: "H264", type: "video", priority: 1000, payload_type: 101, rtx_payload_type: 102, encode: true, decode: true
    },
    "H265": {
        name: "H265", type: "video", priority: 1000, payload_type: 103, rtx_payload_type: 104, encode: true, decode: true
    },
    "VP8": {
        name: "VP8", type: "video", priority: 1000, payload_type: 105, rtx_payload_type: 106, encode: true, decode: true
    },
    "VP9": {
        name: "VP9", type: "video", priority: 1000, payload_type: 107, rtx_payload_type: 108, encode: true, decode: true
    },
    "AV1": {
        name: "AV1", type: "video", priority: 1000, payload_type: 109, rtx_payload_type: 110, encode: true, decode: true
    }
}

export interface StreamOptions {
    /**
     * Video output width
     */
    width: number;
    /**
     * Video output height
     */
    height: number;
    /**
     * Video output frames per second
     */
    fps: number;
    /**
     * Video output bitrate in kbps
     */
    bitrateKbps: number;
    maxBitrateKbps: number;
    /**
     * Enables hardware accelerated video decoding. Enabling this option might result in an exception
     * being thrown by Ffmpeg process if your system does not support hardware acceleration
     */
    hardwareAcceleratedDecoding: boolean;
    /**
     * Output video codec. **Only** supports H264, H265, and VP8 currently
     */
    videoCodec: SupportedVideoCodec;
    /**
     * Enables sending RTCP sender reports. Helps the receiver synchronize the audio/video frames, except in some weird
     * cases which is why you can disable it
     */
    rtcpSenderReportEnabled: boolean;
    /**
     * Encoding preset for H264 or H265. The faster it is, the lower the quality
     */
    h26xPreset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
    /**
     * Adds ffmpeg params to minimize latency and start outputting video as fast as possible.
     * Might create lag in video output in some rare cases
     */
    minimizeLatency: boolean;

    /**
     * ChaCha20-Poly1305 Encryption is faster than AES-256-GCM, except when using AES-NI
     */
    forceChacha20Encryption: boolean;
}

const defaultStreamOptions: StreamOptions = {
    width: 1080,
    height: 720,
    fps: 30,
    bitrateKbps: 1000,
    maxBitrateKbps: 2500,
    hardwareAcceleratedDecoding: false,
    videoCodec: 'H264',
    rtcpSenderReportEnabled: true,
    h26xPreset: 'ultrafast',
    minimizeLatency: true,
    forceChacha20Encryption: false,
}

export abstract class BaseMediaConnection extends EventEmitter {
    private interval: NodeJS.Timeout | null = null;
    public udp: MediaUdp;
    public guildId: string;
    public channelId: string;
    public botId: string;
    public ws: WebSocket | null = null;
    public ready: (udp: MediaUdp) => void;
    public status: VoiceConnectionStatus;
    public server: string | null = null; //websocket url
    public token: string | null = null;
    public session_id: string | null = null;

    public webRtcParams: WebRtcParameters | null = null;
    private _streamOptions: StreamOptions;
    private _transportEncryptor?: TransportEncryptor;

    constructor(guildId: string, botId: string, channelId: string, options: Partial<StreamOptions>, callback: (udp: MediaUdp) => void) {
        super();
        this.status = {
            hasSession: false,
            hasToken: false,
            started: false,
            resuming: false
        }

        this._streamOptions = { ...defaultStreamOptions, ...options }

        // make udp client
        this.udp = new MediaUdp(this);

        this.guildId = guildId;
        this.channelId = channelId;
        this.botId = botId;
        this.ready = callback;
    }

    public abstract get serverId(): string | null;

    public get streamOptions(): StreamOptions {
        return this._streamOptions;
    }

    public set streamOptions(options: Partial<StreamOptions>) {
        this._streamOptions = { ...this._streamOptions, ...options }
    }

    public get transportEncryptor() {
        return this._transportEncryptor;
    }

    stop(): void {
        this.interval && clearInterval(this.interval);
        this.status.started = false;
        this.ws?.close();
        this.udp?.stop();
    }

    setSession(session_id: string): void {
        this.session_id = session_id;

        this.status.hasSession = true;
        this.start();
    }
    
    setTokens(server: string, token: string): void {
        this.token = token;
        this.server = server;

        this.status.hasToken = true;
        this.start();
    }

    start(): void {
        /*
        ** Connection can only start once both
        ** session description and tokens have been gathered 
        */
        if (this.status.hasSession && this.status.hasToken) {
            if (this.status.started)
                return
            this.status.started = true;

            this.ws = new WebSocket(`wss://${this.server}/?v=7`, {
                followRedirects: true
            });
            this.ws.on("open", () => {
                if(this.status.resuming) {
                    this.status.resuming = false;
                    this.resume();
                } else {
                    this.identify();
                }
            })
            this.ws.on("error", (err) => {
                console.error(err);
            })
            this.ws.on("close", (code) => {
                const wasStarted = this.status.started;

                this.status.started = false;
                this.udp.ready = false;

                const canResume = code === 4_015 || code < 4_000;

                if (canResume && wasStarted) {
                    this.status.resuming = true;
                    this.start();
                }
            })
            this.setupEvents();
        }
    }

    handleReady(d: ReadyMessage): void {
        // we hardcoded the STREAMS_SIMULCAST, which will always be array of 1
        const stream = d.streams[0];
        this.webRtcParams = {
            address: d.ip,
            port: d.port,
            audioSsrc: d.ssrc,
            videoSsrc: stream.ssrc,
            rtxSsrc: stream.rtx_ssrc,
            supportedEncryptionModes: d.modes
        }
        this.udp.updatePacketizer();
    }

    handleProtocolAck(d: SelectProtocolAck): void {
        const secretKey = Buffer.from(d.secret_key);
        switch (d.mode)
        {
            case SupportedEncryptionModes.AES256:
                this._transportEncryptor = new AES256TransportEncryptor(secretKey);
                break;
            case SupportedEncryptionModes.XCHACHA20:
                this._transportEncryptor = new Chacha20TransportEncryptor(secretKey);
                break;
        }
        this.emit("select_protocol_ack");
    }

    setupEvents(): void {
        this.ws?.on('message', (data: string) => {
            // Maybe map out all the types here to avoid any?
            const { op, d } = JSON.parse(data);

            if (op === VoiceOpCodes.READY) { // ready
                this.handleReady(d);
                this.sendVoice().then(() => this.ready(this.udp));
                this.setVideoStatus(false);
            }
            else if (op >= 4000) {
                console.error(`Error ${this.constructor.name} connection`, d);
            }
            else if (op === VoiceOpCodes.HELLO) {
                this.setupHeartbeat(d.heartbeat_interval);
            }
            else if (op === VoiceOpCodes.SELECT_PROTOCOL_ACK) { // session description
                this.handleProtocolAck(d);
            }
            else if (op === VoiceOpCodes.SPEAKING) {
                // ignore speaking updates
            }
            else if (op === VoiceOpCodes.HEARTBEAT_ACK) {
                // ignore heartbeat acknowledgements
            }
            else if (op === VoiceOpCodes.RESUMED) {
                this.status.started = true;
                this.udp.ready = true;
            }
            else {
                //console.log("unhandled voice event", {op, d});
            }
        });
    }

    setupHeartbeat(interval: number): void {
        if (this.interval) {
            clearInterval(this.interval);
        }
        this.interval = setInterval(() => {
            this.sendOpcode(VoiceOpCodes.HEARTBEAT, 42069);
        }, interval);
    }

    sendOpcode(code:number, data: unknown): void {
        this.ws?.send(JSON.stringify({
            op: code,
            d: data
        }));
    }

    /*
    ** identifies with media server with credentials
    */
    identify(): void {
        this.sendOpcode(VoiceOpCodes.IDENTIFY, {
            server_id: this.serverId,
            user_id: this.botId,
            session_id: this.session_id,
            token: this.token,
            video: true,
            streams: STREAMS_SIMULCAST
        });
    }

    resume(): void {
        this.sendOpcode(VoiceOpCodes.RESUME, {
            server_id: this.serverId,
            session_id: this.session_id,
            token: this.token,
        });
    }

    /*
    ** Sets protocols and ip data used for video and audio.
    ** Uses vp8 for video
    ** Uses opus for audio
    */
    setProtocols(): Promise<void> {
        const { ip, port } = this.udp;
        // select encryption mode
        // From Discord docs: 
        // You must support aead_xchacha20_poly1305_rtpsize. You should prefer to use aead_aes256_gcm_rtpsize when it is available.
        let encryptionMode: SupportedEncryptionModes;
        if (!this.webRtcParams)
            throw new Error("WebRTC connection not ready");
        if (
            this.webRtcParams.supportedEncryptionModes.includes(SupportedEncryptionModes.AES256) &&
            !this.streamOptions.forceChacha20Encryption
        ) {
            encryptionMode = SupportedEncryptionModes.AES256
        } else {
            encryptionMode = SupportedEncryptionModes.XCHACHA20
        }
        return new Promise((resolve) => {
            this.sendOpcode(VoiceOpCodes.SELECT_PROTOCOL, {
                protocol: "udp",
                codecs: Object.values(CodecPayloadType),
                data: {
                    address: ip,
                    port: port,
                    mode: encryptionMode
                },
                address: ip,
                port: port,
                mode: encryptionMode
            });
            this.once("select_protocol_ack", () => resolve());
        })
    }

    /*
    ** Sets video status.
    ** bool -> video on or off
    ** video and rtx sources are set to ssrc + 1 and ssrc + 2
    */
    public setVideoStatus(bool: boolean): void {
        if (!this.webRtcParams)
            throw new Error("WebRTC connection not ready");
        const { audioSsrc, videoSsrc, rtxSsrc } = this.webRtcParams;
        this.sendOpcode(VoiceOpCodes.VIDEO, {
            audio_ssrc: audioSsrc,
            video_ssrc: bool ? videoSsrc : 0,
            rtx_ssrc: bool ? rtxSsrc : 0,
            streams: [
                { 
                    type:"video",
                    rid:"100",
                    ssrc: bool ? videoSsrc : 0,
                    active:true,
                    quality:100,
                    rtx_ssrc:bool ? rtxSsrc : 0,
                    max_bitrate: this.streamOptions.maxBitrateKbps * 1000,
                    max_framerate: this.streamOptions.fps,
                    max_resolution: {
                        type:"fixed",
                        width: this.streamOptions.width,
                        height: this.streamOptions.height
                    }
                }
            ]
        });
    }

    /*
    ** Set speaking status
    ** speaking -> speaking status on or off
    */
    public setSpeaking(speaking: boolean): void {
        if (!this.webRtcParams)
            throw new Error("WebRTC connection not ready");
        this.sendOpcode(VoiceOpCodes.SPEAKING, {
            delay: 0,
            speaking: speaking ? 1 : 0,
            ssrc: this.webRtcParams.audioSsrc
        });
    }

    /*
    ** Start media connection
    */
    public sendVoice(): Promise<void> {
        return this.udp.createUdp();
    }
}