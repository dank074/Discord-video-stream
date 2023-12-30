import {
  Client,
  StageChannel,
  VoiceBasedChannel,
} from "discord.js-selfbot-v13";
import {
  command,
  streamLivestreamVideo,
  MediaUdp,
  setStreamOpts,
  streamOpts,
  getInputMetadata,
  inputHasAudio,
  Streamer,
} from "@dank074/discord-video-stream";
import { launch, getStream } from "puppeteer-stream";
import config from "./config.json";
import { Readable } from "stream";
import { executablePath } from "puppeteer";
require("dotenv").config();
import * as fs from "fs";
const { DateTime } = require("luxon");

const streamer = new Streamer(new Client());

setStreamOpts({
  width: config.streamOpts.width,
  height: config.streamOpts.height,
  fps: config.streamOpts.fps,
  bitrateKbps: config.streamOpts.bitrateKbps,
  maxBitrateKbps: config.streamOpts.maxBitrateKbps,
  hardware_acceleration: config.streamOpts.hardware_acceleration,
  video_codec: config.streamOpts.videoCodec === "H264" ? "H264" : "VP8",
});

// ready event
streamer.client.on("ready", () => {
  console.log(`--- ${streamer.client.user.tag} is ready ---`);
});

interface Schedule {
  msg: any;
  channel: VoiceBasedChannel;
  targetDateTime: Date;
  videoUrl: string;
}

const scheduleFilePath = "data/schedule.json";
const readSchedule = readScheduleFromJson();

if (readSchedule) {
  const {
    msg: storedMsg,
    channel: storedChannel,
    targetDateTime: storedTargetDateTime,
    videoUrl: storedVideoUrl,
  } = readSchedule;
  console.log("Found stored schedule:", storedTargetDateTime, storedVideoUrl);

  const now: Date = new Date();
  // Make sure storedTargetDateTime is a Date object
  const targetDateTime = new Date(storedTargetDateTime);

  // Check if this schedule has already passed
  if (targetDateTime.getTime() > now.getTime()) {
    var millisTillTime: number = targetDateTime.getTime() - now.getTime();
    if (millisTillTime < 0) {
      millisTillTime += 86400000;
    }

    setTimeout(async () => {
      console.log(
        `Attempting to join voice channel ${storedMsg.guildId}/${storedChannel.id}`
      );
      const vc = await streamer.joinVoice(storedMsg.guildId, storedChannel.id);

      if (storedChannel instanceof StageChannel) {
        await streamer.client.user.voice.setSuppressed(false);
      }

      streamer.signalVideo(storedMsg.guildId, storedChannel.id, true);

      const streamUdpConn = await streamer.createStream();
      await playVideo(storedVideoUrl, streamUdpConn);
      console.log("Streaming!");

      streamer.stopStream();
    }, millisTillTime);
  } else {
    // Schedule has already passed, clear the JSON file
    console.log("Schedule has already passed! Clearing schedule...");
    fs.writeFileSync(scheduleFilePath, "{}");
  }
} else {
  console.log("No schedule found in the file.");
}

// Function to write data to the JSON file
function writeScheduleToJson(schedule: Schedule): void {
  const jsonContent = JSON.stringify(schedule, null, 2);
  fs.writeFileSync(scheduleFilePath, jsonContent);
  console.log("Schedule has been written to local.");
}

