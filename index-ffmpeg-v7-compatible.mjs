import { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { Player } from "discord-player";
import mongoose from "mongoose";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// Express App untuk Dashboard
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dashboard')));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

const userSchema = new mongoose.Schema({
  userId: String,
  xp: Number,
  level: Number,
});

const User = mongoose.model("User", userSchema);

// Global state untuk dashboard
let globalState = {
  isPlaying: false,
  currentTrack: null,
  queue: [],
  loopMode: 'off', // 'off', 'track', 'queue'
  volume: 100,
  guildId: null,
  voiceChannelId: null
};

// CRITICAL FIX: FFmpeg v7 Compatibility Check dan Setup
console.log("🎵 Discord Music Bot - FFmpeg v7 Compatible Version");

// Enhanced FFmpeg detection untuk v7 compatibility
function checkFFmpegV7() {
    try {
        const ffmpegVersion = execSync('ffmpeg -version', { stdio: 'pipe' }).toString();
        console.log("✅ FFmpeg found in system PATH");
        
        // Check if it's version 7
        if (ffmpegVersion.includes('ffmpeg version 7.')) {
            console.log("🎉 FFmpeg v7 detected - using optimized configuration");
            return { path: 'ffmpeg', version: 7 };
        } else {
            console.log("⚠️ FFmpeg version is not v7, using legacy configuration");
            return { path: 'ffmpeg', version: 'legacy' };
        }
    } catch (error) {
        console.log("⚠️ FFmpeg not found in system PATH, trying fallbacks...");
        try {
            const ffmpegStatic = require('ffmpeg-static');
            if (ffmpegStatic) {
                console.log(`✅ FFmpeg-static found: ${ffmpegStatic}`);
                return { path: ffmpegStatic, version: 'static' };
            }
        } catch (e) {
            console.log("⚠️ ffmpeg-static not available, trying @ffmpeg-installer/ffmpeg...");
            try {
                const ffmpeg = require('@ffmpeg-installer/ffmpeg');
                if (ffmpeg.path) {
                    console.log(`✅ @ffmpeg-installer/ffmpeg found: ${ffmpeg.path}`);
                    return { path: ffmpeg.path, version: 'installer' };
                }
            } catch (e2) {
                console.error("❌ No FFmpeg found! Please install FFmpeg v7");
                return null;
            }
        }
    }
}

const ffmpegInfo = checkFFmpegV7();

// CRITICAL FIX: Enhanced Player Configuration untuk FFmpeg v7
const player = new Player(client, {
    // FIXED: FFmpeg v7 optimized configuration
    ffmpeg: {
        path: ffmpegInfo?.path || 'ffmpeg',
        args: ffmpegInfo?.version === 7 ? [
            // FFmpeg v7 optimized arguments
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-i', 'pipe:0',
            '-analyzeduration', '0',
            '-loglevel', '0',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            '-filter:a', 'volume=0.5'
        ] : [
            // Legacy FFmpeg arguments
            '-analyzeduration', '0',
            '-loglevel', '0',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
        ]
    },
    // CRITICAL FIX: Enhanced ytdl options untuk FFmpeg v7 compatibility
    ytdlOptions: {
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
        filter: 'audioonly',
        begin: 0,
        requestOptions: {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        }
    },
    // CRITICAL FIX: Audio player options untuk FFmpeg v7 stability
    audioPlayerOptions: {
        behaviors: {
            noSubscriber: 'pause',
            maxMissedFrames: Math.round(5000 / 20),
        }
    },
    // CRITICAL FIX: Connection options untuk v7
    connectionOptions: {
        selfDeaf: true,
        selfMute: false,
    },
    // CRITICAL FIX: Force audio resource creation untuk v7
    skipFFmpeg: false,
    useLegacyFFmpeg: ffmpegInfo?.version !== 7,
    // CRITICAL FIX: Additional options untuk FFmpeg v7 debugging
    bufferingTimeout: 3000,
    disableVolume: false,
});

// Function untuk membersihkan URL YouTube
function cleanYouTubeURL(url) {
    try {
        if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
            return url;
        }
        
        let cleanUrl = url;
        cleanUrl = cleanUrl.split('&')[0];
        cleanUrl = cleanUrl.split('?si=')[0];
        cleanUrl = cleanUrl.split('?t=')[0];
        
        console.log(`🧹 URL cleaned: ${url} → ${cleanUrl}`);
        return cleanUrl;
    } catch (error) {
        console.log(`⚠️ Error cleaning URL, using original: ${url}`);
        return url;
    }
}

