require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const multer = require("multer");

// 🔹 Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// 🔹 Define Message Schema with reactions support and room field
const MessageSchema = new mongoose.Schema({
  user: String,
  text: String,
  recipient: String,
  room: { type: String, default: "General" },
  fileUrl: String,
  fileType: String,
  reactions: { type: Array, default: [] }, // Array of {user, emoji}
  timestamp: { type: Date, default: Date.now },
});

const Message = mongoose.model("Message", MessageSchema);

// Allowed users (adjust if needed)
const ALLOWED_USERS = ["Jack", "Ore", "Caius", "Jonah", "Alice"];

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PASSKEY = process.env.PASSKEY || "secure123";
let users = {}; // socketId: username

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// 🔹 Multer setup for file uploads
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

// 🔹 File Upload Endpoint
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "No file uploaded" });

  res.json({
    fileUrl: `/uploads/${req.file.filename}`,
    fileType: req.file.mimetype,
  });
});

// 🔹 API Route to Check Server Status
app.get("/", (req, res) => {
  res.send("Secure Group Chat Backend is Running!");
});

// 🔹 Handle WebSocket Connections
io.on("connection", (socket) => {
  console.log("⚡ A user connected");

  // 🔸 Authenticate User
  socket.on("authenticate", async ({ passkey, username, avatarUrl, room }) => {
    if (passkey !== PASSKEY || !ALLOWED_USERS.includes(username)) {
      socket.emit("auth_error", "❌ Invalid credentials!");
      return socket.disconnect();
    }

    users[socket.id] = username;
    // Join the user's chosen room
    socket.join(room);
    io.emit("user_list", Object.values(users));

    // Send chat history for the room
    const chatHistory = await Message.find({ room })
      .sort({ timestamp: 1 })
      .limit(50);
    socket.emit("chat_history", chatHistory);
  });

  // 🔸 Handle Room Joining
  socket.on("join_room", async (roomName) => {
    // Leave previous rooms (except socket.id room)
    for (let r of socket.rooms) {
      if (r !== socket.id) {
        socket.leave(r);
      }
    }
    socket.join(roomName);
    // Send room-specific chat history
    const roomHistory = await Message.find({ room: roomName })
      .sort({ timestamp: 1 })
      .limit(50);
    socket.emit("room_history", roomHistory);
  });

  // 🔸 Handle Typing Indicator
  socket.on("typing", ({ isTyping }) => {
    socket.broadcast.emit("user_typing", {
      user: users[socket.id],
      isTyping,
    });
  });

  // 🔸 Handle New Messages & File Attachments
  socket.on("send_message", async (msg) => {
    const user = users[socket.id] || "Anonymous";
    const messageData = {
      user,
      text: msg.text || "",
      recipient: msg.recipient || "All",
      room: msg.room || "General",
      fileUrl: msg.fileUrl || "",
      fileType: msg.fileType || "",
      reactions: [],
      timestamp: new Date(),
    };

    const savedMessage = new Message(messageData);
    await savedMessage.save();

    // Emit the message to all clients in the room
    io.to(messageData.room).emit("receive_message", savedMessage);
  });

  // 🔸 Handle Message Editing
  socket.on("edit_message", async ({ messageId, newText }) => {
    const message = await Message.findById(messageId);
    // Ensure only the original sender can edit
    if (message && message.user === users[socket.id]) {
      message.text = newText;
      await message.save();
      io.emit("edit_message", { messageId, newText });
    }
  });

  // 🔸 Handle Message Deletion
  socket.on("delete_message", async (messageId) => {
    const message = await Message.findById(messageId);
    // Ensure only the original sender can delete
    if (message && message.user === users[socket.id]) {
      await Message.deleteOne({ _id: messageId });
      io.emit("delete_message", messageId);
    }
  });

  // 🔸 Handle Reactions
  socket.on("send_reaction", async ({ messageId, reaction }) => {
    const message = await Message.findById(messageId);
    if (message) {
      message.reactions.push(reaction);
      await message.save();
      io.emit("reaction_update", {
        messageId,
        reactions: message.reactions,
      });
    }
  });

  // 🔸 Handle Pinning Messages
  socket.on("pin_message", (message) => {
    io.emit("pin_message", message);
  });

  // 🔸 Handle Disconnection
  socket.on("disconnect", () => {
    console.log("🚪 User disconnected");
    delete users[socket.id];
    io.emit("user_list", Object.values(users));
  });
});

// 🔹 Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
