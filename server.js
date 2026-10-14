const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const tiktokLive = require('tiktok-live-connector');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Pengaturan socket.io yang dioptimalkan untuk cloud hosting agar tidak tersendat
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['polling', 'websocket']
});

let targetUsername = process.env.TIKTOK_USERNAME || 'coklatkeju_93';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/ping', (req, res) => {
    res.status(200).send('OK');
});

let tiktokConnection = null;
let isConnected = false;
let lastStatusMessage = 'Memulai server...';
let reconnectTimer = null;

// Fungsi bantu untuk mengambil data penonton baik di versi 2.x (data.user) maupun versi 1.x
function extractUser(data) {
    const u = (data && data.user) ? data.user : (data || {});
    return {
        uniqueId: u.uniqueId || u.userId || data.uniqueId || 'penonton',
        nickname: u.nickname || u.uniqueId || data.nickname || 'Penonton',
        profilePictureUrl: u.profilePictureUrl || (u.profilePicture && u.profilePicture.urls && u.profilePicture.urls[0]) || data.profilePictureUrl || ''
    };
}

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

    lastStatusMessage = `Mencoba masuk ke live @${targetUsername}...`;
    console.log(`[MENGHUBUNGKAN] ${lastStatusMessage}`);
    io.emit('status', { connected: false, username: targetUsername, message: lastStatusMessage });

    try {
        tiktokConnection = new TikTokConnection(targetUsername, {
            processInitialData: false,
            enableExtendedGiftInfo: false,
            fetchRoomInfoOnConnect: true
        });
    } catch (err) {
        console.error('[INIT ERROR]', err.message);
        return;
    }

    // Mencegah server crash jika ada error internal dari stream
    tiktokConnection.on('error', err => {
        console.error(`[STREAM ERROR] @${targetUsername}:`, err.message || err);
    });

    tiktokConnection.connect().then(state => {
        isConnected = true;
        const roomId = state && state.roomId ? state.roomId : 'Aktif';
        lastStatusMessage = `Terhubung ke LIVE @${targetUsername} (Room: ${roomId})`;
        console.log(`[TERHUBUNG] ${lastStatusMessage}`);
        io.emit('status', { connected: true, username: targetUsername, message: lastStatusMessage });
    }).catch(err => {
        isConnected = false;
        const errMsg = err && err.message ? err.message : String(err);
        lastStatusMessage = `Gagal (@${targetUsername}): ${errMsg}`;
        console.error(`[ERROR KONEKSI] ${lastStatusMessage}`);

        io.emit('status', {
            connected: false,
            username: targetUsername,
            message: lastStatusMessage
        });

        // Coba hubungkan ulang otomatis setiap 15 detik
        reconnectTimer = setTimeout(() => connectToTikTok(targetUsername), 15000);
    });

    // Event saat penonton mengirim komentar / chat
    tiktokConnection.on('chat', data => {
        const user = extractUser(data);
        io.emit('chat', {
            uniqueId: user.uniqueId,
            nickname: user.nickname,
            profilePictureUrl: user.profilePictureUrl,
            comment: data.comment || ''
        });
    });

    // Event saat penonton tap-tap layar (Like)
    tiktokConnection.on('like', data => {
        const user = extractUser(data);
        io.emit('like', {
            uniqueId: user.uniqueId,
            nickname: user.nickname,
            likeCount: Number(data.likeCount) || 1,
            totalLikeCount: Number(data.totalLikeCount) || 0
        });
    });

    // Event saat penonton Follow (Versi 2.x menggunakan 'follow', Versi 1.x menggunakan 'social')
    tiktokConnection.on('follow', data => {
        const user = extractUser(data);
        io.emit('follow', {
            uniqueId: user.uniqueId,
            nickname: user.nickname
        });
    });

    tiktokConnection.on('social', data => {
        if (data.displayType && String(data.displayType).toLowerCase().includes('follow')) {
            const user = extractUser(data);
            io.emit('follow', {
                uniqueId: user.uniqueId,
                nickname: user.nickname
            });
        }
    });

    // Jika live selesai, otomatis tunggu live berikutnya
    tiktokConnection.on('streamEnd', () => {
        isConnected = false;
        lastStatusMessage = `Live @${targetUsername} telah berakhir.`;
        console.log(`[SELESAI] ${lastStatusMessage}`);
        io.emit('status', { connected: false, username: targetUsername, message: lastStatusMessage });
        reconnectTimer = setTimeout(() => connectToTikTok(targetUsername), 20000);
    });
}

io.on('connection', (socket) => {
    socket.emit('status', {
        connected: isConnected,
        username: targetUsername,
        message: lastStatusMessage
    });

    socket.on('setUsername', (uname) => {
        if (!uname) return;
        const clean = uname.replace(/^@/, '').trim().toLowerCase();
        if (clean) {
            connectToTikTok(clean);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT} untuk akun @${targetUsername}`);
    connectToTikTok(targetUsername);
});
