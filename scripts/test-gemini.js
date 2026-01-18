import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const modelos = [
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-8b-latest",
  "gemini-1.5-pro-latest",
  "gemini-pro",
  "gemini-1.5-flash",
  "gemini-1.5-pro"
];

console.log("🔍 Probando modelos de Gemini...\n");

for (const nombreModelo of modelos) {
  try {
    const model = genAI.getGenerativeModel({ model: nombreModelo });
    const result = await model.generateContent("Di solo: OK");
    const response = await result.response;
    console.log(`✅ ${nombreModelo}: ${response.text().trim()}`);
  } catch (error) {
    console.log(`❌ ${nombreModelo}: ${error.message.substring(0, 80)}`);
  }
}