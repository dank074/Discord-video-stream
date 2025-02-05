import { Client, StageChannel } from "discord.js-selfbot-v13";
import { Streamer, Utils, prepareStream, playStream } from "@dank074/discord-video-stream";
import config from "./config.json" with {type: "json"};

const streamer = new Streamer(new Client());
let current: ReturnType<typeof prepareStream>["command"];

// ready event
streamer.client.on("ready", () => {
    console.log(`--- ${streamer.client.user.tag} is ready ---`);
});

// message event
streamer.client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;

    if (!config.acceptedAuthors.includes(msg.author.id)) return;

    if (!msg.content) return;

    if (msg.content.startsWith(`$play-live`)) {
        const args = parseArgs(msg.content)
        if (!args) return;

        const channel = msg.author.voice.channel;

        if(!channel) return;

        console.log(`Attempting to join voice channel ${msg.guildId}/${channel.id}`);
        await streamer.joinVoice(msg.guildId, channel.id);

        if (channel instanceof StageChannel)
        {
            await streamer.client.user.voice.setSuppressed(false);
        }

        current?.kill("SIGTERM");
        const { command, output } = prepareStream(args.url, {
            width: config.streamOpts.width,
            height: config.streamOpts.height,
            frameRate: config.streamOpts.fps,
            bitrateVideo: config.streamOpts.bitrateKbps,
            bitrateVideoMax: config.streamOpts.maxBitrateKbps,
            hardwareAcceleratedDecoding: config.streamOpts.hardware_acceleration,
            videoCodec: Utils.normalizeVideoCodec(config.streamOpts.videoCodec)
        })
        command.on("error", (err) => {
            console.log("An error happened with ffmpeg");
            console.log(err);
        })
        current = command;
        await playStream(output, streamer)
            .catch(() => command.kill("SIGTERM"));
        return;
    } else if (msg.content.startsWith("$play-cam")) {
        const args = parseArgs(msg.content);
        if (!args) return;

        const channel = msg.author.voice.channel;

        if (!channel) return;

        console.log(`Attempting to join voice channel ${msg.guildId}/${channel.id}`);
        const vc = await streamer.joinVoice(msg.guildId, channel.id);

        if (channel instanceof StageChannel)
        {
            await streamer.client.user.voice.setSuppressed(false);
        }

        current?.kill("SIGTERM");
        const { command, output } = prepareStream(args.url, {
            width: config.streamOpts.width,
            height: config.streamOpts.height,
            frameRate: config.streamOpts.fps,
            bitrateVideo: config.streamOpts.bitrateKbps,
            bitrateVideoMax: config.streamOpts.maxBitrateKbps,
            hardwareAcceleratedDecoding: config.streamOpts.hardware_acceleration,
            videoCodec: Utils.normalizeVideoCodec(config.streamOpts.videoCodec)
        })

        current = command;
        await playStream(output, streamer)
            .catch(() => command.kill("SIGTERM"));
        return;
    } else if (msg.content.startsWith("$disconnect")) {
        current?.kill("SIGTERM");
        streamer.leaveVoice();
    } else if(msg.content.startsWith("$stop-stream")) {
        current?.kill("SIGTERM");
    }
});

// login
streamer.client.login(config.token);

function parseArgs(message: string): Args | undefined {
    const args = message.split(" ");
    if (args.length < 2) return;

    const url = args[1];

    return { url }
}

type Args = {
    url: string;
}
