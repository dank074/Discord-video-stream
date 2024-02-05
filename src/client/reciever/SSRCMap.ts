import EventEmitter from "events";

export interface VoiceUserData {
	audioSSRC: number;
	videoSSRC?: number;
	userId: string;
}

export interface SSRCMapEvents {
	create: (newData: VoiceUserData) => Awaited<void>;
	update: (oldData: VoiceUserData | undefined, newData: VoiceUserData) => Awaited<void>;
	delete: (deletedData: VoiceUserData) => Awaited<void>;
}

export class SSRCMap extends EventEmitter {
	private readonly map: Map<number, VoiceUserData>;

	public constructor() {
		super();
		this.map = new Map();
	}

	public update(data: VoiceUserData) {
		const existing = this.map.get(data.audioSSRC);

		const newValue = {
			...this.map.get(data.audioSSRC),
			...data,
		};

		this.map.set(data.audioSSRC, newValue);
		if (!existing) this.emit('create', newValue);
		this.emit('update', existing, newValue);
	}

	public get(target: number | string) {
		if (typeof target === 'number') {
			return this.map.get(target);
		}

		for (const data of this.map.values()) {
			if (data.userId === target) {
				return data;
			}
		}

		return undefined;
	}

	public delete(target: number | string) {
		if (typeof target === 'number') {
			const existing = this.map.get(target);
			if (existing) {
				this.map.delete(target);
				this.emit('delete', existing);
			}
			return existing;
		}

		for (const [audioSSRC, data] of this.map.entries()) {
			if (data.userId === target) {
				this.map.delete(audioSSRC);
				this.emit('delete', data);
				return data;
			}
		}

		return undefined;
	}
}
