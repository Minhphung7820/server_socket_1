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

app.get('/api/online-users', (req, res) => {
  const onlineUsers = Object.keys(userConnections).map(userID => ({
    userID,
    isOnline: true,
    last_active: null // Bạn có thể thêm thông tin khác nếu cần
  }));
  res.json({ data: onlineUsers });
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

  console.log(`User connected: ${userID}, Connections: ${userConnections[userID].size}`);

  // Gửi thông tin người dùng vừa kết nối đến tất cả client
  io.emit('user_list', {
    userID,
    online: true,
    last_active: null,
  });

  // Lắng nghe sự kiện `join_conversation`
  socket.on('join_conversation', (conversation_id) => {
    if (conversation_id) {
      socket.join(conversation_id);
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
      socket.to(conversation_id).emit('typing', {
        typewriter_id,
        conversation_id,
      });
      console.log(`User ${userID} is typing in conversation: ${conversation_id}`);
    }
  });

  // Lắng nghe tin nhắn từ người dùng trong một conversation
  socket.on('send_message', async (data) => {
    const { conversation_id, content, sender_id } = data;

    if (conversation_id && content, sender_id) {
      // Phát tin nhắn đến các client trong conversation này
      io.to(conversation_id).emit('receive_message', {
        conversation_id,
        content,
        sender_id,
        timestamp: getCurrentTimeFormatted(),
      });
      // Gửi tin nhắn đến Laravel API để lưu trữ
      // try {
      //   await axios.post('http://localhost:8000/api/save-message', {
      //     conversation_id,
      //     sender_id,
      //     message,
      //   });
      //   console.log(`Message saved to conversation: ${conversation_id}`);
      // } catch (error) {
      //   console.error(`Failed to save message to Laravel API: ${error.message}`);
      // }
    } else {
      console.log('Invalid message data received');
    }
  });

  // Lắng nghe sự kiện thoát phòng
  socket.on('leave_conversation', (conversation_id) => {
    if (conversation_id) {
      socket.leave(conversation_id);
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
        await axios.post('http://localhost:8000/api/set-last-online', {
          userID,
          last_active,
        });

        // Thêm user vào userDisconnections
        userDisconnections[userID] = {
          last_active,
        };
        console.log(`Updated last_time_online and moved user to userDisconnections: ${userID}`);

        // Gửi người dùng vừa ngắt kết nối qua sự kiện user_disconnect_list
        io.emit('user_disconnect_list', {
          userID,
          online: false,
          last_active,
        });
      } catch (error) {
        console.error(`Failed to update last_time_online for user: ${userID}`, error.message);
      }
    } else {
      console.log(`User disconnected: ${userID}, Remaining connections: ${userConnections[userID].size}`);
    }
  });
});

server.listen(6060, () => {
  console.log('Socket server is running on port 6060');
});