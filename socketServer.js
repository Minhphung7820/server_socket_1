const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios'); // Dùng để gọi API Laravel
const Redis = require('ioredis'); // Thư viện Redis

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

const redisClient = new Redis();
const userConnections = {};
const userDisconnections = {};

// time format yyyy-mm-dd H:i:s
const getCurrentTimeFormatted = () => {
    const now = new Date();

    // Lấy từng thành phần của thời gian
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0'); // Tháng +1 vì tháng tính từ 0
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');

    // Ghép lại theo định dạng Y-m-d H:i:s
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

app.get('/api/online-users', async (req, res) => {
    try {
        const users = await redisClient.hgetall('online_users');
        const onlineUsers = Object.values(users).map(user => JSON.parse(user));
        res.json({ data: onlineUsers });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch online users' });
    }
});

io.on('connection', (socket) => {
    const userID = socket.handshake.query.userID;

    if (!userID) {
        console.log('Connection without userID, disconnecting...');
        socket.disconnect();
        return;
    }

    if (!userConnections[userID]) {
        userConnections[userID] = new Set();
    }
    userConnections[userID].add(socket.id);

    // Xóa user khỏi danh sách ngắt kết nối nếu tồn tại
    if (userDisconnections[userID]) {
        delete userDisconnections[userID];
    }

    // Khi user kết nối, lưu trạng thái vào Redis
    const userData = {
        userID,
        isOnline: true,
        last_active: null
    };

    redisClient.hset('online_users', userID, JSON.stringify(userData));
    console.log(`User connected: ${userID}, Connections: ${userConnections[userID].size}`);

    // Gửi thông tin người dùng vừa kết nối đến tất cả client
    io.emit('user_list', {
        userID,
        online: true,
        last_active: null,
    });

    socket.on('send_friend_request', (data) => {
        const { sender_id, receiver_id } = data;

        if (receiver_id) {
            // Kiểm tra user nhận (receiver) có đang online không
            const receiverConnections = userConnections[receiver_id];
            if (receiverConnections) {
                // Gửi thông báo đến tất cả các kết nối của user nhận
                receiverConnections.forEach((socketId) => {
                    io.to(socketId).emit('receive_friend_request', {
                        sender_id,
                        receiver_id
                    });
                });
                console.log(`Sent friend request notification from ${sender_id} to ${receiver_id}`);
            } else {
                console.log(`Receiver ${receiver_id} is offline. Could not deliver notification.`);
            }
        } else {
            console.log('Invalid friend request data received');
        }
    });

    // thông báo cho người gửi lời mời kết bạn về phản hồi
    socket.on('noti_change_friend_request', (data) => {
        const { sender_id, receiver_id, status, conversation_id } = data;

        if (sender_id, receiver_id, status, conversation_id) {
            // Kiểm tra user nhận (receiver) có đang online không
            const receiverConnections = userConnections[receiver_id];
            if (receiverConnections) {
                // Gửi thông báo đến tất cả các kết nối của user nhận
                receiverConnections.forEach((socketId) => {
                    io.to(socketId).emit('receive_noti_change_friend_request', {
                        sender_id,
                        receiver_id,
                        status,
                        conversation_id
                    });
                });
            }
        }
    });

    // Lắng nghe sự kiện `join_conversation`
    socket.on('join_conversation', (conversation_id) => {
        if (conversation_id) {
            socket.join(`conversation_${conversation_id}`);
            console.log(`User ${userID} joined conversation: ${conversation_id}`);
        } else {
            console.log(`User ${userID} attempted to join a conversation without an ID`);
        }
    });

    // Lắng nghe sự kiện đang nhập
    socket.on('typing', (data) => {
        const { conversation_id, typewriter_id } = data;
        if (conversation_id && typewriter_id) {
            // Phát sự kiện "typing" đến tất cả thành viên trong phòng, trừ người gửi
            socket.to(`conversation_${conversation_id}`).emit('typing', {
                typewriter_id,
                conversation_id,
            });
            console.log(`User ${userID} is typing in conversation: ${conversation_id}`);
        }
    });

    // Lắng nghe và phát sự kiện seen message
    socket.on('seen_message', (data) => {
        const { conversation_id, viewer_id, name, avatar, sender_id } = data;
        if (conversation_id && viewer_id && name && avatar, sender_id) {
            // Phát sự kiện "seen" đến tất cả thành viên trong phòng, trừ người gửi
            socket.to(`conversation_${conversation_id}`).emit('seen_message', {
                viewer_id,
                conversation_id,
                name,
                avatar,
                sender_id
            });
            console.log(`User ${userID} seen in conversation: ${conversation_id}`);
        }
    });

    // Lắng nghe tin nhắn từ người dùng trong một conversation
    socket.on('send_message', async (data) => {
        const { conversation_id, content, sender_id } = data;

        if (conversation_id && content, sender_id) {
            // Phát tin nhắn đến các client trong conversation này
            io.to(`conversation_${conversation_id}`).emit('receive_message', {
                conversation_id,
                content,
                sender_id,
                timestamp: getCurrentTimeFormatted(),
            });
        } else {
            console.log('Invalid message data received');
        }
    });

    // Lắng nghe sự kiện thoát phòng
    socket.on('leave_conversation', (conversation_id) => {
        if (conversation_id) {
            socket.leave(`conversation_${conversation_id}`);
            console.log(`User ${userID} left conversation: ${conversation_id}`);
        } else {
            console.log(`User ${userID} attempted to leave a conversation without an ID`);
        }
    });

    socket.on('disconnect', async () => {
        userConnections[userID].delete(socket.id);
        if (userConnections[userID].size === 0) {
            delete userConnections[userID];
            console.log(`User disconnected: ${userID} (All connections closed)`);

            // Gọi API Laravel để cập nhật last_time_online
            try {
                const last_active = getCurrentTimeFormatted();

                // 1. Xóa user khỏi Redis
                await redisClient.hdel('online_users', userID);
                console.log(`User ${userID} removed from Redis`);

                // 2. Gửi sự kiện user_disconnect_list tới các client
                io.emit('user_disconnect_list', {
                    userID,
                    online: false,
                    last_active,
                });

                // 3. Gửi yêu cầu lưu trạng thái offline vào Laravel
                await axios.post('http://localhost:8000/api/set-last-online', {
                    userID,
                    last_active,
                });
                console.log(`Updated last_time_online in Laravel for user: ${userID}`);

                // 4. Cập nhật danh sách user ngắt kết nối (nếu cần dùng lại sau này)
                userDisconnections[userID] = {
                    last_active,
                };
                console.log(`Moved user ${userID} to userDisconnections`);
            } catch (error) {
                console.error(`Failed to handle disconnect for user: ${userID}`, error.message);
            }
        } else {
            console.log(`User disconnected: ${userID}, Remaining connections: ${userConnections[userID].size}`);
        }
    });
});

server.listen(6060, () => {
    console.log('Socket server is running on port 6060');
});