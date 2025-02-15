require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 🔹 Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB connection error:", err));

// 🔹 Define Message Schema
const MessageSchema = new mongoose.Schema({
    user: String,
    text: String,
    recipient: String,
    fileUrl: String,
    fileType: String,
    timestamp: { type: Date, default: Date.now },
});

const Message = mongoose.model("Message", MessageSchema);

// 🔹 Express & WebSocket Setup
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PASSKEY = process.env.PASSKEY || "secure123"; // Only 5 users should have this key!
let users = {}; // Store connected users

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
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

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
    socket.on("authenticate", async ({ passkey, username }) => {
        if (passkey !== PASSKEY) {
            socket.emit("auth_error", "❌ Invalid passkey!");
            return socket.disconnect();
        }

        users[socket.id] = username;
        io.emit("user_list", Object.values(users));

        // Send chat history
        const chatHistory = await Message.find().sort({ timestamp: 1 }).limit(50);
        socket.emit("chat_history", chatHistory);
    });

    // 🔸 Handle Typing Indicator
    socket.on("typing", ({ isTyping }) => {
        socket.broadcast.emit("user_typing", { user: users[socket.id], isTyping });
    });

    // 🔸 Handle New Messages & File Attachments
    socket.on("send_message", async (msg) => {
        const user = users[socket.id] || "Anonymous";
        const messageData = {
            user,
            text: msg.text || "",
            recipient: msg.recipient || "All",
            fileUrl: msg.fileUrl || "",
            fileType: msg.fileType || ""
        };

        // Save message in MongoDB
        const savedMessage = new Message(messageData);
        await savedMessage.save();

        io.emit("receive_message", messageData);
    });

    // 🔸 Handle User Disconnection
    socket.on("disconnect", () => {
        console.log("🚪 User disconnected");
        delete users[socket.id];
        io.emit("user_list", Object.values(users));
    });
});

// 🔹 Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
