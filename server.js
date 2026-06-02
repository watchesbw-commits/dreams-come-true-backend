import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const dreams = [];
const users = {};

app.get('/health', (req, res) => {
  res.json({ status: 'Servidor Dreams Come True ✓', time: new Date().toISOString() });
});

app.post('/api/dreams/generate', async (req, res) => {
  try {
    const { text, style, duration } = req.body;
    if (!text || !style) {
      return res.status(400).json({ error: 'Faltan parámetros: text y style' });
    }

    const stylePrompts = {
      real: "Fotorrealista, cinematográfico, 4K",
      anime: "Anime épico, Ghibli style, colores vibrantes, 4K",
      cyber: "Cyberpunk, neón, futurista, luces eléctricas, 4K",
      fantasy: "Fantasy épico, mágico, colores fantásticos, 4K",
      ghibli: "Studio Ghibli, acuarela digital, naturaleza mágica, 4K",
      acuarela: "Acuarela artística, colores suaves, hermoso, 4K",
      pixel: "Pixel art retro, vibrante, 8-bit style, 4K",
      terror: "Horror cinematográfico, atmósfera oscura, tensión, 4K",
    };

    const fullPrompt = `${text}. Estilo: ${stylePrompts[style] || 'cinematográfico'}. Sin texto. Duración: ${duration}s`;
    const dreamId = Date.now();
    
    const dream = {
      id: dreamId,
      text,
      style,
      duration,
      prompt: fullPrompt,
      videoUrl: `ht