function isURL(query) {
    return query.includes('youtube.com') || 
           query.includes('youtu.be') || 
           query.includes('spotify.com') ||
           query.includes('soundcloud.com') ||
           query.startsWith('http');
}

// Load extractors dengan error handling
let extractorsLoaded = false;

async function loadExtractors() {
    try {
        console.log("📦 Loading YouTube extractor...");
        const { YoutubeiExtractor } = await import('discord-player-youtubei');
        await player.extractors.register(YoutubeiExtractor, {});
        console.log("✅ YouTube Extractor loaded!");
        
        console.log("📦 Loading default extractors...");
        const { DefaultExtractors } = await import('@discord-player/extractor');
        await player.extractors.loadMulti(DefaultExtractors);
        console.log("✅ Default Extractors loaded!");
        
        const loadedExtractors = player.extractors.store.size;
        console.log(`📊 Total extractors loaded: ${loadedExtractors}`);
        
        extractorsLoaded = true;
        
    } catch (error) {
        console.error("❌ Error loading extractors:", error.message);
        console.log("⚠️ Continuing without extractors - built-in YouTube support will be used");
        extractorsLoaded = false;
    }
}

await loadExtractors();

// Function untuk update global state
function updateGlobalState(queue) {
    if (queue) {
        globalState.isPlaying = queue.isPlaying();
        globalState.currentTrack = queue.currentTrack ? {
            title: queue.currentTrack.title,
            author: queue.currentTrack.author,
            duration: queue.currentTrack.duration,
            url: queue.currentTrack.url
        } : null;
        globalState.queue = queue.tracks.map(track => ({
            title: track.title,
            author: track.author,
            duration: track.duration
        }));
        globalState.guildId = queue.metadata?.guild?.id;
        globalState.voiceChannelId = queue.connection?.joinConfig?.channelId;
    }
}

