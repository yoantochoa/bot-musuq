import express from "express";
import axios from "axios"; // Lo necesitarás pronto para enviar mensajes
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// 1. Ruta de prueba (para ver si funciona en el navegador)
app.get("/", (req, res) => {
  res.send("Bot Musuq activo 🚀");
});

// 2. Ruta de VERIFICACIÓN (¡Esto es lo que le falta a tu código!)
// Facebook llamará aquí para conectar por primera vez.
app.get("/webhook", (req, res) => {
  // Esta contraseña debe coincidir con la que pongas en Facebook
  const verify_token = "musuq123";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === verify_token) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// 3. Ruta para RECIBIR MENSAJES
app.post("/webhook", async (req, res) => {
  // 1. Imprimir todo el JSON bonito para ver qué llega
  console.log("📩 JSON COMPLETO:");
  console.log(JSON.stringify(req.body, null, 2));

  // 2. Intentar sacar solo el texto y el número
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message && message.type === "text") {
      const numero = message.from;
      const texto = message.text.body;
      console.log("------------------------------------------------");
      console.log(`📱 DE: ${numero}`);
      console.log(`💬 DICE: ${texto}`);
      console.log("------------------------------------------------");
    }
  } catch (error) {
    console.log("No se pudo leer el mensaje simple.");
  }

  res.sendStatus(200);
});

// Arrancar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor listo en puerto " + PORT);
});