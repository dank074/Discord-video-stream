import { VoiceOpCodes } from "./VoiceOpCodes";
import { MediaUdp } from "./MediaUdp";
import { normalizeVideoCodec } from "../../utils";
import WebSocket from 'ws';

type VoiceConnectionStatus =
{
    hasSession: boolean;
    hasToken: boolean;
    started: boolean;
    resuming: boolean;
}

export type SupportedVideoCodec = "H264" | "H265" | "VP8" | "VP9" | "AV1";

export interface StreamOptions {
    /**
     * Video output width
     */
    width?: number;
    /**
     * Video output height
     */
    height?: number;
    /**
     * Video output frames per second
     */
    fps?: number;
    /**
     * Video output bitrate in kbps
     */
    bitrateKbps?: number;
    maxBitrateKbps?: number;
    /**
     * Enables hardware accelerated video decoding. Enabling this option might result in an exception
     * being thrown by Ffmpeg process if your system does not support hardware acceleration
     */
    hardwareAcceleratedDecoding?: boolean;
    /**
     * Output video codec. **Only** supports H264, H265, and VP8 currently
     */
    videoCodec?: SupportedVideoCodec;
    /**
     * Ffmpeg will read frames at native framerate. Disabling this make ffmpeg read frames as
     * fast as possible and `setTimeout` will be used to control output fps instead. Enabling this
     * can result in certain streams having video/audio out of sync (see https://github.com/dank074/Discord-video-stream/issues/52)
     */
    readAtNativeFps?: boolean;
    /**
     * Enables sending RTCP sender reports. Helps the receiver synchronize the audio/video frames, except in some weird
     * cases which is why you can disable it
     */
    rtcpSenderReportEnabled?: boolean;
    /**
     * Encoding preset for H264 or H265. The faster it is, the lower the quality
     */
    h26xPreset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
}

const defaultStreamOptions: StreamOptions = {
    width: 1080,
    height: 720,
    fps: 30,
    bitrateKbps: 1000,
    maxBitrateKbps: 2500,
    hardwareAcceleratedDecoding: false,
    videoCodec: 'H264',
    readAtNativeFps: true,
    rtcpSenderReportEnabled: true,
    h26xPreset: 'ultrafast',
}

export abstract class BaseMediaConnection {
    private interval: NodeJS.Timeout;
    public udp: MediaUdp;
    public guildId: string;
    public channelId: string;
    public botId: string;
    public ws: WebSocket;
    public ready: (udp: MediaUdp) => void;
    public status: VoiceConnectionStatus;
    public server: string;//websocket url
    public token: string;
    public session_id: string;
    public self_ip: string;
    public self_port: number;
    public address: string;
    public port: number;
    public ssrc: number;
    public videoSsrc: number;
    public rtxSsrc: number;
    public modes: string[];
    public secretkey: Uint8Array;
    private _streamOptions: StreamOptions;

    constructor(guildId: string, botId: string, channelId: string, options: StreamOptions, callback: (udp: MediaUdp) => void) {
        this.status = {
            hasSession: false,
            hasToken: false,
            started: false,
            resuming: false
        }

        this._streamOptions = { ...defaultStreamOptions };
        this.streamOptions = options;

        // make udp client
        this.udp = new MediaUdp(this);

        this.guildId = guildId;
        this.channelId = channelId;
        this.botId = botId;
        this.ready = callback;
    }

    public abstract get serverId(): string;

    public get streamOptions(): StreamOptions {
        return this._streamOptions;
    }

