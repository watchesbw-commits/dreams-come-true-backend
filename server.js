import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import { Storage } from '@google-cloud/storage';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
globalThis.WebSocket = WebSocket;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Faltan variables SUPABASE_URL o SUPABASE_SERVICE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const GCS_BUCKET = 'dreams-come-true-videos';

if (!process.env.GCS_CREDENTIALS_JSON) {
  console.error('Falta variable GCS_CREDENTIALS_JSON');
  process.exit(1);
}
const gcsCredentials = JSON.parse(process.env.GCS_CREDENTIALS_JSON);
const storage = new Storage({ credentials: gcsCredentials, projectId: 'river-pointer-383804' });
const bucket = storage.bucket(GCS_BUCKET);

const app = express();
const PORT = process.env.PORT || 3000;
const BACKEND_URL = 'https://dreams-come-true-backend.onrender.com';

app.use(cors());

// Webhook debe ir ANTES de express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[WEBHOOK] Firma invalida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const userId = subscription.metadata.userId;
    if (userId) {
      await supabase.from('user_credits').upsert({
        user_id: userId,
        credits_remaining: 3,
        subscription_status: 'active',
        subscription_id: subscription.id,
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      }, { onConflict: 'user_id' });
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const userId = subscription.metadata.userId;
    if (userId) {
      await supabase.from('user_credits')
        .update({ subscription_status: 'cancelled' })
        .eq('user_id', userId);
    }
  }

  res.json({ received: true });
});

app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const dreams = [];
const users = {};
const operations = {};
const videoUris = {};
const operationUsers = {};

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

app.post('/create-subscription', async (req, res) => {
  try {
    const { userId, userEmail } = req.body;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: userEmail,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}?subscribed=true`,
      cancel_url: `${process.env.FRONTEND_URL}?cancelled=true`,
      subscription_data: { metadata: { userId } },
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error('[CREATE-SUBSCRIPTION] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/credits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data } = await supabase
      .from('user_credits')
      .select('credits_remaining, subscription_status, current_period_end')
      .eq('user_id', userId)
      .single();
    if (!data) {
      return res.json({ credits: 0, subscriptionStatus: 'inactive' });
    }
    res.json({
      credits: data.credits_remaining,
      subscriptionStatus: data.subscription_status,
      currentPeriodEnd: data.current_period_end,
    });
  } catch (error) {
    console.error('[CREDITS] Error:', error);
    res.json({ credits: 0, subscriptionStatus: 'inactive' });
  }
});

app.post('/api/dreams/generate', async (req, res) => {
  try {
    const { text, style, userId } = req.body;
    if (!text || !style) {
      return res.status(400).json({ error: 'Faltan parametros' });
    }

    if (userId) {
      const { data: creditData } = await supabase
        .from('user_credits')
        .select('credits_remaining')
        .eq('user_id', userId)
        .single();
      if (!creditData || creditData.credits_remaining <= 0) {
        return res.status(402).json({ error: 'Sin créditos disponibles' });
      }
    }

    const fullPrompt = `${text}. ${stylePrompts[style] || 'cinematic, 4K'}`;

    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: fullPrompt,
      config: { resolution: '720p' },
    });

    operations[operation.name] = operation;
    if (userId) operationUsers[operation.name] = userId;
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

    console.log('[STATUS] Video listo, descargando para subir a GCS:', video.uri);

    const sep = video.uri.includes('?') ? '&' : '?';
    const googleResp = await fetch(`${video.uri}${sep}key=${process.env.GEMINI_API_KEY}`);
    if (!googleResp.ok) {
      console.error('[STATUS] No se pudo descargar el video de Google:', googleResp.status);
      return res.status(502).json({ error: 'No se pudo descargar el video de Google' });
    }
    const videoBuffer = Buffer.from(await googleResp.arrayBuffer());

    const fileName = `videos/${Date.now()}.mp4`;
    const file = bucket.file(fileName);
    await file.save(videoBuffer, { contentType: 'video/mp4' });

    const publicUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${fileName}`;
    videoUris[operationName] = publicUrl;
    console.log('[STATUS] Video subido a GCS:', publicUrl);

    const userId = operationUsers[operationName];
    if (userId) {
      const { data: creditData } = await supabase
        .from('user_credits')
        .select('credits_remaining')
        .eq('user_id', userId)
        .single();
      if (creditData && creditData.credits_remaining > 0) {
        await supabase
          .from('user_credits')
          .update({ credits_remaining: creditData.credits_remaining - 1 })
          .eq('user_id', userId);
        console.log('[STATUS] Credito descontado para userId:', userId);
      }
    }

    res.json({ done: true, videoUri: publicUrl });
  } catch (error) {
    console.error('[STATUS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Redirige al video permanente en GCS (ya no necesita proxy ni API key)
app.get('/api/dreams/video', (req, res) => {
  const op = req.query.op;
  const gcsUrl = videoUris[op];
  if (!gcsUrl) {
    return res.status(404).send('Video no encontrado');
  }
  res.redirect(gcsUrl);
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