// Function untuk create control buttons
function createControlButtons() {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_play_pause')
                .setLabel(globalState.isPlaying ? '⏸️ Pause' : '▶️ Play')
                .setStyle(globalState.isPlaying ? ButtonStyle.Secondary : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('music_skip')
                .setLabel('⏭️ Skip')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('music_stop')
                .setLabel('⏹️ Stop')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('music_loop')
                .setLabel(`🔄 Loop: ${globalState.loopMode.toUpperCase()}`)
                .setStyle(globalState.loopMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('music_queue')
                .setLabel('📋 Queue')
                .setStyle(ButtonStyle.Secondary)
        );
    return row;
}

// CRITICAL FIX: Enhanced Event Handlers untuk FFmpeg v7 compatibility
let trackStartTime = null;

player.events.on("playerStart", (queue, track) => {
    trackStartTime = Date.now();
    
    console.log(`🎶 Now playing: ${track.title} - ${track.author}`);
    console.log(`⏱️ Duration: ${track.duration}`);
    console.log(`🔊 Audio URL: ${track.url ? 'Available' : 'Not Available'}`);
    console.log(`🔄 Loop mode: ${globalState.loopMode}`);
    console.log(`🎵 FFmpeg version: ${ffmpegInfo?.version || 'Unknown'}`);
    
    // CRITICAL: Audio Resource Validation untuk FFmpeg v7
    const audioResource = queue.node.resource;
    console.log(`🎵 Audio Resource: ${audioResource ? 'Created ✅' : 'Missing ❌'}`);
    
    if (audioResource) {
        console.log(`🔊 Audio Resource Details:`, {
            readable: audioResource.readable,
            ended: audioResource.ended,
            volume: audioResource.volume?.volume || 'N/A',
            ffmpegVersion: ffmpegInfo?.version
        });
    } else {
        console.error(`❌ CRITICAL: Audio Resource not created! FFmpeg v7 compatibility issue detected.`);
        
        // Enhanced recovery untuk FFmpeg v7
        setTimeout(() => {
            console.log(`🔄 Attempting FFmpeg v7 compatible recovery...`);
            try {
                if (queue && queue.currentTrack) {
                    // Force recreate dengan FFmpeg v7 settings
                    queue.skip();
                    setTimeout(() => {
                        queue.insertTrack(track, 0);
                    }, 2000);
                }
            } catch (error) {
                console.error(`❌ FFmpeg v7 recovery failed:`, error);
            }
        }, 3000);
    }
    
    updateGlobalState(queue);
    
    if (queue.metadata && queue.metadata.channel) {
        const embed = new EmbedBuilder()
            .setColor(audioResource ? '#00FF00' : '#FF0000')
            .setTitle('🎶 Now Playing')
            .setDescription(`**${track.title}**\nby ${track.author}`)
            .addFields(
                { name: '⏱️ Duration', value: track.duration, inline: true },
                { name: '🔄 Loop Mode', value: globalState.loopMode.toUpperCase(), inline: true },
                { name: '🔊 Audio Status', value: audioResource ? '✅ Resource Created' : '❌ Resource Missing', inline: true },
                { name: '🎵 FFmpeg', value: `v${ffmpegInfo?.version || 'Unknown'}`, inline: true }
            )
            .setThumbnail(track.thumbnail);
            
        const row = createControlButtons();
        
        queue.metadata.channel.send({ 
            embeds: [embed], 
            components: [row] 
        });
        
        // Send warning if no audio resource dengan FFmpeg v7 context
        if (!audioResource) {
            queue.metadata.channel.send(`⚠️ **Audio Resource Missing!** FFmpeg v7 compatibility issue detected.\n💡 Mencoba recovery otomatis... Jika tidak ada suara, coba command \`!play\` lagi.`);
        }
    }
});

player.events.on("playerFinish", (queue, track) => {
    const playDuration = trackStartTime ? Date.now() - trackStartTime : 0;
    const playDurationSeconds = Math.floor(playDuration / 1000);
    
    console.log(`✅ Finished playing: ${track.title}`);
    console.log(`⏱️ Play duration: ${playDurationSeconds} seconds`);
    console.log(`🔄 Loop mode: ${globalState.loopMode}`);
    console.log(`📊 Queue size after finish: ${queue.tracks.size}`);
    
    // CRITICAL: Quick finish detection untuk FFmpeg v7
    if (playDurationSeconds < 10) {
        console.error(`❌ QUICK FINISH DETECTED: Track finished in ${playDurationSeconds}s (FFmpeg v7 issue)`);
        
        if (queue.metadata && queue.metadata.channel) {
            queue.metadata.channel.send(`⚠️ **Quick Finish Detected!** Lagu selesai terlalu cepat (${playDurationSeconds}s).\n🔄 Mencoba memutar ulang dengan FFmpeg v7 optimization...`);
        }
        
        // Auto-retry untuk quick finish dengan FFmpeg v7 optimization
        setTimeout(() => {
            try {
                console.log(`🔄 Auto-retry untuk quick finish: ${track.title}`);
                queue.insertTrack(track, 0);
            } catch (error) {
                console.error(`❌ Auto-retry failed:`, error);
            }
        }, 2000);
        
        return; // Don't process normal finish logic
    }
    
    // CRITICAL: Check audio resource state
    const audioResource = queue.node.resource;
    console.log(`🎵 Audio Resource state: ${audioResource ? 'Active' : 'Inactive'}`);
    
    if (!audioResource) {
        console.error(`❌ CRITICAL: Audio resource was missing during playback! (FFmpeg v7 compatibility issue)`);
        console.log(`🔍 FFmpeg v7 troubleshooting:`);
        console.log(`   - FFmpeg version: ${ffmpegInfo?.version}`);
        console.log(`   - FFmpeg path: ${ffmpegInfo?.path}`);
        console.log(`   - Audio stream creation failed`);
        console.log(`   - Voice connection issues`);
        console.log(`   - Discord-player v7 + FFmpeg v7 configuration problems`);
    }
    
    updateGlobalState(queue);
    
    // LOOP LOGIC dengan FFmpeg v7 optimization
    if (globalState.loopMode === 'track') {
        console.log(`🔄 Looping track: ${track.title}`);
        setTimeout(() => {
            try {
                queue.insertTrack(track, 0);
                console.log(`✅ Track re-added for loop: ${track.title}`);
            } catch (error) {
                console.error(`❌ Error looping track:`, error);
            }
        }, 1000);
    } else if (globalState.loopMode === 'queue' && queue.tracks.size === 0) {
        console.log(`🔄 Looping queue, adding ${track.title} to end`);
        setTimeout(() => {
            try {
                queue.addTrack(track);
                console.log(`✅ Track re-added to queue for loop: ${track.title}`);
            } catch (error) {
                console.error(`❌ Error looping queue:`, error);
            }
        }, 1000);
    }
    
    if (queue.tracks.size > 0) {
        console.log(`🔄 Playing next track...`);
    } else if (globalState.loopMode === 'off') {
        console.log(`📭 No more tracks, will leave in 30 seconds if no new songs added`);
    }
});

// Enhanced error handling untuk FFmpeg v7
player.events.on("error", (queue, error) => {
    console.error(`❌ Player error:`, error);
    console.log(`🔍 Queue state: ${queue ? 'Active' : 'Inactive'}`);
    console.log(`🔍 Current track: ${queue?.currentTrack?.title || 'None'}`);
    console.log(`🔍 Audio resource: ${queue?.node?.resource ? 'Active' : 'Inactive'}`);
    console.log(`🔍 FFmpeg version: ${ffmpegInfo?.version || 'Unknown'}`);
    console.log(`🔍 FFmpeg path: ${ffmpegInfo?.path || 'Not configured'}`);
    
    updateGlobalState(queue);
    
    if (queue.metadata && queue.metadata.channel) {
        queue.metadata.channel.send(`❌ Terjadi kesalahan audio: ${error.message}\n💡 Mencoba memutar lagu berikutnya...\n🔧 FFmpeg v${ffmpegInfo?.version || 'Unknown'} - Jika masalah berlanjut, restart bot.`);
    }
});

player.events.on("playerError", (queue, error) => {
    console.error(`❌ Player error event:`, error);
    console.log(`🔍 Error details:`, {
        message: error.message,
        stack: error.stack?.split('\n')[0],
        queue: queue ? 'Active' : 'Inactive',
        tracks: queue?.tracks?.size || 0,
        ffmpegVersion: ffmpegInfo?.version,
        ffmpegPath: ffmpegInfo?.path
    });
    
    // Auto-retry dengan FFmpeg v7 optimization
    if (queue && queue.tracks.size > 0) {
        console.log("🔄 Attempting to play next track after FFmpeg v7 error...");
        setTimeout(() => {
            try {
                queue.skip();
            } catch (skipError) {
                console.error("❌ Error skipping after player error:", skipError);
            }
        }, 2000);
    }
});

player.events.on("emptyQueue", (queue) => {
    console.log("📭 Queue empty");
    updateGlobalState(queue);
    
    if (globalState.loopMode === 'off') {
        console.log("🚪 Leaving voice channel in 30 seconds");
        if (queue.metadata && queue.metadata.channel) {
            queue.metadata.channel.send("✅ Antrian kosong. Bot akan keluar dari channel dalam 30 detik jika tidak ada lagu baru.");
        }
        
        setTimeout(() => {
            const currentQueue = player.queues.get(queue.metadata.guild.id);
            if (currentQueue && currentQueue.tracks.size === 0 && !currentQueue.isPlaying()) {
                console.log("🚪 Leaving voice channel due to empty queue");
                try {
                    currentQueue.delete();
                    globalState.isPlaying = false;
                    globalState.currentTrack = null;
                } catch (error) {
                    console.error("❌ Error leaving voice channel:", error);
                }
            }
        }, 30000);
    }
});

// Enhanced audio resource monitoring events
player.events.on("audioTrackAdd", (queue, track) => {
    console.log(`📥 Track added to queue: ${track.title}`);
    console.log(`🔊 Queue audio resource: ${queue.node.resource ? 'Available' : 'Not Available'}`);
    console.log(`🎵 FFmpeg version: ${ffmpegInfo?.version}`);
});

player.events.on("playerSkip", (queue, track) => {
    console.log(`⏭️ Track skipped: ${track.title}`);
    console.log(`🔊 Audio resource after skip: ${queue.node.resource ? 'Available' : 'Missing'}`);
    updateGlobalState(queue);
});

player.events.on("playerPause", (queue) => {
    console.log(`⏸️ Playback paused`);
    console.log(`🔊 Audio resource during pause: ${queue.node.resource ? 'Available' : 'Missing'}`);
    updateGlobalState(queue);
});

player.events.on("playerResume", (queue) => {
    console.log(`▶️ Playback resumed`);
    console.log(`🔊 Audio resource during resume: ${queue.node.resource ? 'Available' : 'Missing'}`);
    updateGlobalState(queue);
});

// Commands
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith("!")) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === "play" || command === "p") {
        if (!message.member.voice.channel) {
            return message.reply("❌ Kamu harus berada di voice channel untuk menggunakan command ini!");
        }

        const query = args.join(" ");
        if (!query) {
            return message.reply("❌ Silakan berikan nama lagu atau URL yang ingin diputar!");
        }

        try {
            const cleanedQuery = isURL(query) ? cleanYouTubeURL(query) : query;
            
            console.log(`🔍 Searching for: ${cleanedQuery}`);
            console.log(`🎵 FFmpeg version: ${ffmpegInfo?.version}`);
            console.log(`📦 Extractors loaded: ${extractorsLoaded}`);

            const searchResult = await player.search(cleanedQuery, {
                requestedBy: message.author,
                searchEngine: isURL(cleanedQuery) ? undefined : "youtube"
            });

            if (!searchResult || !searchResult.tracks.length) {
                return message.reply("❌ Tidak dapat menemukan lagu yang diminta!");
            }

            const queue = player.queues.create(message.guild.id, {
                metadata: {
                    channel: message.channel,
                    guild: message.guild,
                    requestedBy: message.author
                },
                // FFmpeg v7 specific queue options
                bufferingTimeout: 5000,
                connectionTimeout: 30000,
                leaveOnEmpty: true,
                leaveOnEmptyCooldown: 30000,
                leaveOnEnd: true,
                leaveOnEndCooldown: 30000
            });

            try {
                if (!queue.connection) {
                    await queue.connect(message.member.voice.channel);
                    console.log(`🔗 Connected to voice channel: ${message.member.voice.channel.name}`);
                    console.log(`🎵 Using FFmpeg v${ffmpegInfo?.version}`);
                }
            } catch (error) {
                console.error("❌ Voice connection error:", error);
                return message.reply("❌ Tidak dapat terhubung ke voice channel!");
            }

            const track = searchResult.tracks[0];
            queue.addTrack(track);
            updateGlobalState(queue);

            if (!queue.isPlaying()) {
                console.log(`🎵 Starting playback with FFmpeg v${ffmpegInfo?.version}`);
                await queue.play();
            }

            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🎵 Lagu Ditambahkan ke Antrian')
                .setDescription(`**${track.title}**\nby ${track.author}`)
                .addFields(
                    { name: '⏱️ Duration', value: track.duration, inline: true },
                    { name: '📊 Position in Queue', value: `${queue.tracks.size}`, inline: true },
                    { name: '🎵 FFmpeg', value: `v${ffmpegInfo?.version || 'Unknown'}`, inline: true }
                )
                .setThumbnail(track.thumbnail);

            const row = createControlButtons();
            message.reply({ embeds: [embed], components: [row] });

        } catch (error) {
            console.error("❌ Play command error:", error);
            message.reply(`❌ Terjadi kesalahan: ${error.message}\n🔧 FFmpeg v${ffmpegInfo?.version || 'Unknown'} - Coba lagi dalam beberapa detik.`);
        }
    }

    if (command === "skip" || command === "s") {
        const queue = player.queues.get(message.guild.id);
        if (!queue || !queue.isPlaying()) {
            return message.reply("❌ Tidak ada lagu yang sedang diputar!");
        }

        try {
            const currentTrack = queue.currentTrack;
            queue.skip();
            updateGlobalState(queue);
            message.reply(`⏭️ Skipped: **${currentTrack.title}**`);
        } catch (error) {
            console.error("❌ Skip error:", error);
            message.reply("❌ Terjadi kesalahan saat skip lagu!");
        }
    }

    if (command === "stop") {
        const queue = player.queues.get(message.guild.id);
        if (!queue) {
            return message.reply("❌ Tidak ada lagu yang sedang diputar!");
        }

        try {
            queue.delete();
            globalState.isPlaying = false;
            globalState.currentTrack = null;
            globalState.queue = [];
            message.reply("⏹️ Playback dihentikan dan bot keluar dari voice channel!");
        } catch (error) {
            console.error("❌ Stop error:", error);
            message.reply("❌ Terjadi kesalahan saat menghentikan playback!");
        }
    }

    if (command === "pause") {
        const queue = player.queues.get(message.guild.id);
        if (!queue || !queue.isPlaying()) {
            return message.reply("❌ Tidak ada lagu yang sedang diputar!");
        }

        try {
            queue.pause();
            updateGlobalState(queue);
            message.reply("⏸️ Playback dijeda!");
        } catch (error) {
            console.error("❌ Pause error:", error);
            message.reply("❌ Terjadi kesalahan saat pause!");
        }
    }

    if (command === "resume") {
        const queue = player.queues.get(message.guild.id);
        if (!queue || queue.isPlaying()) {
            return message.reply("❌ Tidak ada lagu yang dijeda!");
        }

        try {
            queue.resume();
            updateGlobalState(queue);
            message.reply("▶️ Playback dilanjutkan!");
        } catch (error) {
            console.error("❌ Resume error:", error);
            message.reply("❌ Terjadi kesalahan saat resume!");
        }
    }

    if (command === "queue" || command === "q") {
        const queue = player.queues.get(message.guild.id);
        if (!queue || (!queue.isPlaying() && queue.tracks.size === 0)) {
            return message.reply("❌ Antrian kosong!");
        }

        const tracks = queue.tracks.toArray();
        const currentTrack = queue.currentTrack;

        let queueString = "";
        if (currentTrack) {
            queueString += `**🎵 Now Playing:**\n${currentTrack.title} - ${currentTrack.author}\n\n`;
        }

        if (tracks.length > 0) {
            queueString += "**📋 Up Next:**\n";
            tracks.slice(0, 10).forEach((track, index) => {
                queueString += `${index + 1}. ${track.title} - ${track.author}\n`;
            });

            if (tracks.length > 10) {
                queueString += `\n... dan ${tracks.length - 10} lagu lainnya`;
            }
        }

        const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('📋 Music Queue')
            .setDescription(queueString)
            .addFields(
                { name: '🔄 Loop Mode', value: globalState.loopMode.toUpperCase(), inline: true },
                { name: '📊 Total Tracks', value: `${tracks.length + (currentTrack ? 1 : 0)}`, inline: true },
                { name: '🎵 FFmpeg', value: `v${ffmpegInfo?.version || 'Unknown'}`, inline: true }
            );

        const row = createControlButtons();
        message.reply({ embeds: [embed], components: [row] });
    }

    if (command === "loop") {
        const queue = player.queues.get(message.guild.id);
        if (!queue) {
            return message.reply("❌ Tidak ada lagu yang sedang diputar!");
        }

        const modes = ['off', 'track', 'queue'];
        const currentIndex = modes.indexOf(globalState.loopMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        globalState.loopMode = modes[nextIndex];

        message.reply(`🔄 Loop mode diubah ke: **${globalState.loopMode.toUpperCase()}**`);
    }

    if (command === "ffmpeg") {
        const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('🎵 FFmpeg Information')
            .addFields(
                { name: '📍 Path', value: ffmpegInfo?.path || 'Not found', inline: false },
                { name: '🔢 Version', value: `${ffmpegInfo?.version || 'Unknown'}`, inline: true },
                { name: '✅ Status', value: ffmpegInfo ? 'Available' : 'Not Available', inline: true },
                { name: '🔧 Compatibility', value: ffmpegInfo?.version === 7 ? 'Optimized for v7' : 'Legacy mode', inline: true }
            );

        message.reply({ embeds: [embed] });
    }

    if (command === "help") {
        const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('🎵 Kugy Music Bot - FFmpeg v7 Compatible')
            .setDescription('Bot musik Discord dengan dukungan FFmpeg v7 dan fitur AI chat!')
            .addFields(
                { name: '🎵 Music Commands', value: '`!play <lagu/url>` - Putar musik\n`!skip` - Skip lagu\n`!stop` - Stop musik\n`!pause` - Pause musik\n`!resume` - Resume musik\n`!queue` - Lihat antrian\n`!loop` - Toggle loop mode', inline: false },
                { name: '🤖 AI Commands', value: '`!chat <pesan>` - Chat dengan Kugy AI\n`@Kugy <pesan>` - Mention untuk chat', inline: false },
                { name: '🔧 System Commands', value: '`!ffmpeg` - Check FFmpeg status\n`!help` - Tampilkan help ini', inline: false },
                { name: '🎯 Features', value: '✅ FFmpeg v7 Compatible\n✅ YouTube Music Support\n✅ Interactive Button Controls\n✅ AI Chat dengan OpenRouter\n✅ Real-time Dashboard', inline: false }
            )
            .setFooter({ text: 'Kugy Bot v1.1.0 - FFmpeg v7 Ready!' });

        message.reply({ embeds: [embed] });
    }

    // AI Chat dengan OpenRouter
    if (message.mentions.has(client.user.id) || message.content.startsWith("!chat ")) {
        const prompt = message.content
            .replace(`<@${client.user.id}>`, "")
            .replace("!chat ", "")
            .trim();

        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "HTTP-Referer": "https://github.com/kugysoul004/Kugy-discord-test",
                    "X-Title": "Kugy Discord Bot"
                },
                body: JSON.stringify({
                    model: "anthropic/claude-3.5-sonnet",
                    messages: [
                        {
                            role: "system",
                            content: "You are Kugy AI, a cute, supportive, and humble Indonesian assistant. Always reply warmly and motivatively. You also help with music bot commands and FFmpeg v7 troubleshooting."
                        },
                        { role: "user", content: prompt }
                    ]
                })
            });

            const data = await response.json();
            const aiReply = data.choices[0].message.content;
            await message.reply({ content: `<@${message.author.id}> ${aiReply}` });
        } catch (error) {
            console.error("❌ AI Chat error:", error);
            await message.reply("❌ Gagal menghubungi Kugy AI. Coba lagi nanti ya! 🤖");
        }
    }
});

