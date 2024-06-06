const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const app = express();
const server = http.createServer(app);
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

let users = [];
let messages = [];
try {
  const data = fs.readFileSync('app.json', 'utf8');
  users = JSON.parse(data);
} catch (err) {
  console.error('Error reading or parsing app.json:', err);
}

try {
  const data = fs.readFileSync('messages.json', 'utf8');
  messages = JSON.parse(data);
} catch (err) {
  console.error('Error reading or parsing messages.json:', err);
  messages = [];
}

let connectedUsers = {};

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

  socket.on('setUserId', (userId) => {
    connectedUsers[userId] = socket.id;
    socket.join(userId);
  });

  socket.on('sendMessage', ({ message, to }) => {
    console.log('message: ', message);

   const messageWithTimestamp = {
    ...message,
    timestamp: new Date().toISOString(),
  };

  messages.push(messageWithTimestamp);

    fs.writeFile('messages.json', JSON.stringify(messages, null, 2), (err) => {
      if (err) {
        console.error('Error writing to messages.json:', err);
      }
    });

    const receiverSocketId = connectedUsers[to];
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('receiveMessage', message);
    }
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
    const userId = Object.keys(connectedUsers).find(
      (key) => connectedUsers[key] === socket.id
    );
    if (userId) {
      delete connectedUsers[userId];
    }
  });
});

app.get('/messages', (req, res) => {
  try {
    const data = fs.readFileSync('messages.json', 'utf8');
    const messages = JSON.parse(data);
    res.status(200).json(messages);
  } catch (err) {
    console.error('Error reading or parsing messages.json:', err);
    res.status(500).json({ status: false, error: 'Internal server error.' });
  }
});

app.get('/users', (req, res) => {
  try {
    const data = fs.readFileSync('app.json', 'utf8');
    const users = JSON.parse(data);
    res.status(200).json(users);
  } catch (err) {
    console.error('Error reading or parsing app.json:', err);
    res.status(500).json({ status: false, error: 'Internal server error.' });
  }
});


app.post('/signup', (req, res) => {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ status: false, error: 'First name, last name, email, and password are required.' });
    }
    if (users.some(user => user.email === email)) {
      return res.status(400).json({ status: false, error: 'User already exists.' });
    }
    const newUser = { id: uuidv4(), firstName, lastName, email, password };
    users.push(newUser);
    fs.writeFile('app.json', JSON.stringify(users), (err) => {
      if (err) {
        console.error('Error writing to app.json:', err);
        return res.status(500).json({ status: false, error: 'Internal server error.' });
      }
      console.log('User added successfully.');
      return res.status(200).json({ status: true, message: 'User added successfully.' });
    });
  });

  const SECRET_KEY = 'your_secret_key'; 

app.post('/signin', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ status: false, error: 'Email and password are required.' });
  }
  const user = users.find(user => user.email === email);
  if (!user) {
    return res.status(404).json({ status: false, error: 'User not found.' });
  }
  if (user.password !== password) {
    return res.status(401).json({ status: false, error: 'Incorrect password.' });
  }

  const token = jwt.sign({ email: user.email }, SECRET_KEY, { expiresIn: '1h' });


  // return res.status(200).json({ message: 'Sign in successful.', user });
  return res.status(200).json({ 
    message: 'Sign in successful.', 
    token,
    user: user // Avoid sending the password back
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
