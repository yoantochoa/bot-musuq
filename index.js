import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 1. Limpiamos la clave por si en Railway se coló un espacio
const apiKey = (process.env.GEMINI_API_KEY || "").trim();
const genAI = new GoogleGenerativeAI(apiKey);

// 2. USAMOS EL MODELO EXACTO (Este es el que funciona en cuentas gratuitas hoy)
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
  } catch (error) {
    console.error("❌ Error WhatsApp:", error.response?.data || error.message);
  }
}

async function obtenerResumenRestaurantes() {
  const { data, error } = await supabase.from('restaurants').select('name, description').eq('is_active', true);
  if (error || !data || data.length === 0) return "No hay restaurantes activos por ahora.";
  return data.map(r => `- ${r.name}: ${r.description}`).join("\n");
}

async function generarRespuestaIA(mensajeUsuario, nombreUsuario, infoRestaurantes) {
  try {
    const promptSistema = `
      Eres "MusuqBot", asistente de delivery.
      Cliente: ${nombreUsuario}.
      Restaurantes:
      ${infoRestaurantes}
      
      Responde amable y corto. Vende los restaurantes.
    `;
    
    // Prompt simple para evitar errores de formato
    const result = await model.generateContent(`${promptSistema}\n\nCliente: ${mensajeUsuario}`);
    const response = await result.response;
    return response.text();
    
  } catch (error) {
    console.error("❌ Error Gemini Detallado:", error); // Log más detallado
    return "Uy, se me cruzaron los cables 🔌. Intenta de nuevo.";
  }
}

// --- RUTAS ---
app.get("/", (req, res) => res.send("🤖 Bot Musuq v1.5 ONLINE"));

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

      // Verificar usuario
      let { data: usuario } = await supabase.from('users').select('*').eq('phone_number', telefono).single();
      if (!usuario) {
        const { data: nuevo } = await supabase.from('users').insert([{ phone_number: telefono, full_name: nombre }]).select().single();
        usuario = nuevo;
      }

      const restaurantes = await obtenerResumenRestaurantes();
      const respuesta = await generarRespuestaIA(texto, nombre, restaurantes);
      await enviarMensajeWhatsApp(telefono, respuesta);
    }
  } catch (error) {
    console.error("Error webhook:", error.message);
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Musuq corriendo en ${PORT}`));