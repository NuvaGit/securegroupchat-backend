require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

// 🔹 Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB connection error:", err));


// 🔹 Define Message Schema
const MessageSchema = new mongoose.Schema({
    user: String,
    text: String,
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

    // 🔸 Handle New Messages
    socket.on("send_message", async (msg) => {
        const user = users[socket.id] || "Anonymous";
        const messageData = { user, text: msg.text };

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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
