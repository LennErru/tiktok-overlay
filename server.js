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

let targetUsername = process.env.TIKTOK_USERNAME || 'coklatkeju_93';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/ping', (req, res) => {
    res.status(200).send('OK');
});

let tiktokConnection = null;
let isConnected = false;
let lastStatusMessage = 'Memulai server...';
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

    lastStatusMessage = `Mencoba masuk ke live @${targetUsername}...`;
    console.log(`[MENGHUBUNGKAN] ${lastStatusMessage}`);
    io.emit('status', { connected: false, username: targetUsername, message: lastStatusMessage });

    // Opsi penting agar koneksi dari Railway tidak ditolak oleh TikTok
    tiktokConnection = new WebcastPushConnection(targetUsername, {
        processInitialData: false,
        enableExtendedGiftInfo: false,
        enableWebsocketUpgrade: true,
        requestPollingIntervalMs: 2000
    });

    tiktokConnection.connect().then(state => {
        isConnected = true;
        lastStatusMessage = `Terhubung ke LIVE @${targetUsername} (Room: ${state.roomId})`;
        console.log(`[TERHUBUNG] ${lastStatusMessage}`);
        io.emit('status', { connected: true, username: targetUsername, message: lastStatusMessage });
    }).catch(err => {
        isConnected = false;
        const errMsg = err && err.message ? err.message : String(err);
        lastStatusMessage = `Gagal (@${targetUsername}): ${errMsg}`;
        console.error(`[ERROR KONEKSI] ${lastStatusMessage}`);
        
        // Tampilkan pesan error asli langsung di kotak status halaman web
        io.emit('status', {
            connected: false,
            username: targetUsername,
            message: lastStatusMessage
        });

        // Coba hubungkan ulang otomatis setiap 15 detik
        reconnectTimer = setTimeout(() => connectToTikTok(targetUsername), 15000);
    });

    tiktokConnection.on('chat', data => {
        io.emit('chat', {
            uniqueId: data.uniqueId,
            nickname: data.nickname,
            profilePictureUrl: data.profilePictureUrl,
            comment: data.comment
        });
    });

    tiktokConnection.on('like', data => {
        io.emit('like', {
            uniqueId: data.uniqueId,
            nickname: data.nickname,
            likeCount: data.likeCount || 1,
            totalLikeCount: data.totalLikeCount
        });
    });

    tiktokConnection.on('social', data => {
        if (data.displayType && data.displayType.includes('follow')) {
            io.emit('follow', {
                uniqueId: data.uniqueId,
                nickname: data.nickname
            });
        }
    });

    tiktokConnection.on('streamEnd', () => {
        isConnected = false;
        lastStatusMessage = `Live @${targetUsername} telah berakhir.`;
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
