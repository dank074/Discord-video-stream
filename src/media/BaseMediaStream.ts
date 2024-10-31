import { Log } from "debug-level";
import { setTimeout } from "timers/promises";
import { Writable } from "node:stream";
import { combineLoHi } from "./utils.js";
import type { Packet } from "@libav.js/variant-webcodecs";

export class BaseMediaStream extends Writable {
    private _pts?: number;
    private _syncTolerance: number = 0;
    protected _type = "base";
    public syncStream?: BaseMediaStream;
    constructor() {
        super({ objectMode: true })
    }
    get pts(): number | undefined {
        return this._pts;
    }
    get syncTolerance() {
        return this._syncTolerance;
    }
    set syncTolerance(n: number) {
        if (n < 0)
            return;
        this._syncTolerance = n;
    }
    protected async _waitForOtherStream()
    {
        const loggerSync = new Log(`stream:${this._type}:sync`);
        let i = 0;
        while (
            this.syncStream &&
            !this.syncStream.writableEnded &&
            this.syncStream.pts !== undefined &&
            this._pts !== undefined &&
            this._pts - this.syncStream.pts > this._syncTolerance
        )
        {
            if (i == 0)
            {
                loggerSync.debug(`Waiting for other stream (%f - %f > %f)`,
                    this._pts, this.syncStream._pts, this._syncTolerance
                );
            }
            await setTimeout(1);
            i = (i + 1) % 10;
        }
    }
    protected async _sendFrame(_: Buffer): Promise<void>
    {
        throw new Error("Not implemented");
    }
    async _write(frame: Packet, _: BufferEncoding, callback: (error?: Error | null) => void) {
        const loggerSend = new Log(`stream:${this._type}:send`);

        await this._waitForOtherStream();

        const { data, ptshi, pts, durationhi, duration, time_base_num, time_base_den } = frame;
        let frametime = NaN;
        if (
            durationhi !== undefined && duration !== undefined &&
            time_base_num !== undefined && time_base_den !== undefined
        )
            frametime = combineLoHi(durationhi, duration) / time_base_den * time_base_num;

        const start = performance.now();
        await this._sendFrame(Buffer.from(data));
        const end = performance.now();
        if (ptshi !== undefined && pts !== undefined && time_base_num !== undefined && time_base_den !== undefined)
            this._pts = combineLoHi(ptshi, pts) / time_base_den * time_base_num;

        const sendTime = end - start;
        const ratio = sendTime / (frametime * 1000);
        loggerSend.debug(`Frame sent in ${sendTime}ms (${ratio * 100}% frametime)`, {
            stats: {
                pts: this._pts,
                duration: sendTime,
                frametime: frametime * 1000
            }
        })
        callback();
    }
    _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        super._destroy(error, callback);
        this.syncStream = undefined;
    }
}
