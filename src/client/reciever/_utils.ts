export type Awaited<T> = T | Promise<T>

// The Opus "silent" frame
export const AudioSilenceFrame = Buffer.from([0xf8, 0xff, 0xfe]);