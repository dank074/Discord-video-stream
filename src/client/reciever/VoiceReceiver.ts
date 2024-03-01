import { crypto_secretbox_open_easy } from "libsodium-wrappers";
import { VoiceConnection, VoiceOpCodes } from "../voice";
import {
    AudioReceiveStream,
    AudioReceiveStreamOptions,
    createDefaultAudioReceiveStreamOptions,
} from './AudioReceiveStream';
import { SSRCMap } from './SSRCMap';
import { SpeakingMap } from './SpeakingMap';

// credit to discord.js/voice

export class VoiceReceiver {
	public readonly voiceConnection;
	public readonly ssrcMap: SSRCMap;
	public readonly subscriptions: Map<string, AudioReceiveStream>;
	public readonly speaking: SpeakingMap;

	public constructor(voiceConnection: VoiceConnection) {
		this.voiceConnection = voiceConnection;
		this.ssrcMap = new SSRCMap();
		this.speaking = new SpeakingMap();
		this.subscriptions = new Map();

		this.onWsPacket = this.onWsPacket.bind(this);
		this.onUdpMessage = this.onUdpMessage.bind(this);
	}

	public onWsPacket(data: any) {
        const { op, d } = JSON.parse(data);

		if (op === VoiceOpCodes.CLIENT_DISCONNECT) {
			this.ssrcMap.delete(d.user_id);
		} else if (op === VoiceOpCodes.SPEAKING) {
			this.ssrcMap.update({ userId: d.user_id, audioSSRC: d.ssrc });
		} else if (op === VoiceOpCodes.VIDEO) {
			this.ssrcMap.update({
				userId: d.user_id,
				audioSSRC: d.audio_ssrc,
				videoSSRC: d.video_ssrc === 0 ? undefined : d.video_ssrc,
			});
		}
	}

	private decrypt(buffer: Buffer, nonce: Buffer, secretKey: Uint8Array) {
        // xsalsa20_poly1305_lite encryption
        buffer.copy(nonce, 0, buffer.length - 4);
        const end = buffer.length - 4;

		// Open packet
		const decrypted = crypto_secretbox_open_easy(buffer.slice(12, end), nonce, secretKey);
		if (!decrypted) return;
		return Buffer.from(decrypted);
	}

	private parsePacket(buffer: Buffer, nonce: Buffer, secretKey: Uint8Array) {
		let packet = this.decrypt(buffer, nonce, secretKey);
		if (!packet) return;

		// Strip RTP Header Extensions (one-byte only)
		if (packet[0] === 0xbe && packet[1] === 0xde && packet.length > 4) {
			const headerExtensionLength = packet.readUInt16BE(2);
			let offset = 4;
			for (let i = 0; i < headerExtensionLength; i++) {
				const byte = packet[offset];
				offset++;
				if (byte === 0) continue;
				offset += 1 + (byte >> 4);
			}
			// Skip over undocumented Discord byte (if present)
			const byte = packet.readUInt8(offset);
			if (byte === 0x00 || byte === 0x02) offset++;

			packet = packet.slice(offset);
		}

		return packet;
	}

	public onUdpMessage(msg: Buffer) {
		if (msg.length <= 8) return;
		const ssrc = msg.readUInt32BE(8);

		const userData = this.ssrcMap.get(ssrc);
        // console.log(userData);
		if (!userData) return;

		this.speaking.onPacket(userData.userId);

		const stream = this.subscriptions.get(userData.userId);
		if (!stream) return;

        const secretKey = this.voiceConnection.secretkey
        const nonceBuffer = Buffer.alloc(24)

		if (nonceBuffer && secretKey) {
			const packet = this.parsePacket(
				msg,
				nonceBuffer,
				secretKey,
			);
			if (packet) {
				stream.push(packet);
			} else {
				stream.destroy(new Error('Failed to parse packet'));
			}
		}
	}

	public subscribe(userId: string, options?: Partial<AudioReceiveStreamOptions>) {
		const existing = this.subscriptions.get(userId);
		if (existing) return existing;

		const stream = new AudioReceiveStream({
			...createDefaultAudioReceiveStreamOptions(),
			...options,
		});

		stream.once('close', () => this.subscriptions.delete(userId));
		this.subscriptions.set(userId, stream);
		return stream;
	}
}