    public set streamOptions(options: StreamOptions) {
        this._streamOptions.width = options.width ?? this._streamOptions.width;
        this._streamOptions.height = options.height ?? this._streamOptions.height;
        this._streamOptions.fps = options.fps ?? this._streamOptions.fps;
        this._streamOptions.bitrateKbps = options.bitrateKbps ?? this._streamOptions.bitrateKbps;
        this._streamOptions.maxBitrateKbps = options.maxBitrateKbps ?? this._streamOptions.maxBitrateKbps;
        this._streamOptions.hardwareAcceleratedDecoding = options.hardwareAcceleratedDecoding ?? this._streamOptions.hardwareAcceleratedDecoding;
        this._streamOptions.videoCodec = options.videoCodec ?? this._streamOptions.videoCodec;
        this._streamOptions.readAtNativeFps = options.readAtNativeFps ?? this._streamOptions.readAtNativeFps;
        this._streamOptions.rtcpSenderReportEnabled = options.rtcpSenderReportEnabled ?? this._streamOptions.rtcpSenderReportEnabled;
    }

    stop(): void {
        clearInterval(this.interval);
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

            this.ws = new WebSocket("wss://" + this.server + "/?v=7", {
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

    handleReady(d: any): void {
        this.ssrc = d.ssrc;
        this.address = d.ip;
        this.port = d.port;
        this.modes = d.modes;
        this.videoSsrc = this.ssrc + 1; // todo: set it from packet streams object
        this.rtxSsrc = this.ssrc + 2;

        this.udp.audioPacketizer.ssrc = this.ssrc;
        this.udp.videoPacketizer.ssrc = this.videoSsrc;
    }

    handleSession(d: any): void {
        this.secretkey = new Uint8Array(d.secret_key);

        this.ready(this.udp);
        this.udp.ready = true;
    }

    setupEvents(): void {
        this.ws.on('message', (data: any) => {
            const { op, d } = JSON.parse(data);

            if (op == VoiceOpCodes.READY) { // ready
                this.handleReady(d);
                this.sendVoice();
                this.setVideoStatus(false);
            }
            else if (op >= 4000) {
                console.error(`Error ${this.constructor.name} connection`, d);
            }
            else if (op === VoiceOpCodes.HELLO) {
                this.setupHeartbeat(d.heartbeat_interval);
            }
            else if (op === VoiceOpCodes.SELECT_PROTOCOL_ACK) { // session description
                this.handleSession(d);
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

    sendOpcode(code:number, data:any): void {
        this.ws.send(JSON.stringify({
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
            streams: [
                { type:"screen", rid:"100", quality:100 }
            ]
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
    setProtocols(): void {
        this.sendOpcode(VoiceOpCodes.SELECT_PROTOCOL, {
            protocol: "udp",
            codecs: [
                { name: "opus", type: "audio", priority: 1000, payload_type: 120 },
                { name: normalizeVideoCodec(this.streamOptions.videoCodec), type: "video", priority: 1000, payload_type: 101, rtx_payload_type: 102, encode: true, decode: true}
                //{ name: "VP8", type: "video", priority: 3000, payload_type: 103, rtx_payload_type: 104, encode: true, decode: true }
                //{ name: "VP9", type: "video", priority: 3000, payload_type: 105, rtx_payload_type: 106 },
            ],
            data: {
                address: this.self_ip,
                port: this.self_port,
                mode: "xsalsa20_poly1305_lite"
            }
        });
    }

    /*
    ** Sets video status.
    ** bool -> video on or off
    ** video and rtx sources are set to ssrc + 1 and ssrc + 2
    */
    public setVideoStatus(bool: boolean): void {
        this.sendOpcode(VoiceOpCodes.VIDEO, {
            audio_ssrc: this.ssrc,
            video_ssrc: bool ? this.videoSsrc : 0,
            rtx_ssrc: bool ? this.rtxSsrc : 0,
            streams: [
                { 
                    type:"video",
                    rid:"100",
                    ssrc: bool ? this.videoSsrc : 0,
                    active:true,
                    quality:100,
                    rtx_ssrc:bool ? this.rtxSsrc : 0,
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
        this.sendOpcode(VoiceOpCodes.SPEAKING, {
            delay: 0,
            speaking: speaking ? 1 : 0,
            ssrc: this.ssrc
        });
    }

    /*
    ** Start media connection
    */
    public sendVoice(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.udp.createUdp().then(() => {
                resolve();
            });
        })
    }
}