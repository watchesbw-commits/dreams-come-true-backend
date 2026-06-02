import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const dreams = [];
const users = {};

app.get('/', (req, res) => {
  res.json({ status: 'Dreams Come True Backend funcionando' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/dreams/generate', (req, res) => {
  const { text, style, duration } = req.body;
  if (!text || !style) {
    return res.status(400).json({ error: 'Faltan parametros' });
  }
  const dream = {
    id: Date.now(),
    text,
    style,
    duration,
    videoUrl: 'https://via.placeholder.com/720x1280',
    createdAt: new Date(),
    status: 'completed'
  };
  dreams.push(dream);
  res.json({ success: true, dream });
});

app.get('/api/dreams/community', (req, res) => {
  res.json({ dreams: dreams.filter(d => d.isPublic), total: dreams.length });
});

app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  const userId = Date.now().toString();
  users[userId] = { id: userId, name, email, plan: 'free', credits: 3 };
  res.json({ success: true, user: users[userId] });
});

app.listen(PORT, () => {
  console.log('Dreams Come True Backend en puerto ' + PORT);
});