// Button interactions
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    const queue = player.queues.get(interaction.guild.id);

    try {
        switch (interaction.customId) {
            case 'music_play_pause':
                if (!queue) {
                    return interaction.reply({ content: "❌ Tidak ada lagu yang sedang diputar!", ephemeral: true });
                }

                if (queue.isPlaying()) {
                    queue.pause();
                    await interaction.reply({ content: "⏸️ Playback dijeda!", ephemeral: true });
                } else {
                    queue.resume();
                    await interaction.reply({ content: "▶️ Playback dilanjutkan!", ephemeral: true });
                }
                updateGlobalState(queue);
                break;

            case 'music_skip':
                if (!queue || !queue.isPlaying()) {
                    return interaction.reply({ content: "❌ Tidak ada lagu yang sedang diputar!", ephemeral: true });
                }

                const currentTrack = queue.currentTrack;
                queue.skip();
                updateGlobalState(queue);
                await interaction.reply({ content: `⏭️ Skipped: **${currentTrack.title}**`, ephemeral: true });
                break;

            case 'music_stop':
                if (!queue) {
                    return interaction.reply({ content: "❌ Tidak ada lagu yang sedang diputar!", ephemeral: true });
                }

                queue.delete();
                globalState.isPlaying = false;
                globalState.currentTrack = null;
                globalState.queue = [];
                await interaction.reply({ content: "⏹️ Playback dihentikan!", ephemeral: true });
                break;

            case 'music_loop':
                if (!queue) {
                    return interaction.reply({ content: "❌ Tidak ada lagu yang sedang diputar!", ephemeral: true });
                }

                const modes = ['off', 'track', 'queue'];
                const currentIndex = modes.indexOf(globalState.loopMode);
                const nextIndex = (currentIndex + 1) % modes.length;
                globalState.loopMode = modes[nextIndex];

                await interaction.reply({ content: `🔄 Loop mode: **${globalState.loopMode.toUpperCase()}**`, ephemeral: true });
                break;

            case 'music_queue':
                if (!queue || (!queue.isPlaying() && queue.tracks.size === 0)) {
                    return interaction.reply({ content: "❌ Antrian kosong!", ephemeral: true });
                }

                const tracks = queue.tracks.toArray();
                const current = queue.currentTrack;

                let queueString = "";
                if (current) {
                    queueString += `**🎵 Now Playing:**\n${current.title} - ${current.author}\n\n`;
                }

                if (tracks.length > 0) {
                    queueString += "**📋 Up Next:**\n";
                    tracks.slice(0, 5).forEach((track, index) => {
                        queueString += `${index + 1}. ${track.title} - ${track.author}\n`;
                    });

                    if (tracks.length > 5) {
                        queueString += `\n... dan ${tracks.length - 5} lagu lainnya`;
                    }
                }

                const embed = new EmbedBuilder()
                    .setColor('#0099FF')
                    .setTitle('📋 Music Queue')
                    .setDescription(queueString)
                    .addFields(
                        { name: '🔄 Loop Mode', value: globalState.loopMode.toUpperCase(), inline: true },
                        { name: '📊 Total Tracks', value: `${tracks.length + (current ? 1 : 0)}`, inline: true }
                    );

                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;
        }
    } catch (error) {
        console.error("❌ Button interaction error:", error);
        if (!interaction.replied) {
            await interaction.reply({ content: "❌ Terjadi kesalahan!", ephemeral: true });
        }
    }
});

