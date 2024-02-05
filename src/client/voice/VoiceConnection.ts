import { VoiceReceiver } from "../reciever";
import { BaseMediaConnection } from './BaseMediaConnection';
import { MediaUdp } from "./MediaUdp";
import { StreamConnection } from './StreamConnection';
import { VoiceOpCodes } from "./VoiceOpCodes";

export class VoiceConnection extends BaseMediaConnection {
    public streamConnection?: StreamConnection;
    public reciever: VoiceReceiver;

    constructor(guildId: string, botId: string, channelId: string, callback: (udp: MediaUdp) => void) {
        super(guildId, botId, channelId, callback)

        this.reciever = new VoiceReceiver(this)
    }

    override setupEvents(): void {
        this.ws.on('message', (data: any) => {
            const { op, d } = JSON.parse(data);

            if (op == VoiceOpCodes.READY) { // ready
                this.handleReady(d);
                this.sendVoice();
                this.setVideoStatus(false);
            }
            else if (op === VoiceOpCodes.HELLO) {
                this.setupHeartbeat(d.heartbeat_interval);
            }
            else if (op === VoiceOpCodes.SELECT_PROTOCOL_ACK) {
                this.handleSession(d);
            }
            else if (op === VoiceOpCodes.RESUMED) {
                this.status.started = true;
                this.udp.ready = true;
            }

            this.reciever.onWsPacket(data)
        });
    }

    public override get serverId(): string {
        return this.guildId;
    }

    public override stop(): void {
        super.stop();
        this.streamConnection?.stop();
    }
}
