import express from 'express';
import cors from 'cors';
import { Storage } from '@google-cloud/storage';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
globalThis.WebSocket = WebSocket;

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
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
const FRONTEND_URL = (process.env.FRONTEND_URL || '').trim();
const HIGGSFIELD_API_KEY = (process.env.HIGGSFIELD_API_KEY || '').trim();
const HIGGSFIELD_API_SECRET = (process.env.HIGGSFIELD_API_SECRET || '').trim();
const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const STRIPE_PRICE_ID = (process.env.STRIPE_PRICE_ID || '').trim();
const ADMIN_SECRET_KEY = (process.env.ADMIN_SECRET_KEY || '').trim();

app.use(cors());

// Webhook debe ir ANTES de express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
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
app.use(express.static('public'));

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

async function enrichPromptWithClaude(originalPrompt) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: "Eres un experto en convertir relatos de sueños en descripciones cinematográficas para generación de video con IA. Tu trabajo NO es inventar un sueño nuevo. Debes transformar el relato del usuario en una versión mucho más descriptiva, inmersiva y visual, manteniendo exactamente los mismos acontecimientos, personajes, lugares y acciones. REGLAS: Nunca cambies la historia. Nunca agregues personajes, objetos o eventos importantes que el usuario no mencionó. No alteres el orden de los acontecimientos. Enriquece únicamente los detalles visuales: iluminación, clima, colores, texturas, atmósfera, expresiones faciales, movimientos, profundidad, escala y emociones. Convierte frases simples en descripciones cinematográficas. Mantén el tono del sueño (feliz, terrorífico, extraño, surrealista, nostálgico). Si algún detalle no fue especificado, puedes inferir uno discreto que no cambie el significado. Devuelve ÚNICAMENTE el texto mejorado, sin explicaciones ni comentarios.",
        messages: [{ role: 'user', content: originalPrompt }],
      }),
    });
    if (!response.ok) throw new Error(`Claude API ${response.status}`);
    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('[ENRICH] Claude API falló, usando prompt original:', error.message);
    return null;
  }
}

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
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${FRONTEND_URL}?subscribed=true`,
      cancel_url: `${FRONTEND_URL}?cancelled=true`,
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

app.post('/api/user/upload-face', async (req, res) => {
  try {
    const { userId, imageBase64 } = req.body;
    if (!userId || !imageBase64) {
      return res.status(400).json({ error: 'Faltan parámetros' });
    }
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const fileName = `faces/${userId}.jpg`;
    const file = bucket.file(fileName);
    await file.save(imageBuffer, { contentType: 'image/jpeg' });
    const publicUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${fileName}`;
    console.log('[UPLOAD-FACE] Cara subida para userId:', userId);
    res.json({ elementId: publicUrl });
  } catch (error) {
    console.error('[UPLOAD-FACE] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/dreams/generate', async (req, res) => {
  try {
    const { text, style, userId, incluirCara, elementId, isPublic } = req.body;
    if (!text) {
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

    const enrichedText = await enrichPromptWithClaude(text);
    const promptToUse = enrichedText || text;
    console.log('[ENRICH] Prompt enriquecido:', enrichedText ? 'OK' : 'fallback a original');
    const fullPrompt = `${promptToUse}. ${stylePrompts[style] || 'cinematic, 4K'}`;

    const higgsBody = {
      prompt: fullPrompt,
      duration: 5,
      resolution: '720p',
    };

    if (incluirCara && elementId) {
      higgsBody.image_references = [{ type: 'image_url', image_url: elementId }];
      console.log('[GENERATE] Cara de referencia incluida:', elementId);
    }

    const higgsResp = await fetch('https://platform.higgsfield.ai/seedance_2_0', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${HIGGSFIELD_API_KEY}:${HIGGSFIELD_API_SECRET}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(higgsBody),
    });

    if (!higgsResp.ok) {
      const errText = await higgsResp.text();
      console.error('[GENERATE] Error Higgsfield:', higgsResp.status, errText);
      return res.status(500).json({ error: 'Error al iniciar generacion en Higgsfield' });
    }

    const higgsData = await higgsResp.json();
    const jobId = higgsData.request_id;

    operations[jobId] = jobId;
    operationUsers[jobId] = { userId, text, style, isPublic: !!isPublic };
    console.log('[GENERATE] Job Higgsfield creado:', jobId);

    res.json({
      success: true,
      operationName: jobId,
      message: 'Generacion iniciada',
      originalPrompt: text,
      enrichedPrompt: enrichedText || text,
    });
  } catch (error) {
    console.error('[GENERATE] Error Higgsfield:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/dreams/status', async (req, res) => {
  try {
    const { operationName } = req.body;
    if (!operationName) {
      return res.status(400).json({ error: 'Falta operationName' });
    }

    const jobId = operationName;

    const higgsResp = await fetch(`https://platform.higgsfield.ai/requests/${jobId}/status`, {
      headers: {
        'Authorization': `Key ${HIGGSFIELD_API_KEY}:${HIGGSFIELD_API_SECRET}`,
        'Accept': 'application/json',
      },
    });

    if (!higgsResp.ok) {
      console.error('[STATUS] Error consultando Higgsfield:', higgsResp.status);
      return res.status(502).json({ error: 'Error consultando estado del job' });
    }

    const higgsData = await higgsResp.json();
    console.log('[STATUS]', jobId, '| status:', higgsData.status);

    if (higgsData.status === 'failed' || higgsData.status === 'nsfw') {
      console.error('[STATUS] Job fallo:', JSON.stringify(higgsData));
      return res.status(500).json({ error: 'La generacion del video fallo' });
    }

    if (higgsData.status !== 'completed') {
      return res.json({ done: false, message: 'Generando...' });
    }

    const videoUrl = higgsData.video?.url;
    if (!videoUrl) {
      console.error('[STATUS] Job completado pero no hay video_url:', JSON.stringify(higgsData));
      return res.status(500).json({ error: 'Job completado pero no se encontro el video_url' });
    }

    console.log('[STATUS] Video listo, descargando de Higgsfield:', videoUrl);

    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok) {
      console.error('[STATUS] No se pudo descargar el video:', videoResp.status);
      return res.status(502).json({ error: 'No se pudo descargar el video de Higgsfield' });
    }
    const videoBuffer = Buffer.from(await videoResp.arrayBuffer());

    const fileName = `videos/${Date.now()}.mp4`;
    const file = bucket.file(fileName);
    await file.save(videoBuffer, { contentType: 'video/mp4' });

    const publicUrl = `https://storage.googleapis.com/${GCS_BUCKET}/${fileName}`;
    videoUris[operationName] = publicUrl;
    console.log('[STATUS] Video subido a GCS:', publicUrl);

    const meta = operationUsers[operationName];
    const userId = meta?.userId;
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

      const { error: insertError } = await supabase.from('dreams').insert({
        user_id: userId,
        text: meta.text,
        style: meta.style || null,
        video_url: publicUrl,
        is_public: meta.isPublic,
      });
      if (insertError) {
        console.error('[STATUS] Error guardando dream en Supabase:', insertError);
      } else {
        console.log('[STATUS] Dream guardado en Supabase, is_public:', meta.isPublic);
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

app.get('/api/dreams/community', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const { data, error, count } = await supabase
      .from('dreams')
      .select('id, user_id, text, style, video_url, created_at', { count: 'exact' })
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[COMMUNITY] Error consultando Supabase:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ dreams: data, total: count, limit, offset });
  } catch (error) {
    console.error('[COMMUNITY] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  const userId = Date.now().toString();
  users[userId] = { id: userId, name, email, plan: 'free', credits: 1 };
  res.json({ success: true, user: users[userId] });
});

app.post('/api/admin/add-credits', async (req, res) => {
  try {
    const { userId, credits, adminKey } = req.body;
    if (adminKey !== ADMIN_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!userId || typeof credits !== 'number') {
      return res.status(400).json({ error: 'Faltan parametros' });
    }

    const { data: existing } = await supabase
      .from('user_credits')
      .select('credits_remaining')
      .eq('user_id', userId)
      .single();

    const newCredits = (existing ? existing.credits_remaining : 0) + credits;

    const { error } = await supabase
      .from('user_credits')
      .upsert({
        user_id: userId,
        credits_remaining: newCredits,
      }, {
        onConflict: 'user_id',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error('[ADMIN-ADD-CREDITS] Error Supabase:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('[ADMIN-ADD-CREDITS] Creditos actualizados para userId:', userId, '->', newCredits);
    res.json({ success: true, credits: newCredits });
  } catch (error) {
    console.error('[ADMIN-ADD-CREDITS] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log('Astra Backend en puerto ' + PORT);
});
