import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { CohereClient } from "cohere-ai";

dotenv.config();

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Memoria de conversaciones
const conversaciones = new Map();

// --- FUNCIONES ---

async function enviarMensajeWhatsApp(telefono, texto) {
  try {
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: {
        messaging_product: "whatsapp",
        to: telefono,
        type: "text",
        text: { body: texto },
      },
    });
    console.log("✅ Mensaje enviado a", telefono);
  } catch (error) {
    console.error("❌ Error WhatsApp:", error.response?.data || error.message);
  }
}

async function obtenerResumenRestaurantes() {
  const { data, error } = await supabase
    .from('restaurants')
    .select('name, description')
    .eq('is_active', true);
  
  if (error || !data || data.length === 0) {
    return "No hay restaurantes activos por ahora.";
  }
  
  return data.map(r => `- ${r.name}: ${r.description}`).join("\n");
}

async function generarRespuestaIA(mensajeUsuario, nombreUsuario, telefono, infoRestaurantes) {
  try {
    // Obtener o crear historial
    if (!conversaciones.has(telefono)) {
      conversaciones.set(telefono, []);
      console.log(`🆕 Nueva conversación: ${nombreUsuario}`);
    }
    
    const historial = conversaciones.get(telefono);
    
    // Agregar mensaje del usuario
    historial.push({
      role: "USER",
      message: mensajeUsuario,
      timestamp: new Date().toISOString()
    });
    
    // Mantener solo últimos 10 mensajes
    if (historial.length > 10) {
      historial.splice(0, historial.length - 10);
    }

    // Construir contexto
    const contextoConversacion = historial
      .map(m => `${m.role === 'USER' ? 'Cliente' : 'MusuqBot'}: ${m.message}`)
      .join('\n');

    const prompt = `Eres "MusuqBot", asistente amigable de delivery en Perú.

Cliente: ${nombreUsuario}

Restaurantes disponibles:
${infoRestaurantes}

Instrucciones:
- Recuerda la conversación anterior
- Ayuda al cliente paso a paso: 1) elegir restaurante, 2) pedir dirección, 3) método de pago
- Sé breve (máximo 3 líneas)
- Usa emojis ocasionalmente 🍕🍔🏍️

CONVERSACIÓN:
${contextoConversacion}

Responde al último mensaje de forma natural y coherente:`;

    console.log(`💬 Procesando mensaje de ${nombreUsuario}...`);

    // ✅ MODELO ACTUALIZADO
    const response = await cohere.chat({
      model: "command-r", // ← CAMBIO AQUÍ
      message: prompt,
      temperature: 0.7,
      maxTokens: 200,
    });

    const respuestaBot = response.text.trim();
    
    // Agregar respuesta al historial
    historial.push({
      role: "CHATBOT",
      message: respuestaBot,
      timestamp: new Date().toISOString()
    });
    
    conversaciones.set(telefono, historial);
    
    console.log(`✅ Respuesta (${historial.length} msgs):`, respuestaBot.substring(0, 50) + "...");
    
    return respuestaBot;
    
  } catch (error) {
    console.error("❌ Error Cohere:", error.message);
    
    // Fallback
    return `Hola ${nombreUsuario}! 👋\n\nTenemos estos restaurantes:\n${infoRestaurantes}\n\n¿Cuál te interesa?`;
  }
}

function limpiarConversacionesAntiguas() {
  const ahora = new Date();
  const TIMEOUT_HORAS = 2;
  
  let eliminadas = 0;
  
  for (const [telefono, historial] of conversaciones.entries()) {
    if (historial.length === 0) continue;
    
    const ultimoMensaje = new Date(historial[historial.length - 1].timestamp);
    const horasInactivo = (ahora - ultimoMensaje) / (1000 * 60 * 60);
    
    if (horasInactivo > TIMEOUT_HORAS) {
      conversaciones.delete(telefono);
      eliminadas++;
    }
  }
  
  if (eliminadas > 0) {
    console.log(`🧹 ${eliminadas} conversaciones antiguas eliminadas`);
  }
}

async function reiniciarConversacion(telefono) {
  conversaciones.delete(telefono);
  console.log(`🔄 Conversación reiniciada para ${telefono}`);
  return "🔄 Conversación reiniciada. ¡Empecemos de nuevo!\n\n¿En qué te puedo ayudar?";
}

// --- RUTAS ---

app.get("/", (req, res) => {
  res.json({
    status: "🤖 Bot Musuq v2.1 ONLINE",
    engine: "Cohere AI (command-r)",
    conversaciones_activas: conversaciones.size
  });
});

app.get("/webhook", (req, res) => {
  const verify_token = "musuq123";
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verify_token) {
    console.log("✅ Webhook verificado");
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    
    if (!message || message.type !== "text") {
      return;
    }

    const telefono = message.from;
    const nombre = req.body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || "Amigo";
    const texto = message.text.body.trim();

    console.log(`📩 ${nombre}: ${texto}`);

    // Comando especial
    if (texto.toLowerCase() === 'reiniciar') {
      const respuesta = await reiniciarConversacion(telefono);
      await enviarMensajeWhatsApp(telefono, respuesta);
      return;
    }

    // Verificar usuario
    let { data: usuario, error: errorUsuario } = await supabase
      .from('users')
      .select('*')
      .eq('phone_number', telefono)
      .single();

    if (errorUsuario && errorUsuario.code === 'PGRST116') {
      const { data: nuevo } = await supabase
        .from('users')
        .insert([{ phone_number: telefono, full_name: nombre }])
        .select()
        .single();
      usuario = nuevo;
      console.log("👤 Nuevo usuario:", nombre);
    }

    const restaurantes = await obtenerResumenRestaurantes();
    const respuesta = await generarRespuestaIA(texto, nombre, telefono, restaurantes);
    
    await enviarMensajeWhatsApp(telefono, respuesta);

  } catch (error) {
    console.error("❌ Error webhook:", error.message);
  }
});

app.get("/stats", (req, res) => {
  const stats = {
    conversaciones_activas: conversaciones.size,
    detalles: Array.from(conversaciones.entries()).map(([tel, hist]) => ({
      telefono: tel.slice(0, 5) + "***",
      mensajes: hist.length,
      ultimo: hist[hist.length - 1]?.timestamp
    }))
  };
  res.json(stats);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════╗
║   🤖 Bot Musuq v2.1 ONLINE            ║
║   🧠 Cohere AI (command-r)            ║
║   💾 Memoria en RAM                   ║
║   🚀 Puerto: ${PORT}                      ║
╚════════════════════════════════════════╝

📝 Variables: ${[
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  process.env.COHERE_API_KEY,
  process.env.WHATSAPP_TOKEN,
  process.env.WHATSAPP_PHONE_ID
].every(v => v) ? '✅ Todas configuradas' : '❌ Faltan variables'}
  `);
  
  // Limpiar cada 30 minutos
  setInterval(limpiarConversacionesAntiguas, 30 * 60 * 1000);
});