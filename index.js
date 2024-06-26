const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const app = express();
const server = http.createServer(app);
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');


const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use('/files', express.static('files'));


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
      cb(null, 'files');
  },
  filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });


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

  console.log(`user connected: ${socket.id}`);
  // connectedUsers[userId] = socket.id;

  socket.on('setUserId', (userId) => {
    connectedUsers[userId] = socket.id;
    socket.join(userId);
    console.log(`User ${userId} is now associated with socket ${socket.id}`);
    io.emit('updateUserStatus', getUserStatus());
  });

  socket.on('sendMessage', ({ message, to }) => {
    console.log('message: ', message);

    const messageWithTimestamp = {
      ...message,
      timestamp: new Date().toISOString(),
    seen: false,
    };

    messages.push(messageWithTimestamp);


    fs.writeFile('messages.json', JSON.stringify(messages, null, 2), (err) => {
      if (err) {
        console.error('Error writing to messages.json:', err);
      }
    });

    const receiverSocketId = connectedUsers[to];
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('receiveMessage', messageWithTimestamp);
    }
  });

  socket.on('markMessagesAsSeen', ({ from, to }) => {
    messages = messages.map((msg) => {
        if (msg.user === from && msg.to === to && !msg.seen) {
          console.log('Updating message seen status:', msg);
            return { ...msg, seen: true };
        }
        return msg;
    });
    
    fs.writeFile('messages.json', JSON.stringify(messages, null, 2), (err) => {
      if (err) {
        console.error('Error writing to messages.json:', err);
      }
    });
   const receiverSocketId = connectedUsers[to];
    if (receiverSocketId) {
        io.to(receiverSocketId).emit('messagesMarkedAsSeen', { from });
    }
  });



  //video sockets

  // users.set(socket.id, socket.id);
  // socket.on('register', (userId) => {
  //   userSocketMap[userId] = socket.id;
  // });
  // emit that a new user has joined as soon as someone joins
  socket.broadcast.emit('users:joined', socket.id);
  socket.emit('hello', { id: socket.id });

  // socket.on('outgoing:call', data => {
  //   const { fromOffer, to } = data;
  //   // console.log('backened outgoing:call fired', data);
  //   console.log('outgoing call Socket connected:', socket.connected);
  //   socket.to(to).emit('incomming:call', { from: socket.id, offer: fromOffer });
  // });

  // socket.on('outgoing:call', (data) => {
  //   console.log('outgoing:call logs', data);
  //   const { fromOffer, to } = data;
  //   const toSocketId = connectedUsers[to];

  //   if (toSocketId) {
  //     socket.to(toSocketId).emit('incomming:call', { from: socket.id, offer: fromOffer });
  //   }
  // });

  socket.on('outgoing:call', (data) => {
    const { fromOffer, to, fromUserId } = data;
    const toSocketId = connectedUsers[to];
    console.log('outgoing:call', toSocketId);

    if (toSocketId) {
      socket.to(toSocketId).emit('incomming:call', { fromUserId: fromUserId, offer: fromOffer });
    }
  });

  socket.on('call:accepted', data => {
    const { answer, to } = data;
    const toSocketId = connectedUsers[to];
    console.log('call accepted from recevier', toSocketId);
    socket.to(toSocketId).emit('incomming:answere', { from: socket.id, offer: answer })
  });

  socket.on('ice-candidate', ({ candidate, to }) => {
    const toSocketId = connectedUsers[to];
    console.log('ice-candidate', toSocketId);
    if (toSocketId) {
      socket.to(toSocketId).emit('ice-candidate', { candidate });
    }
  });

  socket.on('call:disconnect', ({ from, to }) => {
    console.log(`Call disconnect requested by ${from} to ${to}`);
    const toSocketId = connectedUsers[to];
    io.to(toSocketId).emit('call:disconnected', { from });
  });

  // socket.on('disconnect', () => {
  //     console.log(`user disconnected: ${socket.id}`);
  //     users.delete(socket.id);
  //     socket.broadcast.emit('user:disconnect', socket.id);
  // });

  // socket.on('disconnect', () => {
  //   console.log('user disconnected');
  //   const userId = Object.keys(connectedUsers).find(
  //     (key) => connectedUsers[key] === socket.id
  //   );
  //   if (userId) {
  //     delete connectedUsers[userId];
      io.emit('updateUserStatus', getUserStatus());
  //   }
  //   socket.broadcast.emit('user:disconnect', socket.id);
  // });
});

const getUserStatus = () => {
  return users.map(user => ({
    ...user,
    online: connectedUsers.hasOwnProperty(user.id),
    unseenMessages: messages.filter((msg) => msg.to === user.id && !msg.seen).length
  }));
};

app.post('/upload', upload.single('file'), (req, res) => {
  if (req.file) {
      res.status(200).json({ fileUrl: req.file.filename });
  } else {
      res.status(400).json({ error: 'File upload failed' });
  }
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
    // res.status(200).json(users);
    res.status(200).json(users.map(user => ({
      ...user,
      online: connectedUsers.hasOwnProperty(user.id)
    })));
  } catch (err) {
    console.error('Error reading or parsing app.json:', err);
    res.status(500).json({ status: false, error: 'Internal server error.' });
  }
});

app.get('/get-username', (req, res) => {
  try {
    const data = fs.readFileSync('app.json', 'utf8');
    const users = JSON.parse(data);

    const user = users.find(x => x.id == req.query.userId);
    const userName = user.firstName + ' ' + user.lastName;
    res.status(200).json(userName);
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

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
