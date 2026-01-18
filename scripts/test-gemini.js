import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function test() {
  console.log("🧪 Probando modelos de Gemini...\n");
  
  const modelos = [
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-8b-latest", 
    "gemini-1.5-pro-latest",
    "gemini-pro"
  ];

  for (const nombre of modelos) {
    try {
      console.log(`Probando: ${nombre}...`);
      const model = genAI.getGenerativeModel({ model: nombre });
      const result = await model.generateContent("Di solo: OK");
      const response = await result.response;
      console.log(`✅ ${nombre}: ${response.text()}\n`);
      break; // Si funciona, detente aquí
    } catch (error) {
      console.log(`❌ ${nombre}: ${error.message.substring(0, 100)}\n`);
    }
  }
}

test();