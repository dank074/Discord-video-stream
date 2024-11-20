import { setTimeout } from "timers/promises";
import { Writable } from "node:stream";

export class BaseMediaStream extends Writable {
    private _pts?: number;
    private _syncTolerance: number = 0;
    public syncStream?: BaseMediaStream;
    public timeout: NodeJS.Timeout | undefined;

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
    _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        super._destroy(error, callback);
        this.syncStream = undefined;
    }

    public cancel(): void {
        clearTimeout(this.timeout);
        this.end();
    }
}