// Dashboard routes
app.get('/api/status', (req, res) => {
    res.json({
        ...globalState,
        ffmpeg: {
            version: ffmpegInfo?.version || 'Unknown',
            path: ffmpegInfo?.path || 'Not found',
            compatible: ffmpegInfo?.version === 7
        },
        extractors: {
            loaded: extractorsLoaded,
            count: player.extractors.store.size
        }
    });
});

app.post('/api/control/:action', (req, res) => {
    const { action } = req.params;
    const queue = globalState.guildId ? player.queues.get(globalState.guildId) : null;

    if (!queue) {
        return res.status(400).json({ error: 'No active queue' });
    }

    try {
        switch (action) {
            case 'play':
                queue.resume();
                break;
            case 'pause':
                queue.pause();
                break;
            case 'skip':
                queue.skip();
                break;
            case 'stop':
                queue.delete();
                globalState.isPlaying = false;
                globalState.currentTrack = null;
                globalState.queue = [];
                break;
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }

        updateGlobalState(queue);
        res.json({ success: true, state: globalState });
    } catch (error) {
        console.error('Dashboard control error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start dashboard server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Dashboard server running on port ${PORT}`);
});

// Bot login
client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log(`✅ Bot logged in as ${client.user.tag}`);
        console.log(`🎵 FFmpeg v${ffmpegInfo?.version || 'Unknown'} ready for music playback`);
        console.log(`📦 Extractors: ${extractorsLoaded ? 'Loaded' : 'Using built-in'}`);
    })
    .catch(error => {
        console.error("❌ Bot login error:", error);
    });

client.on("ready", () => {
    console.log(`🤖 ${client.user.tag} is online!`);
    console.log(`🎵 Music system ready with FFmpeg v${ffmpegInfo?.version || 'Unknown'}`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
});