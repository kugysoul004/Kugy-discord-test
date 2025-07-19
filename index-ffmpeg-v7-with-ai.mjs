import { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { Player } from "discord-player";
import mongoose from "mongoose";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import fetch from 'node-fetch';
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🎵 Discord Music Bot - FFmpeg v7 COMPATIBLE VERSION");
console.log("🚀 Starting bot with enhanced audio resource handling...");

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

// Schema untuk chat history
const chatHistorySchema = new mongoose.Schema({
  userId: String,
  messages: [{
    role: String,
    content: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }]
});

const ChatHistory = mongoose.model("ChatHistory", chatHistorySchema);

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

// CRITICAL FIX: FFmpeg Validation dan Setup untuk FFmpeg v7
function checkFFmpeg() {
    try {
        const ffmpegVersion = execSync('ffmpeg -version', { stdio: 'pipe' }).toString();
        console.log("✅ FFmpeg found in system PATH");
        
        // Check if it's FFmpeg v7
        if (ffmpegVersion.includes('version 7')) {
            console.log("🔍 Detected FFmpeg version 7.x - Using enhanced compatibility mode");
            return { path: 'system', isV7: true };
        } else {
            console.log("🔍 Detected FFmpeg version:", ffmpegVersion.split('\n')[0]);
            return { path: 'system', isV7: false };
        }
    } catch (error) {
        console.log("⚠️ FFmpeg not found in system PATH, trying ffmpeg-static...");
        try {
            const ffmpegStatic = require('ffmpeg-static');
            if (ffmpegStatic) {
                console.log(`✅ FFmpeg-static found: ${ffmpegStatic}`);
                return { path: ffmpegStatic, isV7: false };
            }
        } catch (e) {
            console.log("⚠️ ffmpeg-static not available, trying @ffmpeg-installer/ffmpeg...");
            try {
                const ffmpeg = require('@ffmpeg-installer/ffmpeg');
                if (ffmpeg.path) {
                    console.log(`✅ @ffmpeg-installer/ffmpeg found: ${ffmpeg.path}`);
                    return { path: ffmpeg.path, isV7: false };
                }
            } catch (e2) {
                console.error("❌ No FFmpeg found! Installing ffmpeg-static...");
                try {
                    execSync('npm install ffmpeg-static --save', { stdio: 'inherit' });
                    const ffmpegStatic = require('ffmpeg-static');
                    console.log(`✅ FFmpeg-static installed: ${ffmpegStatic}`);
                    return { path: ffmpegStatic, isV7: false };
                } catch (installError) {
                    console.error("❌ Failed to install ffmpeg-static:", installError.message);
                    return { path: null, isV7: false };
                }
            }
        }
    }
    return { path: null, isV7: false };
}

const ffmpegInfo = checkFFmpeg();

// CRITICAL FIX: Enhanced Player Configuration untuk FFmpeg v7
const player = new Player(client, {
    // CRITICAL FIX: FFmpeg configuration untuk v7
    ffmpeg: {
        path: ffmpegInfo.path === 'system' ? 'ffmpeg' : ffmpegInfo.path,
        args: ffmpegInfo.isV7 ? [
            // Enhanced args for FFmpeg v7
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-analyzeduration', '0',
            '-loglevel', '0',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
        ] : [
            // Standard args for older FFmpeg
            '-analyzeduration', '0',
            '-loglevel', '0',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
        ]
    },
    // CRITICAL FIX: Enhanced ytdl options untuk audio resource creation
    ytdlOptions: {
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
        filter: 'audioonly',
        begin: 0,
        requestOptions: {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        }
    },
    // CRITICAL FIX: Audio player options untuk resource creation
    audioPlayerOptions: {
        behaviors: {
            noSubscriber: 'pause',
            maxMissedFrames: Math.round(5000 / 20),
        }
    },
    // CRITICAL FIX: Connection options
    connectionOptions: {
        selfDeaf: true,
        selfMute: false,
    },
    // CRITICAL FIX: Force audio resource creation
    skipFFmpeg: false,
    useLegacyFFmpeg: false,
    // CRITICAL FIX: Additional options untuk audio debugging
    bufferingTimeout: 5000, // Increased from 3000 for FFmpeg v7
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

// Load extractors
let extractorsLoaded = false;

async function loadExtractors() {
    try {
        // CRITICAL FIX: Load YoutubeiExtractor first for better YouTube compatibility
        const { YoutubeiExtractor } = await import('discord-player-youtubei');
        await player.extractors.register(YoutubeiExtractor, {
            // FFmpeg v7 compatibility options
            fetchOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        });
        console.log("✅ YouTube Extractor loaded!");
        
        const { DefaultExtractors } = await import('@discord-player/extractor');
        await player.extractors.loadMulti(DefaultExtractors);
        console.log("✅ Default Extractors loaded!");
        
        const loadedExtractors = player.extractors.store.size;
        console.log(`📊 Total extractors loaded: ${loadedExtractors}`);
        
        extractorsLoaded = true;
        
    } catch (error) {
        console.error("❌ Error loading extractors:", error.message);
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

// CRITICAL FIX: Enhanced Event Handlers dengan Audio Resource Monitoring
player.events.on("playerStart", (queue, track) => {
    console.log(`🎶 Now playing: ${track.title} - ${track.author}`);
    console.log(`⏱️ Duration: ${track.duration}`);
    console.log(`🔊 Audio URL: ${track.url ? 'Available' : 'Not Available'}`);
    console.log(`🔄 Loop mode: ${globalState.loopMode}`);
    
    // CRITICAL: Audio Resource Validation
    const audioResource = queue.node.resource;
    console.log(`🎵 Audio Resource: ${audioResource ? 'Created ✅' : 'Missing ❌'}`);
    
    if (audioResource) {
        console.log(`🔊 Audio Resource Details:`, {
            readable: audioResource.readable,
            ended: audioResource.ended,
            volume: audioResource.volume?.volume || 'N/A'
        });
    } else {
        console.error(`❌ CRITICAL: Audio Resource not created! This will cause no sound.`);
        
        // CRITICAL FIX: Enhanced recovery for FFmpeg v7
        setTimeout(() => {
            console.log(`🔄 Attempting to recreate audio resource with FFmpeg v7 compatibility...`);
            try {
                if (queue && queue.currentTrack) {
                    // Method 1: Skip and re-add
                    const currentTrack = queue.currentTrack;
                    queue.skip();
                    
                    // Add delay for FFmpeg v7
                    setTimeout(() => {
                        queue.insertTrack(currentTrack, 0);
                        console.log(`✅ Track re-added to force audio resource creation: ${currentTrack.title}`);
                        
                        // Method 2: If still no audio resource after 3 seconds, try to restart playback
                        setTimeout(() => {
                            if (!queue.node.resource) {
                                console.log(`⚠️ Still no audio resource, trying alternative method...`);
                                try {
                                    queue.node.skip();
                                } catch (e) {
                                    console.error(`❌ Alternative method failed:`, e);
                                }
                            }
                        }, 3000);
                    }, 1500); // Increased delay for FFmpeg v7
                }
            } catch (error) {
                console.error(`❌ Failed to recreate audio resource:`, error);
            }
        }, 2000);
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
                { name: '🔊 Audio Status', value: audioResource ? '✅ Resource Created' : '❌ Resource Missing', inline: true }
            )
            .setThumbnail(track.thumbnail);
            
        const row = createControlButtons();
        
        queue.metadata.channel.send({ 
            embeds: [embed], 
            components: [row] 
        });
        
        // Send warning if no audio resource
        if (!audioResource) {
            queue.metadata.channel.send(`⚠️ **Audio Resource Missing!** Mencoba memperbaiki...\n💡 Jika tidak ada suara, coba command \`!play\` lagi.`);
        }
    }
});

// CRITICAL: Audio Resource Creation Monitoring
player.events.on("audioTrackAdd", (queue, track) => {
    console.log(`📥 Track added to queue: ${track.title}`);
    console.log(`🔊 Queue audio resource: ${queue.node.resource ? 'Available' : 'Not Available'}`);
});

// CRITICAL: Monitor audio resource during playback
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

// CRITICAL FIX: Enhanced playerFinish event dengan audio resource debugging
player.events.on("playerFinish", (queue, track) => {
    console.log(`✅ Finished playing: ${track.title}`);
    console.log(`🔄 Loop mode: ${globalState.loopMode}`);
    console.log(`📊 Queue size after finish: ${queue.tracks.size}`);
    
    // CRITICAL: Check why audio resource is missing
    const audioResource = queue.node.resource;
    console.log(`🎵 Audio Resource state: ${audioResource ? 'Active' : 'Inactive'}`);
    
    if (!audioResource) {
        console.error(`❌ CRITICAL: Audio resource was missing during playback!`);
        console.log(`🔍 Possible causes:`);
        console.log(`   - FFmpeg v7 compatibility issues`);
        console.log(`   - Audio stream creation failed`);
        console.log(`   - Voice connection issues`);
        console.log(`   - Discord-player configuration problems`);
    }
    
    updateGlobalState(queue);
    
    // CRITICAL FIX: Enhanced quick finish detection for FFmpeg v7
    const trackDuration = track.durationMS || 0;
    const playTime = queue.history.lastPlayedTrackInfo?.playTime || 0;
    
    if (playTime > 0 && trackDuration > 10000 && playTime < 10000) {
        console.log(`⚠️ QUICK FINISH DETECTED: Track played for only ${playTime}ms out of ${trackDuration}ms`);
        console.log(`🔄 Attempting to replay track with FFmpeg v7 compatibility...`);
        
        // Re-add the track to the queue with FFmpeg v7 compatibility
        setTimeout(() => {
            try {
                queue.insertTrack(track, 0);
                console.log(`✅ Track re-added after quick finish: ${track.title}`);
            } catch (error) {
                console.error(`❌ Error re-adding track after quick finish:`, error);
            }
        }, 2000);
        
        // Notify user about quick finish
        if (queue.metadata && queue.metadata.channel) {
            queue.metadata.channel.send(`⚠️ **Lagu selesai terlalu cepat!** Mencoba memutar ulang...`);
        }
        
        return; // Skip normal loop logic
    }
    
    // LOOP LOGIC
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

// CRITICAL: Enhanced error handling dengan FFmpeg debugging
player.events.on("error", (queue, error) => {
    console.error(`❌ Player error:`, error);
    console.log(`🔍 Queue state: ${queue ? 'Active' : 'Inactive'}`);
    console.log(`🔍 Current track: ${queue?.currentTrack?.title || 'None'}`);
    console.log(`🔍 Audio resource: ${queue?.node?.resource ? 'Active' : 'Inactive'}`);
    console.log(`🔍 FFmpeg path: ${ffmpegInfo.path || 'Not configured'}`);
    console.log(`🔍 FFmpeg v7: ${ffmpegInfo.isV7 ? 'Yes' : 'No'}`);
    
    updateGlobalState(queue);
    
    if (queue.metadata && queue.metadata.channel) {
        queue.metadata.channel.send(`❌ Terjadi kesalahan audio: ${error.message}\n💡 Mencoba memutar lagu berikutnya...\n🔧 Jika masalah berlanjut, pastikan FFmpeg terinstall dengan benar.`);
    }
});

player.events.on("playerError", (queue, error) => {
    console.error(`❌ Player error event:`, error);
    console.log(`🔍 Error details:`, {
        message: error.message,
        stack: error.stack?.split('\n')[0],
        queue: queue ? 'Active' : 'Inactive',
        tracks: queue?.tracks?.size || 0,
        ffmpegPath: ffmpegInfo.path || 'Not configured',
        ffmpegV7: ffmpegInfo.isV7 ? 'Yes' : 'No'
    });
    
    // Auto-retry jika error saat playing
    if (queue && queue.tracks.size > 0) {
        console.log("🔄 Attempting to play next track after error...");
        setTimeout(() => {
            try {
                queue.skip();
            } catch (skipError) {
                console.error("❌ Error skipping after player error:", skipError);
                
                // CRITICAL FIX: Enhanced recovery for FFmpeg v7
                try {
                    console.log("🔄 Attempting alternative recovery method...");
                    if (queue.currentTrack) {
                        const currentTrack = queue.currentTrack;
                        queue.node.skip();
                        
                        setTimeout(() => {
                            queue.insertTrack(currentTrack, 0);
                        }, 2000);
                    }
                } catch (recoveryError) {
                    console.error("❌ Recovery method failed:", recoveryError);
                }
            }
        }, 1000);
    }
});

// CRITICAL FIX: Connection state monitoring for FFmpeg v7
player.events.on("connectionCreate", (queue) => {
    console.log(`🔌 Voice connection created for guild: ${queue.metadata?.guild?.name || 'Unknown'}`);
    console.log(`🔊 Voice channel: ${queue.connection?.channel?.name || 'Unknown'}`);
    
    // CRITICAL: Check connection state
    if (queue.connection) {
        console.log(`🔌 Connection state: ${queue.connection.state.status}`);
        console.log(`🔊 Connection ready: ${queue.connection.state.status === 'ready' ? 'Yes ✅' : 'No ❌'}`);
    }
    
    // CRITICAL FIX: Validate audio resource after connection
    setTimeout(() => {
        if (!queue.node.resource && queue.currentTrack) {
            console.log(`⚠️ No audio resource after connection, attempting to fix...`);
            try {
                const currentTrack = queue.currentTrack;
                queue.skip();
                
                setTimeout(() => {
                    queue.insertTrack(currentTrack, 0);
                }, 1500);
            } catch (error) {
                console.error(`❌ Error fixing missing audio resource:`, error);
            }
        }
    }, 3000);
});

// CRITICAL FIX: Connection destroyed event
player.events.on("connectionDestroy", (queue) => {
    console.log(`🔌 Voice connection destroyed for guild: ${queue.metadata?.guild?.name || 'Unknown'}`);
    updateGlobalState(queue);
});

// CRITICAL FIX: Debug event for FFmpeg v7 compatibility
player.events.on("debug", (queue, message) => {
    if (message.includes('error') || message.includes('fail') || message.includes('ffmpeg')) {
        console.log(`🔍 Player debug: ${message}`);
    }
});

// Command handler
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    
    const prefix = "!";
    if (!message.content.startsWith(prefix)) return;
    
    const args = message.content.slice(prefix.length).trim().split(/ +/g);
    const command = args.shift().toLowerCase();
    
    if (command === "play" || command === "p") {
        const query = args.join(" ");
        
        if (!query) return message.reply("❌ Mohon berikan judul lagu atau URL!");
        
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply("❌ Kamu harus berada di voice channel!");
        
        try {
            message.reply(`🔍 Searching for: **${query}**...`);
            
            // CRITICAL FIX: Clean YouTube URL for FFmpeg v7 compatibility
            const cleanQuery = isURL(query) ? cleanYouTubeURL(query) : query;
            
            // CRITICAL FIX: Enhanced search options for FFmpeg v7
            const searchResult = await player.search(cleanQuery, {
                requestedBy: message.author,
                searchEngine: isURL(cleanQuery) ? "auto" : "youtube",
                fallbackSearchEngine: "youtube",
                blockExtractors: [],
                sortResults: true
            });
            
            if (!searchResult || searchResult.tracks.length === 0) {
                return message.reply(`❌ No results found for: **${query}**!`);
            }
            
            // CRITICAL FIX: Enhanced queue options for FFmpeg v7
            const queue = player.nodes.create(message.guild, {
                metadata: {
                    channel: message.channel,
                    client: message.client,
                    requestedBy: message.author,
                    guild: message.guild
                },
                selfDeaf: true,
                volume: 80,
                leaveOnEmpty: false,
                leaveOnEmptyCooldown: 300000,
                leaveOnEnd: false,
                leaveOnEndCooldown: 300000,
                bufferingTimeout: 5000,
                connectionTimeout: 30000
            });
            
            try {
                if (!queue.connection) {
                    await queue.connect(message.member.voice.channel);
                }
            } catch (error) {
                console.error(`❌ Error connecting to voice channel:`, error);
                player.nodes.delete(message.guild.id);
                return message.reply(`❌ Error connecting to voice channel: ${error.message}`);
            }
            
            // CRITICAL FIX: Enhanced track add for FFmpeg v7
            const track = searchResult.tracks[0];
            
            if (searchResult.playlist) {
                queue.addTrack(searchResult.tracks);
                message.reply(`✅ Added playlist **${searchResult.playlist.title}** with ${searchResult.tracks.length} tracks to queue!`);
            } else {
                queue.addTrack(track);
                message.reply(`✅ Added **${track.title}** to queue!`);
            }
            
            if (!queue.isPlaying()) {
                try {
                    await queue.node.play();
                    console.log(`▶️ Started playing: ${queue.currentTrack.title}`);
                } catch (error) {
                    console.error(`❌ Error starting playback:`, error);
                    return message.reply(`❌ Error starting playback: ${error.message}`);
                }
            }
            
        } catch (error) {
            console.error(`❌ Error processing play command:`, error);
            message.reply(`❌ Error: ${error.message}`);
        }
    }
    
    else if (command === "skip" || command === "s") {
        const queue = player.nodes.get(message.guild.id);
        
        if (!queue || !queue.isPlaying()) {
            return message.reply("❌ No music is currently playing!");
        }
        
        const currentTrack = queue.currentTrack;
        queue.node.skip();
        message.reply(`⏭️ Skipped: **${currentTrack.title}**`);
    }
    
    else if (command === "stop") {
        const queue = player.nodes.get(message.guild.id);
        
        if (!queue) {
            return message.reply("❌ No active queue!");
        }
        
        queue.delete();
        message.reply("⏹️ Stopped the music and cleared the queue!");
    }
    
    else if (command === "pause") {
        const queue = player.nodes.get(message.guild.id);
        
        if (!queue || !queue.isPlaying()) {
            return message.reply("❌ No music is currently playing!");
        }
        
        queue.node.pause();
        message.reply("⏸️ Paused the current track!");
    }
    
    else if (command === "resume") {
        const queue = player.nodes.get(message.guild.id);
        
        if (!queue || queue.node.isPaused() === false) {
            return message.reply("❌ No music is currently paused!");
        }
        
        queue.node.resume();
        message.reply("▶️ Resumed the current track!");
    }
    
    else if (command === "queue" || command === "q") {
        const queue = player.nodes.get(message.guild.id);
        
        if (!queue || !queue.isPlaying()) {
            return message.reply("❌ No music is currently playing!");
        }
        
        const currentTrack = queue.currentTrack;
        const tracks = queue.tracks.map((track, index) => `${index + 1}. **${track.title}** - ${track.author}`);
        
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎵 Music Queue')
            .setDescription(`**Now Playing:**\n🎶 **${currentTrack.title}** - ${currentTrack.author}\n\n**Up Next:**\n${tracks.slice(0, 10).join('\n')}${tracks.length > 10 ? `\n...and ${tracks.length - 10} more track(s)` : ''}`)
            .addFields(
                { name: '🔄 Loop Mode', value: globalState.loopMode.toUpperCase(), inline: true },
                { name: '🔊 Volume', value: `${queue.node.volume}%`, inline: true },
                { name: '⏱️ Duration', value: currentTrack.duration, inline: true }
            )
            .setThumbnail(currentTrack.thumbnail);
            
        message.reply({ embeds: [embed] });
    }
    
    else if (command === "loop") {
        const queue = player.nodes.get(message.guild.id);
        
        if (!queue || !queue.isPlaying()) {
            return message.reply("❌ No music is currently playing!");
        }
        
        let mode = args[0]?.toLowerCase();
        
        if (!mode || !['off', 'track', 'queue'].includes(mode)) {
            mode = globalState.loopMode === 'off' ? 'track' : 
                   globalState.loopMode === 'track' ? 'queue' : 'off';
        }
        
        globalState.loopMode = mode;
        
        message.reply(`🔄 Loop mode set to: **${mode.toUpperCase()}**`);
    }
    
    else if (command === "volume" || command === "vol") {
        const queue = player.nodes.get(message.guild.id);
        
        if (!queue || !queue.isPlaying()) {
            return message.reply("❌ No music is currently playing!");
        }
        
        const volume = parseInt(args[0]);
        
        if (isNaN(volume) || volume < 0 || volume > 100) {
            return message.reply("❌ Volume must be between 0 and 100!");
        }
        
        queue.node.setVolume(volume);
        globalState.volume = volume;
        
        message.reply(`🔊 Volume set to: **${volume}%**`);
    }
    
    else if (command === "nowplaying" || command === "np") {
        const queue = player.nodes.get(message.guild.id);
        
        if (!queue || !queue.isPlaying()) {
            return message.reply("❌ No music is currently playing!");
        }
        
        const track = queue.currentTrack;
        const progress = queue.node.createProgressBar();
        
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎵 Now Playing')
            .setDescription(`**${track.title}**\nby ${track.author}`)
            .addFields(
                { name: '⏱️ Duration', value: track.duration, inline: true },
                { name: '🔄 Loop Mode', value: globalState.loopMode.toUpperCase(), inline: true },
                { name: '🔊 Volume', value: `${queue.node.volume}%`, inline: true },
                { name: '📊 Progress', value: progress, inline: false }
            )
            .setThumbnail(track.thumbnail);
            
        message.reply({ embeds: [embed] });
    }
    
    else if (command === "chat") {
        const query = args.join(" ");
        
        if (!query) {
            return message.reply("❓ Silakan berikan pertanyaan atau pesan untuk AI!");
        }
        
        if (!process.env.OPENROUTER_API_KEY) {
            return message.reply("❌ Fitur AI chat belum dikonfigurasi. Tambahkan OPENROUTER_API_KEY di file .env.");
        }
        
        // Menampilkan indikator typing
        await message.channel.sendTyping();
        
        try {
            // Mendapatkan atau membuat chat history untuk user
            let chatHistory = await ChatHistory.findOne({ userId: message.author.id });
            
            if (!chatHistory) {
                chatHistory = new ChatHistory({
                    userId: message.author.id,
                    messages: []
                });
            }
            
            // Tambahkan pesan user ke history
            chatHistory.messages.push({
                role: "user",
                content: query
            });
            
            // Batasi history ke 10 pesan terakhir untuk konteks
            const recentMessages = chatHistory.messages.slice(-10);
            
            // Format pesan untuk OpenRouter API
            const messages = recentMessages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
            
            // Pastikan ada system message di awal
            if (!messages.some(msg => msg.role === "system")) {
                messages.unshift({
                    role: "system",
                    content: "Kamu adalah asisten AI yang membantu pengguna Discord. Berikan jawaban yang singkat, padat, dan bermanfaat."
                });
            }
            
            console.log(`🤖 Sending chat request to OpenRouter API for user: ${message.author.username}`);
            
            // Kirim request ke OpenRouter API
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "HTTP-Referer": "https://discord-bot.example.com",
                    "X-Title": "Kugy Discord Bot"
                },
                body: JSON.stringify({
                    model: process.env.OPENROUTER_MODEL || "anthropic/claude-3-haiku",
                    messages: messages
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                console.error("❌ OpenRouter API Error:", errorData);
                return message.reply(`❌ Error: Tidak dapat terhubung ke AI. ${errorData.error?.message || "Coba lagi nanti."}`);
            }
            
            const data = await response.json();
            const aiResponse = data.choices[0].message.content;
            
            // Tambahkan respons AI ke history
            chatHistory.messages.push({
                role: "assistant",
                content: aiResponse
            });
            
            // Simpan chat history
            await chatHistory.save();
            
            // Kirim respons ke user
            // Jika respons terlalu panjang, bagi menjadi beberapa pesan
            if (aiResponse.length > 2000) {
                const chunks = aiResponse.match(/.{1,2000}/g);
                for (const chunk of chunks) {
                    await message.reply(chunk);
                }
            } else {
                await message.reply(aiResponse);
            }
            
        } catch (error) {
            console.error("❌ Chat command error:", error);
            message.reply(`❌ Error: ${error.message}`);
        }
    }
    
    else if (command === "chatclear") {
        try {
            await ChatHistory.findOneAndDelete({ userId: message.author.id });
            message.reply("✅ Riwayat chat Anda telah dihapus.");
        } catch (error) {
            console.error("❌ Error clearing chat history:", error);
            message.reply(`❌ Error: ${error.message}`);
        }
    }
    
    else if (command === "help") {
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🤖 Bot Commands')
            .setDescription('Here are the available commands:')
            .addFields(
                { name: '!play <song>', value: 'Play a song or add it to queue', inline: true },
                { name: '!skip', value: 'Skip the current song', inline: true },
                { name: '!stop', value: 'Stop playback and clear queue', inline: true },
                { name: '!pause', value: 'Pause the current song', inline: true },
                { name: '!resume', value: 'Resume playback', inline: true },
                { name: '!queue', value: 'Show the current queue', inline: true },
                { name: '!loop', value: 'Toggle loop mode (off/track/queue)', inline: true },
                { name: '!volume <0-100>', value: 'Set the volume', inline: true },
                { name: '!nowplaying', value: 'Show current song info', inline: true },
                { name: '!chat <pesan>', value: 'Berbicara dengan AI assistant', inline: true },
                { name: '!chatclear', value: 'Hapus riwayat chat dengan AI', inline: true }
            );
            
        message.reply({ embeds: [embed] });
    }
});

// Button interactions
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    
    const queue = player.nodes.get(interaction.guild.id);
    
    if (!queue && !interaction.customId.startsWith('music_')) return;
    
    if (interaction.customId === "music_play_pause") {
        if (queue.node.isPaused()) {
            queue.node.resume();
            await interaction.reply({ content: "▶️ Resumed playback!", ephemeral: true });
        } else {
            queue.node.pause();
            await interaction.reply({ content: "⏸️ Paused playback!", ephemeral: true });
        }
        
        // Update button
        const message = interaction.message;
        const row = createControlButtons();
        await message.edit({ components: [row] });
    }
    
    else if (interaction.customId === "music_skip") {
        if (!queue.isPlaying()) {
            return await interaction.reply({ content: "❌ No music is currently playing!", ephemeral: true });
        }
        
        const currentTrack = queue.currentTrack;
        queue.node.skip();
        await interaction.reply({ content: `⏭️ Skipped: **${currentTrack.title}**`, ephemeral: true });
    }
    
    else if (interaction.customId === "music_stop") {
        queue.delete();
        await interaction.reply({ content: "⏹️ Stopped the music and cleared the queue!", ephemeral: true });
    }
    
    else if (interaction.customId === "music_loop") {
        globalState.loopMode = globalState.loopMode === 'off' ? 'track' : 
                              globalState.loopMode === 'track' ? 'queue' : 'off';
        
        await interaction.reply({ content: `🔄 Loop mode set to: **${globalState.loopMode.toUpperCase()}**`, ephemeral: true });
        
        // Update button
        const message = interaction.message;
        const row = createControlButtons();
        await message.edit({ components: [row] });
    }
    
    else if (interaction.customId === "music_queue") {
        if (!queue.isPlaying()) {
            return await interaction.reply({ content: "❌ No music is currently playing!", ephemeral: true });
        }
        
        const currentTrack = queue.currentTrack;
        const tracks = queue.tracks.map((track, index) => `${index + 1}. **${track.title}** - ${track.author}`);
        
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎵 Music Queue')
            .setDescription(`**Now Playing:**\n🎶 **${currentTrack.title}** - ${currentTrack.author}\n\n**Up Next:**\n${tracks.slice(0, 10).join('\n')}${tracks.length > 10 ? `\n...and ${tracks.length - 10} more track(s)` : ''}`)
            .addFields(
                { name: '🔄 Loop Mode', value: globalState.loopMode.toUpperCase(), inline: true },
                { name: '🔊 Volume', value: `${queue.node.volume}%`, inline: true },
                { name: '⏱️ Duration', value: currentTrack.duration, inline: true }
            )
            .setThumbnail(currentTrack.thumbnail);
            
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// Dashboard API routes
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        uptime: client.uptime,
        guilds: client.guilds.cache.size,
        player: globalState,
        features: {
            music: true,
            ai: process.env.OPENROUTER_API_KEY ? true : false
        }
    });
});

app.get('/api/queue', (req, res) => {
    res.json(globalState);
});

// API untuk chat dengan AI
app.post('/api/chat', async (req, res) => {
    const { userId, message, username } = req.body;
    
    if (!userId || !message) {
        return res.status(400).json({ error: 'User ID and message are required' });
    }
    
    if (!process.env.OPENROUTER_API_KEY) {
        return res.status(503).json({ error: 'AI service not configured' });
    }
    
    try {
        // Mendapatkan atau membuat chat history untuk user
        let chatHistory = await ChatHistory.findOne({ userId });
        
        if (!chatHistory) {
            chatHistory = new ChatHistory({
                userId,
                messages: []
            });
        }
        
        // Tambahkan pesan user ke history
        chatHistory.messages.push({
            role: "user",
            content: message
        });
        
        // Batasi history ke 10 pesan terakhir untuk konteks
        const recentMessages = chatHistory.messages.slice(-10);
        
        // Format pesan untuk OpenRouter API
        const messages = recentMessages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
        
        // Pastikan ada system message di awal
        if (!messages.some(msg => msg.role === "system")) {
            messages.unshift({
                role: "system",
                content: "Kamu adalah asisten AI yang membantu pengguna Discord. Berikan jawaban yang singkat, padat, dan bermanfaat."
            });
        }
        
        console.log(`🤖 Sending chat request to OpenRouter API for user: ${username || userId}`);
        
        // Kirim request ke OpenRouter API
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "HTTP-Referer": "https://discord-bot.example.com",
                "X-Title": "Kugy Discord Bot"
            },
            body: JSON.stringify({
                model: process.env.OPENROUTER_MODEL || "anthropic/claude-3-haiku",
                messages: messages
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error("❌ OpenRouter API Error:", errorData);
            return res.status(500).json({ error: errorData.error?.message || "AI service error" });
        }
        
        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        
        // Tambahkan respons AI ke history
        chatHistory.messages.push({
            role: "assistant",
            content: aiResponse
        });
        
        // Simpan chat history
        await chatHistory.save();
        
        // Kirim respons
        res.json({
            response: aiResponse,
            userId,
            timestamp: new Date()
        });
        
    } catch (error) {
        console.error("❌ API chat error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/control', (req, res) => {
    const { action, guildId } = req.body;
    
    if (!guildId) {
        return res.status(400).json({ error: 'Guild ID is required' });
    }
    
    const queue = player.nodes.get(guildId);
    
    if (!queue) {
        return res.status(404).json({ error: 'No active queue found' });
    }
    
    try {
        switch (action) {
            case 'play':
                if (queue.node.isPaused()) {
                    queue.node.resume();
                    res.json({ success: true, action: 'resumed' });
                } else {
                    res.json({ success: false, error: 'Not paused' });
                }
                break;
                
            case 'pause':
                if (!queue.node.isPaused()) {
                    queue.node.pause();
                    res.json({ success: true, action: 'paused' });
                } else {
                    res.json({ success: false, error: 'Already paused' });
                }
                break;
                
            case 'skip':
                if (queue.isPlaying()) {
                    queue.node.skip();
                    res.json({ success: true, action: 'skipped' });
                } else {
                    res.json({ success: false, error: 'Not playing' });
                }
                break;
                
            case 'stop':
                queue.delete();
                res.json({ success: true, action: 'stopped' });
                break;
                
            case 'loop':
                const mode = req.body.mode;
                if (mode && ['off', 'track', 'queue'].includes(mode)) {
                    globalState.loopMode = mode;
                    res.json({ success: true, action: 'loop', mode });
                } else {
                    res.status(400).json({ error: 'Invalid loop mode' });
                }
                break;
                
            case 'volume':
                const volume = parseInt(req.body.volume);
                if (!isNaN(volume) && volume >= 0 && volume <= 100) {
                    queue.node.setVolume(volume);
                    globalState.volume = volume;
                    res.json({ success: true, action: 'volume', volume });
                } else {
                    res.status(400).json({ error: 'Invalid volume' });
                }
                break;
                
            default:
                res.status(400).json({ error: 'Invalid action' });
        }
    } catch (error) {
        console.error(`❌ Error in dashboard control:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Start the bot and server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🌐 Dashboard running on port ${PORT}`);
});

client.once("ready", () => {
    console.log(`🤖 Bot is online as ${client.user.tag}`);
    client.user.setActivity("!help | Music & AI", { type: "LISTENING" });
    
    // Cek konfigurasi OpenRouter
    if (process.env.OPENROUTER_API_KEY) {
        console.log("🤖 OpenRouter API configured - AI chat feature is enabled");
        console.log(`🤖 Using model: ${process.env.OPENROUTER_MODEL || "anthropic/claude-3-haiku"}`);
    } else {
        console.log("⚠️ OpenRouter API key not found - AI chat feature is disabled");
        console.log("⚠️ Add OPENROUTER_API_KEY to your .env file to enable AI chat");
    }
});

client.login(process.env.DISCORD_TOKEN);