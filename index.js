import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai"; // <--- CAMBIO AQUÍ

dotenv.config();

// --- 1. CONFIGURACIÓN ---
const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Configuración de GEMINI (Google)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Usamos el modelo "flash" que es rápido para chat
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// --- 2. FUNCIONES ---

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
  } catch (error) {
    console.error("❌ Error WhatsApp:", error.response?.data || error.message);
  }
}

async function obtenerResumenRestaurantes() {
  const { data, error } = await supabase.from('restaurants').select('name, description').eq('is_active', true);
  if (error || !data) return "No hay restaurantes activos.";
  return data.map(r => `- ${r.name}: ${r.description}`).join("\n");
}

// --- NUEVA FUNCIÓN CON GEMINI ---
async function generarRespuestaIA(mensajeUsuario, nombreUsuario, infoRestaurantes) {
  try {
    // 1. Definimos la personalidad (Prompt del Sistema)
    const promptSistema = `
      Eres "MusuqBot", el asistente de delivery peruano.
      Cliente: ${nombreUsuario}.
      
      Restaurantes Disponibles:
      ${infoRestaurantes}

      Instrucciones:
      - Responde de forma breve y amable (máximo 2 frases).
      - Usa jergas peruanas suaves (tipo "¡Habla!", "al toque", "buenazo").
      - Tu meta es vender. Si piden carta, resume qué tipos de comida hay.
    `;

    // 2. Unimos todo para enviarlo a Gemini
    const promptFinal = `${promptSistema}\n\nCliente dice: "${mensajeUsuario}"\nMusuqBot responde:`;

    // 3. Generamos contenido
    const result = await model.generateContent(promptFinal);
    const response = await result.response;
    return response.text();
    
  } catch (error) {
    console.error("❌ Error Gemini:", error);
    return "Uy, se me fue la señal un toque 📡. ¿Qué me decías?";
  }
}

// --- 3. RUTAS ---
app.get("/", (req, res) => res.send("🤖 Bot Musuq (Powered by Gemini) 🚀"));

app.get("/webhook", (req, res) => {
  const verify_token = "musuq123";
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verify_token) {
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message && message.type === "text") {
      const telefono = message.from;
      const nombre = req.body.entry[0].changes[0].value.contacts[0].profile.name;
      const texto = message.text.body;

      console.log(`📩 ${nombre}: ${texto}`);

      // 1. Verificar usuario en BD
      let { data: usuario } = await supabase.from('users').select('*').eq('phone_number', telefono).single();
      
      if (!usuario) {
        const { data: nuevo } = await supabase.from('users').insert([{ phone_number: telefono, full_name: nombre }]).select().single();
        usuario = nuevo;
      }

      // 2. Obtener data real
      const restaurantes = await obtenerResumenRestaurantes();

      // 3. Pensar con GEMINI
      const respuesta = await generarRespuestaIA(texto, nombre, restaurantes);

      // 4. Responder
      await enviarMensajeWhatsApp(telefono, respuesta);
    }
  } catch (error) {
    console.error("Error webhook:", error.message);
  }
});

// --- 4. ARRANCAR SERVIDOR ---
// El '0.0.0.0' es OBLIGATORIO en Railway/Render para que escuche fuera del contenedor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Musuq corriendo en puerto ${PORT}`);
});