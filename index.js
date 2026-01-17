import express from "express";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

app.get("/", (req,res)=> {
  res.send("Bot activo 🚀");
});

app.post("/webhook", async (req,res)=>{
  console.log("Mensaje recibido:");
  console.log(JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> {
  console.log("Servidor listo en puerto " + PORT);
});
