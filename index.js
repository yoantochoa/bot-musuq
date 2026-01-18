import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { CohereClient } from "cohere-ai"; // ✅ NUEVO

dotenv.config();

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ✅ REEMPLAZA GEMINI POR COHERE
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

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

// ✅ NUEVA FUNCIÓN CON COHERE
async function generarRespuestaIA(mensajeUsuario, nombreUsuario, infoRestaurantes) {
  try {
    const prompt = `Eres "MusuqBot", asistente de delivery en Perú.

Cliente: ${nombreUsuario}

Restaurantes disponibles:
${infoRestaurantes}

Instrucciones:
- Responde en máximo 3 líneas
- Sé amigable y promociona los restaurantes
- Ayuda al cliente a elegir
- Usa emojis ocasionalmente

Mensaje del cliente: ${mensajeUsuario}

Tu respuesta:`;

    const response = await cohere.chat({
      model: "command-r-plus", // Modelo gratuito más avanzado
      message: prompt,
      temperature: 0.7,
      maxTokens: 200,
    });

    const texto = response.text.trim();
    console.log("✅ Respuesta IA (Cohere):", texto.substring(0, 50) + "...");
    return texto;
    
  } catch (error) {
    console.error("❌ Error Cohere:", error);
    
    // Fallback sin IA
    return `Hola ${nombreUsuario}! 👋 Tenemos estos restaurantes disponibles:\n\n${infoRestaurantes}\n\n¿Cuál te interesa?`;
  }
}

// --- RUTAS ---
app.get("/", (req, res) => res.send("🤖 Bot Musuq v2.0 ONLINE (Cohere AI)"));

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
      console.log("⚠️ Mensaje no válido o no es texto");
      return;
    }

    const telefono = message.from;
    const nombre = req.body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || "Amigo";
    const texto = message.text.body;

    console.log(`📩 ${nombre} (${telefono}): ${texto}`);

    // Verificar/crear usuario
    let { data: usuario, error: errorUsuario } = await supabase
      .from('users')
      .select('*')
      .eq('phone_number', telefono)
      .single();

    if (errorUsuario && errorUsuario.code === 'PGRST116') {
      const { data: nuevo } = await supabase
        .from('users')
        .insert([{ 
          phone_number: telefono, 
          full_name: nombre,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      usuario = nuevo;
      console.log("👤 Nuevo usuario creado");
    }

    const restaurantes = await obtenerResumenRestaurantes();
    const respuesta = await generarRespuestaIA(texto, nombre, restaurantes);
    
    await enviarMensajeWhatsApp(telefono, respuesta);
    console.log("✅ Flujo completado");

  } catch (error) {
    console.error("❌ Error webhook:", error);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Bot Musuq corriendo en puerto ${PORT}`);
  console.log(`🤖 Motor IA: Cohere`);
  console.log(`📝 Variables:
  - SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅' : '❌'}
  - SUPABASE_KEY: ${process.env.SUPABASE_KEY ? '✅' : '❌'}
  - COHERE_API_KEY: ${process.env.COHERE_API_KEY ? '✅' : '❌'}
  - WHATSAPP_TOKEN: ${process.env.WHATSAPP_TOKEN ? '✅' : '❌'}
  - WHATSAPP_PHONE_ID: ${process.env.WHATSAPP_PHONE_ID ? '✅' : '❌'}
  `);
});