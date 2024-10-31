import { setTimeout } from "timers/promises";
import { Writable } from "node:stream";
import { combineLoHi } from "./utils.js";
import type { Packet } from "@libav.js/variant-webcodecs";

export class BaseMediaStream extends Writable {
    private _pts?: number;
    private _syncTolerance: number = 0;
    public syncStream?: BaseMediaStream;
    constructor() {
        super({ objectMode: true })
    }
    get pts(): number | undefined {
        return this._pts;
    }
    protected set pts(n: number | undefined) {    
        this._pts = n;
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
        while (
            this.syncStream &&
            !this.syncStream.writableEnded &&
            this.syncStream.pts !== undefined &&
            this._pts !== undefined &&
            this._pts - this.syncStream.pts > this._syncTolerance
        )
            await setTimeout(1);
    }
    protected async _sendFrame(_: Buffer): Promise<void>
    {
        throw new Error("Not implemented");
    }
    async _write(frame: Packet, _: BufferEncoding, callback: (error?: Error | null) => void) {
        await this._waitForOtherStream();

        const { data, ptshi, pts, time_base_num, time_base_den } = frame;
        await this._sendFrame(Buffer.from(data));
        if (ptshi !== undefined && pts !== undefined && time_base_num !== undefined && time_base_den !== undefined)
            this.pts = combineLoHi(ptshi, pts) / time_base_den * time_base_num;

        callback();
    }
    _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        super._destroy(error, callback);
        this.syncStream = undefined;
    }
}
