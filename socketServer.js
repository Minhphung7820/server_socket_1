const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios'); // Dùng để gọi API Laravel

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

const userConnections = {};

// Hàm gửi danh sách user hiện tại
const broadcastUserList = () => {
  const users = Object.keys(userConnections).map(userID => ({
    userID,
    online: userConnections[userID].size > 0
  }));
  io.emit('user_list', users);
};

// Route để nhận tin nhắn từ Laravel
app.post('/send-message', (req, res) => {
  const message = req.body.message;
  if (message) {
    io.emit('chat message', message);
    res.status(200).json({ success: true, message: 'Message sent to clients' });
  } else {
    res.status(400).json({ success: false, message: 'Message not found in request' });
  }
});

// Xử lý kết nối WebSocket
io.on('connection', (socket) => {
  const userID = socket.handshake.query.userID;

  if (!userConnections[userID]) {
    userConnections[userID] = new Set();
  }
  userConnections[userID].add(socket.id);
  console.log(`User connected: ${userID}, Connections: ${userConnections[userID].size}`);

  // Gửi danh sách user cho client
  broadcastUserList();

  socket.on('disconnect', async () => {
    userConnections[userID].delete(socket.id);
    if (userConnections[userID].size === 0) {
      delete userConnections[userID];
      console.log(`User disconnected: ${userID} (All connections closed)`);

      // Gọi API Laravel để cập nhật last_time_online
      try {
        await axios.post('http://localhost:8000/api/set-last-online', {
          userID
        });
        console.log(`Updated last_time_online for user: ${userID}`);
      } catch (error) {
        console.error(`Failed to update last_time_online for user: ${userID}`, error.message);
      }
    } else {
      console.log(`User disconnected: ${userID}, Remaining connections: ${userConnections[userID].size}`);
    }

    // Gửi danh sách user cho client
    broadcastUserList();
  });
});

server.listen(6060, () => {
  console.log('Socket server is running on port 6060');
});