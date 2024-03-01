import { Client } from 'discord.js-selfbot-v13';
import { GatewayOpCodes } from "./GatewayOpCodes";
import { MediaUdp } from "./voice/MediaUdp";
import { StreamConnection } from "./voice/StreamConnection";
import { VoiceConnection } from "./voice/VoiceConnection";

export type VoiceState = {
    self_mute: boolean;
    self_deaf: boolean;
    self_video: boolean;
}

export class Streamer {
    private _voiceConnection?: VoiceConnection;
    private _client: Client;

    private self_mute = false
    private self_deaf = true
    private self_video = false

    constructor(client: Client) {
        this._client = client;

        //listen for messages
        this.client.on('raw', (packet: any) => {
            this.handleGatewayEvent(packet.t, packet.d);
        });
    }

    public get client(): Client {
        return this._client;
    }

    public get voiceConnection(): VoiceConnection | undefined {
        return this._voiceConnection;
    }

    public sendOpcode(code: number, data: any): void {
        // @ts-ignore
        this.client.ws.broadcast({
            op: code,
            d: data,
        });
    }

    public joinVoice(guild_id: string, channel_id: string): Promise<MediaUdp> {
        return new Promise<MediaUdp>((resolve, reject) => {
            this._voiceConnection = new VoiceConnection(
                guild_id,
                this.client.user.id,
                channel_id,
                (voiceUdp) => {
                    resolve(voiceUdp);
                }
            );
            this.signalVideo(guild_id, channel_id, false);
        });
    }

    public createStream(): Promise<MediaUdp> {
        return new Promise<MediaUdp>((resolve, reject) => {
            if (!this.voiceConnection)
                reject("cannot start stream without first joining voice channel");

            this.signalStream(
                this.voiceConnection.guildId,
                this.voiceConnection.channelId
            );

            this.voiceConnection.streamConnection = new StreamConnection(
                this.voiceConnection.guildId,
                this.client.user.id,
                this.voiceConnection.channelId,
                (voiceUdp) => {
                    resolve(voiceUdp);
                }
            );
        });
    }

    public stopStream(): void {
        const stream = this.voiceConnection?.streamConnection;

        if(!stream) return;

        stream.stop();

        this.signalStopStream(stream.guildId, stream.channelId);

        this.voiceConnection.streamConnection = undefined;
    }

    public leaveVoice(): void {
        this.voiceConnection?.stop();

        this.signalLeaveVoice();

        this._voiceConnection = undefined;
    }

    public signalVideo(guild_id: string, channel_id: string, video_enabled: boolean): void {
        this.self_video = video_enabled
        this.setVoiceState(guild_id, channel_id)
    }

    public setVoiceState(guild_id: string, channel_id: string, { self_mute, self_deaf, self_video } = {} as Partial<VoiceState>) {
        this.sendOpcode(GatewayOpCodes.VOICE_STATE_UPDATE, {
            // @ts-ignore
            guild_id: guild_id,
            channel_id: channel_id,
            self_mute: self_mute ?? this.self_mute,
            self_deaf: self_deaf ?? this.self_deaf,
            self_video: self_video ?? this.self_video,
        });
    }


    public signalStream(guild_id: string, channel_id: string): void {
        this.sendOpcode(GatewayOpCodes.STREAM_CREATE, {
            type: "guild",
            guild_id,
            channel_id,
            preferred_region: null,
        });

        this.sendOpcode(GatewayOpCodes.STREAM_SET_PAUSED, {
            stream_key: `guild:${guild_id}:${channel_id}:${this.client.user.id}`,
            paused: false,
        });
    }

    public signalStopStream(guild_id: string, channel_id: string): void {
        this.sendOpcode(GatewayOpCodes.STREAM_DELETE, {
            stream_key: `guild:${guild_id}:${channel_id}:${this.client.user.id}`
        });
    }

    public signalLeaveVoice(): void {
        this.sendOpcode(GatewayOpCodes.VOICE_STATE_UPDATE, {
            guild_id: null,
            channel_id: null,
            self_mute: true,
            self_deaf: false,
            self_video: false,
        });
    }

    private handleGatewayEvent(event: string, data: any): void {
        switch(event) {
            case "VOICE_STATE_UPDATE": {
                if (data.user_id === this.client.user.id) {
                    // transfer session data to voice connection
                    this.voiceConnection?.setSession(data.session_id);
                }
                break;
            }
            case "VOICE_SERVER_UPDATE": {
                 // transfer voice server update to voice connection
                if (data.guild_id != this.voiceConnection?.guildId) return;

                this.voiceConnection?.setTokens(data.endpoint, data.token);
                break;
            }
            case "STREAM_CREATE": {
                const [type, guildId, channelId, userId] = data.stream_key.split(":");

                if (this.voiceConnection?.guildId != guildId) return;

                if (userId === this.client.user.id) {
                    this.voiceConnection.streamConnection.serverId = data.rtc_server_id;

                    this.voiceConnection.streamConnection.streamKey = data.stream_key;
                    this.voiceConnection.streamConnection.setSession(
                        this.voiceConnection.session_id
                    );
                }
                break;
            }
            case "STREAM_SERVER_UPDATE": {
                const [type, guildId, channelId, userId] = data.stream_key.split(":");

                if (this.voiceConnection?.guildId != guildId) return;

                if (userId === this.client.user.id) {
                    this.voiceConnection.streamConnection.setTokens(
                        data.endpoint,
                        data.token
                    );
                }
                break;
            }
        }
    }
}