// Function to read data from the JSON file
function readScheduleFromJson(): Schedule | null {
  try {
    const data = fs.readFileSync(scheduleFilePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading schedule from the file:", error);
    return null;
  }
}

// message event
streamer.client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  //   if (!process.env.ACCEPTED_AUTHORS.includes(msg.author.id)) return;
  if (!config.acceptedAuthors.includes(msg.author.id)) return;

  if (!msg.content) return;

  if (msg.content.startsWith(`$play-live`)) {
    const args = parseArgs(msg.content);
    if (!args) return;

    const channel = msg.author.voice.channel;

    if (!channel) return;

    console.log(
      `Attempting to join voice channel ${msg.guildId}/${channel.id}`
    );
    await streamer.joinVoice(msg.guildId, channel.id);

    if (channel instanceof StageChannel) {
      await streamer.client.user.voice.setSuppressed(false);
    }

    const streamUdpConn = await streamer.createStream();

    await playVideo(args.url, streamUdpConn);

    streamer.stopStream();
    return;
  } else if (msg.content.startsWith(`$schedule-live`)) {
    const args = parseArgs(msg.content);
    if (!args) return;

    const channel = msg.author.voice.channel;

    if (!channel) return;

    const userMsgs = msg.content.split(" ");
    const videoUrl = userMsgs[1];
    let date, time;

    // check if the user specified a date. if not, assume they're referring to the current day
    if (userMsgs[3]) {
      date = userMsgs[2];
      time = userMsgs[3];
    } else {
      date = DateTime.local().toISODate();
      time = userMsgs[2];
      console.log("No date specified, will play at", date, time);
    }

    const now: Date = new Date();
    const targetDateTime = DateTime.fromSQL(date + " " + time).toJSDate();
    console.log("'" + videoUrl + "' will play at ", targetDateTime + ".");

    const schedule: Schedule = { msg, channel, targetDateTime, videoUrl };
    writeScheduleToJson(schedule);

    var millisTillTime: number = targetDateTime.getTime() - now.getTime();
    // if (millisTillTime < 0) {
    //   millisTillTime += 86400000;
    // }

    setTimeout(async () => {
      console.log(
        `Attempting to join voice channel ${msg.guildId}/${channel.id}`
      );
      const vc = await streamer.joinVoice(msg.guildId, channel.id);

      if (channel instanceof StageChannel) {
        await streamer.client.user.voice.setSuppressed(false);
      }
      streamer.signalVideo(msg.guildId, channel.id, true);

      const streamUdpConn = await streamer.createStream();
      await playVideo(videoUrl, streamUdpConn);
      console.log("Streaming!");

      streamer.stopStream();
    }, millisTillTime);
    return;
  } else if (msg.content.startsWith("$play-cam")) {
    const args = parseArgs(msg.content);
    if (!args) return;

    const channel = msg.author.voice.channel;

    if (!channel) return;

    console.log(
      `Attempting to join voice channel ${msg.guildId}/${channel.id}`
    );
    const vc = await streamer.joinVoice(msg.guildId, channel.id);

    if (channel instanceof StageChannel) {
      await streamer.client.user.voice.setSuppressed(false);
    }

    streamer.signalVideo(msg.guildId, channel.id, true);

    playVideo(args.url, vc);

    return;
  } else if (msg.content.startsWith("$play-screen")) {
    const args = parseArgs(msg.content);
    if (!args) return;

    const channel = msg.author.voice.channel;

    if (!channel) return;

    console.log(
      `Attempting to join voice channel ${msg.guildId}/${channel.id}`
    );
    await streamer.joinVoice(msg.guildId, channel.id);

    if (channel instanceof StageChannel) {
      await streamer.client.user.voice.setSuppressed(false);
    }

    const streamUdpConn = await streamer.createStream();

    await streamPuppeteer(args.url, streamUdpConn);

    streamer.stopStream();

    return;
  } else if (msg.content.startsWith("$disconnect")) {
    command?.kill("SIGINT");

    streamer.leaveVoice();
  } else if (msg.content.startsWith("$stop-stream")) {
    command?.kill("SIGINT");

    const stream = streamer.voiceConnection?.streamConnection;

    if (!stream) return;

    streamer.stopStream();
  }
});

// login
streamer.client.login(config.token);
// streamer.client.login(process.env.AUTH_TOKEN);

async function playVideo(video: string, udpConn: MediaUdp) {
  let includeAudio = true;

  try {
    const metadata = await getInputMetadata(video);
    console.log(JSON.stringify(metadata.streams));
    includeAudio = inputHasAudio(metadata);
  } catch (e) {
    console.log(e);
    return;
  }

  console.log("Started playing video");

  udpConn.mediaConnection.setSpeaking(true);
  udpConn.mediaConnection.setVideoStatus(true);
  try {
    const res = await streamLivestreamVideo(video, udpConn, includeAudio);

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
    executablePath: executablePath(),
  });

  const page = await browser.newPage();
  await page.goto(url);

  // node typings are fucked, not sure why
  const stream: any = await getStream(page, {
    audio: true,
    video: true,
    mimeType: "video/webm;codecs=vp8,opus",
  });

  udpConn.mediaConnection.setSpeaking(true);
  udpConn.mediaConnection.setVideoStatus(true);
  try {
    // is there a way to distinguish audio from video chunks so we dont have to use ffmpeg ???
    const res = await streamLivestreamVideo(stream as Readable, udpConn);

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

  return { url };
}

type Args = {
  url: string;
};
