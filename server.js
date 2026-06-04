import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = process.env.PORT || 3000;
const BACKEND_URL = 'https://dreams-come-true-backend.onrender.com';

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const dreams = [];
const users = {};
const operations = {};   // recuerda las operaciones completas
const videoUris = {};    // recuerda el link del video terminado

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

    operations[operation.name] = operation;
    console.log('[GENERATE] Operacion creada:', operation.name, '| done:', operation.done);

    res.json({
      success: true,
      operationName: operation.name,
      message: 'Generacion iniciada',
    });
  } catch (error) {
    console.error('[GENERATE] Error Veo:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/dreams/status', async (req, res) => {
  try {
    const { operationName } = req.body;
    if (!operationName) {
      return res.status(400).json({ error: 'Falta operationName' });
    }

    let operation = operations[operationName];
    if (!operation) {
      console.log('[STATUS] No encontrada en memoria:', operationName);
      return res.status(404).json({ error: 'Operacion no encontrada (el servidor pudo reiniciarse)' });
    }

    operation = await ai.operations.getVideosOperation({ operation });
    operations[operationName] = operation;
    console.log('[STATUS]', operationName, '| done:', operation.done);

    if (!operation.done) {
      return res.json({ done: false, message: 'Generando...' });
    }

    const video = operation.response?.generatedVideos?.[0]?.video;
    if (!video?.uri) {
      console.error('[STATUS] Termino pero no hay video. response:', JSON.stringify(operation.response));
      return res.status(500).json({ error: 'Termino pero no se encontro el video' });
    }

    videoUris[operationName] = video.uri;
    console.log('[STATUS] Video listo:', video.uri);

    // Devolvemos un link a NUESTRO backend (la API key se queda protegida en el servidor)
    const safeUrl = `${BACKEND_URL}/api/dreams/video?op=${encodeURIComponent(operationName)}`;
    res.json({ done: true, videoUri: safeUrl });
  } catch (error) {
    console.error('[STATUS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sirve el video descargandolo de Google con la API key (del lado del servidor)
app.get('/api/dreams/video', async (req, res) => {
  try {
    const op = req.query.op;
    const googleUri = videoUris[op];
    if (!googleUri) {
      return res.status(404).send('Video no encontrado');
    }
    const sep = googleUri.includes('?') ? '&' : '?';
    const googleResp = await fetch(`${googleUri}${sep}key=${process.env.GEMINI_API_KEY}`);
    if (!googleResp.ok) {
      console.error('[VIDEO] Google respondio', googleResp.status);
      return res.status(502).send('No se pudo descargar el video');
    }
    const arrayBuffer = await googleResp.arrayBuffer();
    res.set('Content-Type', 'video/mp4');
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('[VIDEO] Error:', error);
    res.status(500).send('Error sirviendo el video');
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
