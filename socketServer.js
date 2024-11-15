const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json()); // Middleware để xử lý JSON

// Quản lý trạng thái user
const userConnections = {};

// Route để kiểm tra kết nối
app.get('/', (req, res) => {
  res.send("WebSocket server is running");
});

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

  // Nếu userID không có trong danh sách, khởi tạo Set để quản lý kết nối
  if (!userConnections[userID]) {
    userConnections[userID] = new Set();
  }

  // Thêm ID socket vào danh sách kết nối của user
  userConnections[userID].add(socket.id);
  console.log(`User connected: ${userID}, Connections: ${userConnections[userID].size}`);

  // Phát sự kiện "online" tới client
  io.emit('user_status', { userID, status: 'online' });

  // Khi nhận tin nhắn từ client
  socket.on('chat message', (msg) => {
    io.emit('chat message', msg);
  });

  // Khi user ngắt kết nối
  socket.on('disconnect', () => {
    userConnections[userID].delete(socket.id); // Xóa kết nối cụ thể

    if (userConnections[userID].size === 0) {
      // Nếu không còn kết nối nào, xóa user khỏi danh sách
      delete userConnections[userID];

      // Phát sự kiện "offline" tới client
      io.emit('user_status', { userID, status: 'offline' });
      console.log(`User disconnected: ${userID} (All connections closed)`);
    } else {
      console.log(`User disconnected: ${userID}, Remaining connections: ${userConnections[userID].size}`);
    }
  });
});

// Lắng nghe trên cổng 6060
server.listen(6060, () => {
  console.log('Socket server is running on port 6060');
});