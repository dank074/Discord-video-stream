import { Readable, ReadableOptions } from 'node:stream';
import { AudioSilenceFrame } from "./_utils";


export enum EndBehaviorType {
	Manual,
	AfterSilence,
	AfterInactivity,
}

export type EndBehavior =
	| {
			behavior: EndBehaviorType.Manual;
	  }
	| {
			behavior: EndBehaviorType.AfterSilence | EndBehaviorType.AfterInactivity;
			duration: number;
	  };

export interface AudioReceiveStreamOptions extends ReadableOptions {
	end: EndBehavior;
}

export function createDefaultAudioReceiveStreamOptions(): AudioReceiveStreamOptions {
	return {
		end: {
			behavior: EndBehaviorType.Manual,
		},
	};
}

export class AudioReceiveStream extends Readable {
	public readonly end: EndBehavior;

	private endTimeout?: NodeJS.Timeout;

	public constructor({ end, ...options }: AudioReceiveStreamOptions) {
		super({
			...options,
			objectMode: true,
		});

		this.end = end;
	}

	public override push(buffer: Buffer | null) {
		if (buffer) {
			if (
				this.end.behavior === EndBehaviorType.AfterInactivity ||
				(this.end.behavior === EndBehaviorType.AfterSilence &&
					(buffer.compare(AudioSilenceFrame) !== 0 || typeof this.endTimeout === 'undefined'))
			) {
				this.renewEndTimeout(this.end);
			}
		}

		return super.push(buffer);
	}

	private renewEndTimeout(end: EndBehavior & { duration: number }) {
		if (this.endTimeout) {
			clearTimeout(this.endTimeout);
		}
		this.endTimeout = setTimeout(() => this.push(null), end.duration);
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	public override _read() {}
}
