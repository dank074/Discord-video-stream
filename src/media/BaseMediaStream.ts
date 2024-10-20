import { Writable } from "node:stream";

export class BaseMediaStream extends Writable {
    protected _pts?: number;
    get pts() {
        return this._pts;
    }
}
