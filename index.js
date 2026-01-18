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

const apiKey = (process.env.GEMINI_API_KEY || "").trim();
const genAI = new GoogleGenerativeAI(apiKey);

// ✅ SOLUCIÓN: Usa "gemini-1.5-flash-latest" o "gemini-pro"
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

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
  
  if (error) {
    console.error("❌ Error Supabase:", error);
    return "No hay restaurantes disponibles por ahora.";
  }
  
  if (!data || data.length === 0) {
    return "No hay restaurantes activos por ahora.";
  }
  
  return data.map(r => `- ${r.name}: ${r.description}`).join("\n");
}

async function generarRespuestaIA(mensajeUsuario, nombreUsuario, infoRestaurantes) {
  try {
    const prompt = `Eres "MusuqBot", un asistente amigable de delivery en Perú.

Cliente: ${nombreUsuario}

Restaurantes disponibles:
${infoRestaurantes}

Instrucciones:
- Sé breve y amigable
- Ayuda al cliente a elegir restaurante
- Si pregunta por delivery, explica que puede hacer pedidos
- Usa emojis ocasionalmente 🍕🍔

Mensaje del cliente: ${mensajeUsuario}

Responde en máximo 3 líneas:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const texto = response.text();
    
    console.log("✅ Respuesta IA generada:", texto.substring(0, 50) + "...");
    return texto;
    
  } catch (error) {
    console.error("❌ Error Gemini completo:", error);
    
    // Fallback más específico
    if (error.message?.includes("API key")) {
      return "⚠️ Hay un problema con la configuración. Por favor contacta a soporte.";
    }
    
    return "Uy, se me cruzaron los cables 🔌. ¿Podrías repetir tu pregunta?";
  }
}

// --- RUTAS ---
app.get("/", (req, res) => res.send("🤖 Bot Musuq v1.5 ONLINE"));

app.get("/webhook", (req, res) => {
  const verify_token = "musuq123";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔍 Verificación webhook:", { mode, token: token === verify_token });

  if (mode === "subscribe" && token === verify_token) {
    console.log("✅ Webhook verificado");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Verificación fallida");
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  // Responder rápido a Meta
  res.sendStatus(200);
  
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // Log del webhook completo para debugging
    console.log("📦 Webhook recibido:", JSON.stringify(req.body, null, 2));

    if (!message) {
      console.log("⚠️ No hay mensaje en el webhook");
      return;
    }

    if (message.type !== "text") {
      console.log("⚠️ Mensaje no es de texto:", message.type);
      return;
    }

    const telefono = message.from;
    const nombre = value.contacts?.[0]?.profile?.name || "Amigo";
    const texto = message.text.body;

    console.log(`📩 Mensaje de ${nombre} (${telefono}): ${texto}`);

    // Verificar/crear usuario
    let { data: usuario, error: errorUsuario } = await supabase
      .from('users')
      .select('*')
      .eq('phone_number', telefono)
      .single();

    if (errorUsuario && errorUsuario.code === 'PGRST116') {
      // Usuario no existe, crear uno nuevo
      console.log("👤 Creando nuevo usuario:", nombre);
      const { data: nuevo, error: errorCrear } = await supabase
        .from('users')
        .insert([{ 
          phone_number: telefono, 
          full_name: nombre,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (errorCrear) {
        console.error("❌ Error creando usuario:", errorCrear);
      } else {
        usuario = nuevo;
        console.log("✅ Usuario creado:", usuario.id);
      }
    }

    // Obtener restaurantes y generar respuesta
    const restaurantes = await obtenerResumenRestaurantes();
    console.log("🍽️ Restaurantes cargados");
    
    const respuesta = await generarRespuestaIA(texto, nombre, restaurantes);
    
    await enviarMensajeWhatsApp(telefono, respuesta);
    console.log("✅ Flujo completado");

  } catch (error) {
    console.error("❌ Error en webhook:", error);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Bot Musuq corriendo en puerto ${PORT}`);
  console.log(`📝 Variables configuradas:
  - SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅' : '❌'}
  - SUPABASE_KEY: ${process.env.SUPABASE_KEY ? '✅' : '❌'}
  - GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅' : '❌'}
  - WHATSAPP_TOKEN: ${process.env.WHATSAPP_TOKEN ? '✅' : '❌'}
  - WHATSAPP_PHONE_ID: ${process.env.WHATSAPP_PHONE_ID ? '✅' : '❌'}
  `);
});