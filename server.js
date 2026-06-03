import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const dreams = [];
const users = {};

const stylePrompts = {
  real: "photorealistic, cinematic, 4K",
  anime: "epic anime style, vibrant colors, 4K",
  cyber: "cyberpunk, neon, futuristic, electric lights, 4K",
  fantasy: "epic fantasy, magical, fantastic colors, 4K",
  ghibli: "Studio Ghibli style, digital watercolor, magical nature, 4K",
  acuarela: "artistic watercolor, soft colors, beautiful, 4K",
  pixel: "retro pixel art, vibrant, 8-bit style, 4K",
  terror: "cinematic horror, dark atmosphere, tension, 4K",
};

app.get('/', (req, res) => {
  res.json({ status: 'Dreams Come True Backend funcionando' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/dreams/generate', async (req, res) => {
  try {
    const { text, style } = req.body;
    if (!text || !style) {
      return res.status(400).json({ error: 'Faltan parametros' });
    }

    const fullPrompt = `${text}. ${stylePrompts[style] || 'cinematic, 4K'}`;

    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-generate-preview',
      prompt: fullPrompt,
      config: { resolution: '720p' },
    });

    res.json({
      success: true,
      operationName: operation.name,
      message: 'Generacion iniciada',
    });
  } catch (error) {
    console.error('Error Veo:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/dreams/status', async (req, res) => {
  try {
    const { operationName } = req.body;
    if (!operationName) {
      return res.status(400).json({ error: 'Falta operationName' });
    }

    let operation = await ai.operations.getVideosOperation({
      operation: { name: operationName },
    });

    if (!operation.done) {
      return res.json({ done: false, message: 'Generando...' });
    }

    const video = operation.response.generatedVideos[0];
    res.json({ done: true, videoUri: video.video.uri });
  } catch (error) {
    console.error('Error status:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dreams/community', (req, res) => {
  res.json({ dreams: dreams.filter(d => d.isPublic), total: dreams.length });
});

app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  const userId = Date.now().toString();
  users[userId] = { id: userId, name, email, plan: 'free', credits: 1 };
  res.json({ success: true, user: users[userId] });
});

app.listen(PORT, () => {
  console.log('Dreams Come True Backend en puerto ' + PORT);
});
