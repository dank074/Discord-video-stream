import { EndBehaviorType, Streamer } from "@dank074/discord-video-stream";
import { execSync } from "child_process";
import { Client, GuildMember, VoiceChannel } from "discord.js-selfbot-v13";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { opus } from "prism-media";
import config from "./config.json";

const streamer = new Streamer(new Client());

// ready event
streamer.client.on("ready", async () => {
    console.log(`--- ${streamer.client.user.tag} is ready ---`);
});

streamer.client.on('messageCreate', async msg => {
    if (msg.author.bot) return;

    if (!config.acceptedAuthors.includes(msg.author.id)) return;

    if (!msg.content) return;

    const message = msg.content;

    if (message.startsWith("!join")) {
        if (msg.guildId != null) { // if its a DM, it will return null.
            if (msg.mentions.channels.size > 1) console.error("More than one channel was mentioned in a join message! Choosing first.");

            // define as VoiceChannel because we confirmed there was atleast one in the collection, and because if it isnt well get an error log anyway.
            const channel = msg.mentions.channels.first() as VoiceChannel;
            if (channel.type !== "GUILD_VOICE") return console.error("Channel mentioned in join message was not a voice channel!");

            // join voice channel and change voice state (unmute + deafen)
            await streamer.joinVoice(channel.guildId, channel.id);
            streamer.setVoiceState(channel.guildId, channel.id, {
                self_deaf: false,
                self_mute: true,
            })

            console.log(`[CHANNEL] Joined VoiceChannel NAME: "#${channel.name}", ID: ${channel.id}`);

            const tempDir = './tmp_data_store'

            console.log(`[FOLDER] Creating folder "${tempDir}" if not yet existed.`);

            if (!existsSync(tempDir)){
                mkdirSync(tempDir);
            }

            channel.members.each((user: GuildMember) => {
                const isValid = (user.id !== streamer.client.user?.id); // make sure the bot doesnt subscribe to itself.
                if (isValid) {
                    const stream = streamer.voiceConnection.reciever.subscribe(user.id, {
                        end: {
                            behavior: EndBehaviorType.AfterSilence,
                            duration: 3000
                        }
                    })

                    const tempFile = resolve(join(tempDir,`record_${user.id}.pcm`));
                    const finalFile = resolve(join(tempDir,`record_${user.id}.mp3`));
                    console.log(`[STREAM] Started: "${tempFile}" UserID: ${user.id}`);

                    const decoder = new opus.Decoder({ frameSize: 320, channels: 2, rate: 48000 });
                    const decodedStream = stream.pipe(decoder);

                    decodedStream.pipe(createWriteStream(tempFile));

                    stream.on("close", () => {
                        execSync(`ffmpeg -y -f s16le -ar 48k -ac 2 -i ${tempFile} ${finalFile}`, {
                            stdio: 'pipe'
                        })
                        rmSync(tempFile)
                        console.log(`[STREAM] Closed "${tempFile}" UserID: ${user.id}`);
                    });
                }
            });

            console.log('[STREAMS] Streams has started recording all users and will individually end after 3 second silence.');
        } else {
            console.log("this was sent in a dm im not doing shit lmao");
        }
    }
})

// login
streamer.client.login(config.token);