export type ReadyMessage = {
    ssrc: number,
    ip: string,
    port: number,
    modes: string[]
}

export type SessionMessage = {
    secret_key: number[]
}
