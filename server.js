const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Sudah diatur otomatis ke akun @coklatkeju_93
let targetUsername = process.env.TIKTOK_USERNAME || 'coklatkeju_93';

app.use(express.static(path.join(__dirname, 'public')));

// Endpoint anti-sleep agar hosting gratisan (Render.com) tidak mati saat OBS aktif
app.get('/ping', (req, res) => {
    res.status(200).send('OK');
});

let tiktokConnection = null;
let isConnected = false;
let reconnectTimer = null;

function connectToTikTok(username) {
    if (username) {
        targetUsername = username.replace(/^@/, '').trim().toLowerCase();
    }

    if (!targetUsername) return;

    if (tiktokConnection) {
        try {
            tiktokConnection.disconnect();
        } catch (e) {}
    }
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    console.log(`[MENGHUBUNGKAN] Mencari TikTok Live: @${targetUsername}...`);
    io.emit('status', { connected: false, username: targetUsername, message: `Mencari live @${targetUsername}...` });

    tiktokConnection = new WebcastPushConnection(targetUsername);

    tiktokConnection.connect().then(state => {
        isConnected = true;
        console.log(`[TERHUBUNG] Berhasil masuk ke live @${targetUsername} (Room ID: ${state.roomId})`);
        io.emit('status', { connected: true, username: targetUsername, message: `Terhubung ke @${targetUsername}` });
    }).catch(err => {
        isConnected = false;
        console.log(`[BELUM LIVE] @${targetUsername} belum live. Coba lagi dalam 20 detik...`);
        io.emit('status', {
            connected: false,
            username: targetUsername,
            message: `Menunggu @${targetUsername} mulai LIVE... (Cek otomatis)`
        });

        // Otomatis coba hubungkan ulang setiap 20 detik sampai akun mulai LIVE
        reconnectTimer = setTimeout(() => connectToTikTok(targetUsername), 20000);
    });

    // Event saat penonton mengirim komentar / chat
    tiktokConnection.on('chat', data => {
        io.emit('chat', {
            uniqueId: data.uniqueId,
            nickname: data.nickname,
            profilePictureUrl: data.profilePictureUrl,
            comment: data.comment
        });
    });

    // Event saat penonton tap-tap layar (Like)
    tiktokConnection.on('like', data => {
        io.emit('like', {
            uniqueId: data.uniqueId,
            nickname: data.nickname,
            likeCount: data.likeCount || 1,
            totalLikeCount: data.totalLikeCount
        });
    });

    // Event saat penonton Follow
    tiktokConnection.on('social', data => {
        if (data.displayType && data.displayType.includes('follow')) {
            io.emit('follow', {
                uniqueId: data.uniqueId,
                nickname: data.nickname
            });
        }
    });

    // Event saat penonton mengirim Gift
    tiktokConnection.on('gift', data => {
        if (data.giftType === 1 && !data.repeatEnd) return;
        io.emit('gift', {
            uniqueId: data.uniqueId,
            nickname: data.nickname,
            giftName: data.giftName,
            diamondCount: data.diamondCount,
            repeatCount: data.repeatCount
        });
    });

    // Jika live selesai, otomatis tunggu live berikutnya
    tiktokConnection.on('streamEnd', () => {
        isConnected = false;
        console.log(`[SELESAI] Live @${targetUsername} berakhir.`);
        io.emit('status', { connected: false, username: targetUsername, message: 'Live berakhir' });
        reconnectTimer = setTimeout(() => connectToTikTok(targetUsername), 20000);
    });
}

io.on('connection', (socket) => {
    socket.emit('status', {
        connected: isConnected,
        username: targetUsername,
        message: isConnected ? `Terhubung ke @${targetUsername}` : `Menunggu @${targetUsername} LIVE...`
    });

    socket.on('setUsername', (uname) => {
        if (!uname) return;
        const clean = uname.replace(/^@/, '').trim().toLowerCase();
        if (clean && (clean !== targetUsername || !isConnected)) {
            connectToTikTok(clean);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT} untuk akun @${targetUsername}`);
    connectToTikTok(targetUsername);
});
