import { Client, StageChannel } from "discord.js-selfbot-v13";
import { command, streamLivestreamVideo, MediaUdp, setStreamOpts, streamOpts, getInputMetadata, inputHasAudio, Streamer } from "@dank074/discord-video-stream";
import { launch, getStream } from 'puppeteer-stream';
import config from "./config.json";
import { Readable } from "stream";
import { executablePath } from 'puppeteer';

const streamer = new Streamer(new Client());

setStreamOpts({
    width: config.streamOpts.width, 
    height: config.streamOpts.height, 
    fps: config.streamOpts.fps, 
    bitrateKbps: config.streamOpts.bitrateKbps,
    maxBitrateKbps: config.streamOpts.maxBitrateKbps, 
    hardware_acceleration: config.streamOpts.hardware_acceleration,
    video_codec: config.streamOpts.videoCodec === 'H264' ? 'H264' : 'VP8'
})

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

        if(channel instanceof StageChannel)
        {
            await streamer.client.user.voice.setSuppressed(false);
        }

        const streamUdpConn = await streamer.createStream();

        await playVideo(args.url, streamUdpConn);

        streamer.stopStream();
        return;
    } else if (msg.content.startsWith("$play-cam")) {
        const args = parseArgs(msg.content);
        if (!args) return;

        const channel = msg.author.voice.channel;

        if(!channel) return;

        console.log(`Attempting to join voice channel ${msg.guildId}/${channel.id}`);
        const vc = await streamer.joinVoice(msg.guildId, channel.id);

        if(channel instanceof StageChannel)
        {
            await streamer.client.user.voice.setSuppressed(false);
        }

        streamer.signalVideo(msg.guildId, channel.id, true);

        playVideo(args.url, vc);

        return;
    } else if(msg.content.startsWith("$play-screen")) {
        const args = parseArgs(msg.content)
        if (!args) return;

        const channel = msg.author.voice.channel;

        if(!channel) return;

        console.log(`Attempting to join voice channel ${msg.guildId}/${channel.id}`);
        await streamer.joinVoice(msg.guildId, channel.id);

        if(channel instanceof StageChannel)
        {
            await streamer.client.user.voice.setSuppressed(false);
        }
        
        const streamUdpConn = await streamer.createStream();

        await streamPuppeteer(args.url, streamUdpConn);

        streamer.stopStream();

        return;
    } else if (msg.content.startsWith("$disconnect")) {
        command?.kill("SIGINT");

        streamer.leaveVoice();
    } else if(msg.content.startsWith("$stop-stream")) {
        command?.kill('SIGINT');

        const stream = streamer.voiceConnection?.streamConnection;

        if(!stream) return;

        streamer.stopStream();
    }
});

// login
streamer.client.login(config.token);

async function playVideo(video: string, udpConn: MediaUdp) {
    let includeAudio = true;
    let copyH264Codec = false;

    try {
        const metadata = await getInputMetadata(video);
        console.log(metadata)
        const videoStream = metadata.streams.find( (value) => value.codec_type === 'video' && value.codec_name === "h264" && value.pix_fmt === 'yuv420p')
        if(videoStream)
        {
            // lets copy the video instead
            console.log('copying codec')
            copyH264Codec = true;
            const fps = parseInt(videoStream.avg_frame_rate)
            const width = videoStream.width
            const height = videoStream.height
            console.log(fps, width, height, videoStream.profile)
            setStreamOpts({ fps, width, height })
        }
        //console.log(JSON.stringify(metadata.streams));
        includeAudio = inputHasAudio(metadata);
    } catch(e) {
        console.log(e);
        return;
    }

    console.log("Started playing video");

    udpConn.mediaConnection.setSpeaking(true);
    udpConn.mediaConnection.setVideoStatus(true);
    try {
        const res = await streamLivestreamVideo(video, udpConn, includeAudio, copyH264Codec);

        console.log("Finished playing video " + res);
    } catch (e) {
        console.log(e);
    } finally {
        udpConn.mediaConnection.setSpeaking(false);
        udpConn.mediaConnection.setVideoStatus(false);
    }
    command?.kill("SIGINT");
}

async function streamPuppeteer(url: string, udpConn: MediaUdp) {
    const browser = await launch({
        defaultViewport: {
            width: streamOpts.width,
            height: streamOpts.height,
        },
        executablePath: executablePath()
    });

    const page = await browser.newPage();
    await page.goto(url);

    // node typings are fucked, not sure why
    const stream: any = await getStream(page, { audio: true, video: true, mimeType: "video/webm;codecs=vp8,opus" }); 

    udpConn.mediaConnection.setSpeaking(true);
    udpConn.mediaConnection.setVideoStatus(true);
    try {
        // is there a way to distinguish audio from video chunks so we dont have to use ffmpeg ???
        const res = await streamLivestreamVideo((stream as Readable), udpConn);

        console.log("Finished playing video " + res);
    } catch (e) {
        console.log(e);
    } finally {
        udpConn.mediaConnection.setSpeaking(false);
        udpConn.mediaConnection.setVideoStatus(false);
    }
    command?.kill("SIGINT");
}

function parseArgs(message: string): Args | undefined {
    const args = message.split(" ");
    if (args.length < 2) return;

    const url = args[1];

    return { url }
}

type Args = {
    url: string;
}
