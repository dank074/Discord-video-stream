import type { SupportedEncryptionModes } from "../../utils.js"

export type ReadyMessage = {
    ssrc: number,
    ip: string,
    port: number,
    modes: SupportedEncryptionModes[],
    experiments: string[],
    streams: StreamInfo[]
}

type StreamInfo = {
    active: boolean,
    quality: number,
    rid: string,
    ssrc: number,
    rtx_ssrc: number,
    /**
     * always "video" from what I observed
     */
    type: string
}

export type SelectProtocolAck = {
    secret_key: number[],
    audio_codec: string,
    video_codec: string,
    mode: string,
}
