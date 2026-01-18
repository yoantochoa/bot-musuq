import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Memoria de sesiones de usuario
const sesiones = new Map();

// --- CONSTANTES ---
const ESTADOS = {
  INICIO: 'inicio',
  SELECCIONANDO_RESTAURANTE: 'seleccionando_restaurante',
  VIENDO_MENU: 'viendo_menu',
  AGREGANDO_ITEMS: 'agregando_items',
  CONFIRMANDO_CARRITO: 'confirmando_carrito',
  INGRESANDO_DIRECCION: 'ingresando_direccion',
  CONFIRMANDO_UBICACION: 'confirmando_ubicacion',
  SELECCIONANDO_PAGO: 'seleccionando_pago',
  GENERANDO_PEDIDO: 'generando_pedido',
  PEDIDO_ACTIVO: 'pedido_activo'
};

const METODOS_PAGO = {
  EFECTIVO: 'Efectivo',
  YAPE: 'Yape',
  PLIN: 'Plin',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta (POS en delivery)'
};

// --- FUNCIONES AUXILIARES ---

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

function obtenerSesion(telefono) {
  if (!sesiones.has(telefono)) {
    sesiones.set(telefono, {
      estado: ESTADOS.INICIO,
      restaurante: null,
      carrito: [],
      direccion: null,
      ubicacion: null,
      metodoPago: null,
      pedidoActual: null,
      mensajeAnterior: null
    });
  }
  return sesiones.get(telefono);
}

function actualizarSesion(telefono, datos) {
  const sesion = obtenerSesion(telefono);
  Object.assign(sesion, datos);
  sesiones.set(telefono, sesion);
}

function limpiarSesion(telefono) {
  sesiones.set(telefono, {
    estado: ESTADOS.INICIO,
    restaurante: null,
    carrito: [],
    direccion: null,
    ubicacion: null,
    metodoPago: null,
    pedidoActual: null,
    mensajeAnterior: null
  });
}

function calcularSubtotal(carrito) {
  return carrito.reduce((total, item) => total + (item.precio * item.cantidad), 0);
}

function calcularDelivery(ubicacion) {
  // Por ahora tarifa fija, después puedes calcular por distancia
  return 5.00;
}

function generarNumeroOrden() {
  const fecha = new Date();
  const año = fecha.getFullYear().toString().slice(-2);
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `ORD-${año}${mes}${dia}-${random}`;
}

function formatearCarrito(carrito) {
  if (carrito.length === 0) return "Tu carrito está vacío";
  
  let texto = "🛒 *TU CARRITO:*\n\n";
  carrito.forEach((item, index) => {
    texto += `${index + 1}. ${item.nombre}\n`;
    texto += `   ${item.cantidad}x S/ ${item.precio.toFixed(2)} = S/ ${(item.cantidad * item.precio).toFixed(2)}\n`;
    if (item.notas) {
      texto += `   📝 ${item.notas}\n`;
    }
    texto += `\n`;
  });
  
  const subtotal = calcularSubtotal(carrito);
  texto += `*Subtotal:* S/ ${subtotal.toFixed(2)}`;
  
  return texto;
}

function generarVoucher(pedido) {
  const subtotal = calcularSubtotal(pedido.carrito);
  const delivery = pedido.costoDelivery;
  const total = subtotal + delivery;
  
  let voucher = `╔═══════════════════════════════╗
║      🧾 COMPROBANTE DE PEDIDO      ║
╚═══════════════════════════════╝

📋 *ORDEN:* ${pedido.numeroOrden}
📅 *Fecha:* ${new Date(pedido.createdAt).toLocaleString('es-PE', { 
    timeZone: 'America/Lima',
    dateStyle: 'short',
    timeStyle: 'short'
  })}

🏪 *RESTAURANTE:*
${pedido.restaurante.name}

🛒 *PEDIDO:*
`;

  pedido.carrito.forEach((item, index) => {
    voucher += `${index + 1}. ${item.nombre}\n`;
    voucher += `   ${item.cantidad}x S/ ${item.precio.toFixed(2)} = S/ ${(item.cantidad * item.precio).toFixed(2)}\n`;
    if (item.notas) {
      voucher += `   📝 ${item.notas}\n`;
    }
  });

  voucher += `
━━━━━━━━━━━━━━━━━━━━━━━
📦 *Subtotal:* S/ ${subtotal.toFixed(2)}
🏍️ *Delivery:* S/ ${delivery.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━━━━
💰 *TOTAL:* S/ ${total.toFixed(2)}

📍 *DIRECCIÓN DE ENTREGA:*
${pedido.direccion}
${pedido.referencia ? `🏢 Ref: ${pedido.referencia}` : ''}

💳 *MÉTODO DE PAGO:*
${pedido.metodoPago}

⏱️ *Tiempo estimado:* 35-45 min

━━━━━━━━━━━━━━━━━━━━━━━
📞 Para consultas: +51 987 654 321
━━━━━━━━━━━━━━━━━━━━━━━

✅ *Tu pedido ha sido confirmado*
Te avisaremos cuando el motorizado
salga del restaurante.

*Escribe RASTREAR para ver el estado*`;

  return voucher;
}

// --- FUNCIONES DE BASE DE DATOS ---

async function obtenerRestaurantesActivos() {
  const { data, error } = await supabase
    .from('restaurants')
    .select('*')
    .eq('is_active', true)
    .order('name');
  
  if (error) {
    console.error("Error obteniendo restaurantes:", error);
    return [];
  }
  
  return data || [];
}

async function obtenerMenuRestaurante(restaurantId) {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_available', true)
    .order('category, name');
  
  if (error) {
    console.error("Error obteniendo menú:", error);
    return [];
  }
  
  return data || [];
}

async function crearPedido(telefono, sesion) {
  const numeroOrden = generarNumeroOrden();
  const subtotal = calcularSubtotal(sesion.carrito);
  const delivery = calcularDelivery(sesion.ubicacion);
  const total = subtotal + delivery;
  
  // Crear pedido en BD
  const { data: pedido, error: errorPedido } = await supabase
    .from('orders')
    .insert([{
      order_number: numeroOrden,
      restaurant_id: sesion.restaurante.id,
      customer_phone: telefono,
      delivery_address: sesion.direccion,
      delivery_reference: sesion.referencia,
      delivery_latitude: sesion.ubicacion?.latitude,
      delivery_longitude: sesion.ubicacion?.longitude,
      payment_method: sesion.metodoPago,
      subtotal: subtotal,
      delivery_fee: delivery,
      total: total,
      status: 'PENDING',
      items: sesion.carrito,
      created_at: new Date().toISOString()
    }])
    .select()
    .single();
  
  if (errorPedido) {
    console.error("Error creando pedido:", errorPedido);
    throw new Error("No se pudo crear el pedido");
  }
  
  return pedido;
}

async function obtenerUsuario(telefono, nombre) {
  let { data: usuario, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone_number', telefono)
    .single();

  if (error && error.code === 'PGRST116') {
    const { data: nuevo } = await supabase
      .from('users')
      .insert([{ phone_number: telefono, full_name: nombre }])
      .select()
      .single();
    usuario = nuevo;
  }

  return usuario;
}

// --- MANEJADORES DE ESTADOS ---

async function manejarInicio(telefono, nombre) {
  const restaurantes = await obtenerRestaurantesActivos();
  
  if (restaurantes.length === 0) {
    return {
      mensaje: "😔 Lo sentimos, no hay restaurantes disponibles en este momento.\n\nIntenta más tarde.",
      nuevoEstado: ESTADOS.INICIO
    };
  }
  
  let mensaje = `¡Hola ${nombre}! 👋 Bienvenido a *Musuq Delivery*\n\n`;
  mensaje += `🍽️ *RESTAURANTES DISPONIBLES:*\n\n`;
  
  restaurantes.forEach((rest, index) => {
    mensaje += `*${index + 1}.* ${rest.name}\n`;
    mensaje += `   ${rest.description || 'Deliciosa comida'}\n`;
    mensaje += `   ⏱️ ${rest.delivery_time || '30-40'} min\n\n`;
  });
  
  mensaje += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  mensaje += `📝 Escribe el *número* del restaurante\n`;
  mensaje += `Ejemplo: *1*`;
  
  return {
    mensaje,
    nuevoEstado: ESTADOS.SELECCIONANDO_RESTAURANTE,
    datos: { restaurantes }
  };
}

async function manejarSeleccionRestaurante(telefono, mensaje, sesion) {
  const numero = parseInt(mensaje.trim());
  
  if (isNaN(numero) || numero < 1 || numero > sesion.restaurantes.length) {
    return {
      mensaje: `❌ Opción inválida.\n\nEscribe un número del 1 al ${sesion.restaurantes.length}`,
      nuevoEstado: ESTADOS.SELECCIONANDO_RESTAURANTE
    };
  }
  
  const restaurante = sesion.restaurantes[numero - 1];
  const menuItems = await obtenerMenuRestaurante(restaurante.id);
  
  if (menuItems.length === 0) {
    return {
      mensaje: `😔 ${restaurante.name} no tiene menú disponible.\n\nEscribe *MENU* para ver otros restaurantes.`,
      nuevoEstado: ESTADOS.SELECCIONANDO_RESTAURANTE
    };
  }
  
  // Agrupar por categoría
  const categorias = {};
  menuItems.forEach(item => {
    const cat = item.category || 'General';
    if (!categorias[cat]) categorias[cat] = [];
    categorias[cat].push(item);
  });
  
  let respuesta = `🍽️ *${restaurante.name.toUpperCase()}*\n\n`;
  
  Object.keys(categorias).forEach(categoria => {
    respuesta += `━━ *${categoria}* ━━\n\n`;
    categorias[categoria].forEach((item, index) => {
      const itemNum = menuItems.indexOf(item) + 1;
      respuesta += `*${itemNum}.* ${item.name}\n`;
      respuesta += `   S/ ${item.price.toFixed(2)}\n`;
      if (item.description) {
        respuesta += `   _${item.description}_\n`;
      }
      respuesta += `\n`;
    });
  });
  
  respuesta += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  respuesta += `📝 Para ordenar escribe:\n`;
  respuesta += `*Número Cantidad* (opcional: notas)\n\n`;
  respuesta += `Ejemplos:\n`;
  respuesta += `• *1 2* (2 unidades del item 1)\n`;
  respuesta += `• *3 1 sin cebolla* (1 unidad sin cebolla)\n\n`;
  respuesta += `Cuando termines escribe: *LISTO*`;
  
  return {
    mensaje: respuesta,
    nuevoEstado: ESTADOS.AGREGANDO_ITEMS,
    datos: { 
      restaurante,
      menuItems,
      carrito: []
    }
  };
}

function manejarAgregarItems(telefono, mensaje, sesion) {
  const textoLimpio = mensaje.trim().toUpperCase();
  
  // Comandos especiales
  if (textoLimpio === 'LISTO' || textoLimpio === 'YA' || textoLimpio === 'CONFIRMAR') {
    if (sesion.carrito.length === 0) {
      return {
        mensaje: "❌ Tu carrito está vacío.\n\nAgrega al menos un item antes de continuar.",
        nuevoEstado: ESTADOS.AGREGANDO_ITEMS
      };
    }
    
    const carritoTexto = formatearCarrito(sesion.carrito);
    const subtotal = calcularSubtotal(sesion.carrito);
    const delivery = 5.00; // Fijo por ahora
    const total = subtotal + delivery;
    
    let respuesta = carritoTexto + `\n`;
    respuesta += `🏍️ *Delivery:* S/ ${delivery.toFixed(2)}\n`;
    respuesta += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    respuesta += `💰 *TOTAL:* S/ ${total.toFixed(2)}\n\n`;
    respuesta += `¿Todo correcto?\n\n`;
    respuesta += `✅ Escribe *SI* para continuar\n`;
    respuesta += `❌ Escribe *NO* para modificar\n`;
    respuesta += `🗑️ Escribe *VACIAR* para empezar de nuevo`;
    
    return {
      mensaje: respuesta,
      nuevoEstado: ESTADOS.CONFIRMANDO_CARRITO
    };
  }
  
  if (textoLimpio === 'VER' || textoLimpio === 'CARRITO') {
    return {
      mensaje: formatearCarrito(sesion.carrito) + `\n\nEscribe *LISTO* cuando termines de agregar items.`,
      nuevoEstado: ESTADOS.AGREGANDO_ITEMS
    };
  }
  
  if (textoLimpio === 'VACIAR' || textoLimpio === 'BORRAR') {
    return {
      mensaje: "🗑️ Carrito vaciado.\n\nAgrega nuevos items o escribe *MENU* para cambiar de restaurante.",
      nuevoEstado: ESTADOS.AGREGANDO_ITEMS,
      datos: { carrito: [] }
    };
  }
  
  // Parsear input: "número cantidad notas"
  const partes = mensaje.trim().split(/\s+/);
  const itemNum = parseInt(partes[0]);
  const cantidad = partes.length > 1 ? parseInt(partes[1]) : 1;
  const notas = partes.length > 2 ? partes.slice(2).join(' ') : null;
  
  if (isNaN(itemNum) || itemNum < 1 || itemNum > sesion.menuItems.length) {
    return {
      mensaje: `❌ Item #${itemNum} no existe.\n\nEscribe un número del 1 al ${sesion.menuItems.length}`,
      nuevoEstado: ESTADOS.AGREGANDO_ITEMS
    };
  }
  
  if (isNaN(cantidad) || cantidad < 1) {
    return {
      mensaje: "❌ Cantidad inválida.\n\nDebe ser un número mayor a 0.",
      nuevoEstado: ESTADOS.AGREGANDO_ITEMS
    };
  }
  
  const itemMenu = sesion.menuItems[itemNum - 1];
  
  // Agregar al carrito
  const carritoActual = sesion.carrito || [];
  carritoActual.push({
    menuItemId: itemMenu.id,
    nombre: itemMenu.name,
    precio: itemMenu.price,
    cantidad: cantidad,
    notas: notas
  });
  
  let respuesta = `✅ Agregado al carrito:\n\n`;
  respuesta += `${cantidad}x ${itemMenu.name}\n`;
  respuesta += `S/ ${(itemMenu.price * cantidad).toFixed(2)}\n`;
  if (notas) {
    respuesta += `📝 ${notas}\n`;
  }
  respuesta += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  respuesta += `Items en carrito: ${carritoActual.length}\n`;
  respuesta += `Subtotal: S/ ${calcularSubtotal(carritoActual).toFixed(2)}\n\n`;
  respuesta += `Agrega más items o escribe *LISTO*`;
  
  return {
    mensaje: respuesta,
    nuevoEstado: ESTADOS.AGREGANDO_ITEMS,
    datos: { carrito: carritoActual }
  };
}

function manejarConfirmarCarrito(telefono, mensaje, sesion) {
  const textoLimpio = mensaje.trim().toUpperCase();
  
  if (textoLimpio === 'SI' || textoLimpio === 'SÍ' || textoLimpio === 'CONFIRMAR' || textoLimpio === 'OK') {
    let respuesta = `📍 *DIRECCIÓN DE ENTREGA*\n\n`;
    respuesta += `Envíame tu dirección completa.\n\n`;
    respuesta += `Ejemplo:\n`;
    respuesta += `_Av. Arequipa 1234, dpto 501_\n`;
    respuesta += `_Urbanización Los Pinos, Mz D Lt 15_\n\n`;
    respuesta += `💡 También puedes enviar tu *ubicación* 📍`;
    
    return {
      mensaje: respuesta,
      nuevoEstado: ESTADOS.INGRESANDO_DIRECCION
    };
  }
  
  if (textoLimpio === 'NO' || textoLimpio === 'MODIFICAR') {
    let respuesta = `🔄 Puedes modificar tu pedido:\n\n`;
    respuesta += formatearCarrito(sesion.carrito) + `\n\n`;
    respuesta += `• Escribe *VACIAR* para empezar de nuevo\n`;
    respuesta += `• Agrega más items\n`;
    respuesta += `• Escribe *LISTO* cuando termines`;
    
    return {
      mensaje: respuesta,
      nuevoEstado: ESTADOS.AGREGANDO_ITEMS
    };
  }
  
  if (textoLimpio === 'VACIAR') {
    return {
      mensaje: "🗑️ Carrito vaciado.\n\nEscribe *MENU* para volver a elegir restaurante.",
      nuevoEstado: ESTADOS.INICIO,
      datos: { carrito: [] }
    };
  }
  
  return {
    mensaje: "Por favor responde:\n\n✅ *SI* para continuar\n❌ *NO* para modificar",
    nuevoEstado: ESTADOS.CONFIRMANDO_CARRITO
  };
}

function manejarDireccion(telefono, mensaje, sesion, ubicacion = null) {
  let direccion, referencia;
  
  if (ubicacion) {
    // Usuario envió ubicación GPS
    direccion = `Lat: ${ubicacion.latitude}, Lng: ${ubicacion.longitude}`;
    
    let respuesta = `📍 *Ubicación recibida*\n\n`;
    respuesta += `¿Tienes alguna referencia?\n`;
    respuesta += `_(Edificio, color de casa, punto de referencia)_\n\n`;
    respuesta += `Ejemplo: _Edificio azul, tercer piso_\n\n`;
    respuesta += `O escribe *OMITIR* si no tienes referencia.`;
    
    return {
      mensaje: respuesta,
      nuevoEstado: ESTADOS.CONFIRMANDO_UBICACION,
      datos: { 
        ubicacion: {
          latitude: ubicacion.latitude,
          longitude: ubicacion.longitude
        },
        direccion: direccion
      }
    };
  } else {
    // Usuario escribió dirección
    direccion = mensaje.trim();
    
    if (direccion.length < 10) {
      return {
        mensaje: "❌ La dirección es muy corta.\n\nPor favor escribe tu dirección completa o envía tu ubicación 📍",
        nuevoEstado: ESTADOS.INGRESANDO_DIRECCION
      };
    }
    
    let respuesta = `📍 Dirección registrada:\n`;
    respuesta += `_${direccion}_\n\n`;
    respuesta += `¿Tienes alguna referencia?\n`;
    respuesta += `_(Edificio, color de casa, punto de referencia)_\n\n`;
    respuesta += `O escribe *OMITIR*`;
    
    return {
      mensaje: respuesta,
      nuevoEstado: ESTADOS.CONFIRMANDO_UBICACION,
      datos: { direccion }
    };
  }
}

function manejarReferencia(telefono, mensaje, sesion) {
  const textoLimpio = mensaje.trim().toUpperCase();
  
  let referencia = null;
  if (textoLimpio !== 'OMITIR' && textoLimpio !== 'NO' && textoLimpio !== 'NINGUNA') {
    referencia = mensaje.trim();
  }
  
  let respuesta = `💳 *MÉTODO DE PAGO*\n\n`;
  respuesta += `Selecciona cómo pagarás:\n\n`;
  
  Object.keys(METODOS_PAGO).forEach((key, index) => {
    respuesta += `*${index + 1}.* ${METODOS_PAGO[key]}\n`;
  });
  
  respuesta += `\n📝 Escribe el número de tu opción`;
  
  return {
    mensaje: respuesta,
    nuevoEstado: ESTADOS.SELECCIONANDO_PAGO,
    datos: { referencia }
  };
}

async function manejarMetodoPago(telefono, mensaje, sesion, nombre) {
  const numero = parseInt(mensaje.trim());
  const metodos = Object.values(METODOS_PAGO);
  
  if (isNaN(numero) || numero < 1 || numero > metodos.length) {
    return {
      mensaje: `❌ Opción inválida.\n\nEscribe un número del 1 al ${metodos.length}`,
      nuevoEstado: ESTADOS.SELECCIONANDO_PAGO
    };
  }
  
  const metodoPago = metodos[numero - 1];
  
  // Crear pedido en BD
  try {
    actualizarSesion(telefono, { metodoPago });
    const sesionActualizada = obtenerSesion(telefono);
    sesionActualizada.restaurante = sesion.restaurante; // Asegurar que tenga el restaurante
    
    const pedido = await crearPedido(telefono, sesionActualizada);
    
    // Generar voucher
    const voucher = generarVoucher({
      numeroOrden: pedido.order_number,
      createdAt: pedido.created_at,
      restaurante: sesion.restaurante,
      carrito: sesion.carrito,
      direccion: sesion.direccion,
      referencia: sesion.referencia,
      metodoPago: metodoPago,
      costoDelivery: pedido.delivery_fee
    });
    
    return {
      mensaje: voucher,
      nuevoEstado: ESTADOS.PEDIDO_ACTIVO,
      datos: { 
        pedidoActual: pedido,
        metodoPago
      }
    };
    
  } catch (error) {
    console.error("Error creando pedido:", error);
    return {
      mensaje: "❌ Hubo un error al procesar tu pedido.\n\nPor favor intenta nuevamente o contacta a soporte.",
      nuevoEstado: ESTADOS.INICIO
    };
  }
}

function manejarPedidoActivo(telefono, mensaje, sesion) {
  const textoLimpio = mensaje.trim().toUpperCase();
  
  if (textoLimpio === 'RASTREAR' || textoLimpio === 'ESTADO' || textoLimpio === 'TRACKING') {
    let respuesta = `📦 *ESTADO DE TU PEDIDO*\n\n`;
    respuesta += `📋 Orden: ${sesion.pedidoActual.order_number}\n`;
    respuesta += `🏪 Restaurante: ${sesion.restaurante.name}\n\n`;
    respuesta += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    respuesta += `✅ Pedido recibido\n`;
    respuesta += `🍳 En preparación...\n`;
    respuesta += `⏱️ Tiempo estimado: 35-45 min\n\n`;
    respuesta += `Te avisaremos cuando salga el motorizado 🏍️`;
    
    return {
      mensaje: respuesta,
      nuevoEstado: ESTADOS.PEDIDO_ACTIVO
    };
  }
  
  if (textoLimpio === 'NUEVO' || textoLimpio === 'MENU') {
    return {
      mensaje: "Ya tienes un pedido en curso.\n\nEscribe *RASTREAR* para ver su estado.\n\nCuando se entregue, podrás hacer un nuevo pedido.",
      nuevoEstado: ESTADOS.PEDIDO_ACTIVO
    };
  }
  
  return {
    mensaje: `Tienes un pedido activo (#${sesion.pedidoActual.order_number}).\n\nComandos disponibles:\n• *RASTREAR* - Ver estado\n• *AYUDA* - Soporte`,
    nuevoEstado: ESTADOS.PEDIDO_ACTIVO
  };
}

// --- MANEJADOR PRINCIPAL ---

async function procesarMensaje(telefono, mensaje, nombre, ubicacion = null) {
  const sesion = obtenerSesion(telefono);
  let resultado;
  
  // Comandos globales
  const textoLimpio = mensaje.trim().toUpperCase();
  
  if (textoLimpio === 'MENU' || textoLimpio === 'INICIO' || textoLimpio === 'EMPEZAR') {
    limpiarSesion(telefono);
    resultado = await manejarInicio(telefono, nombre);
  }
  else if (textoLimpio === 'AYUDA' || textoLimpio === 'HELP') {
    const ayuda = `🆘 *AYUDA*\n\n` +
      `*Comandos disponibles:*\n` +
      `• MENU - Ver restaurantes\n` +
      `• VER - Ver tu carrito\n` +
      `• LISTO - Confirmar pedido\n` +
      `• VACIAR - Limpiar carrito\n` +
      `• RASTREAR - Ver estado de pedido\n` +
      `• AYUDA - Este mensaje\n\n` +
      `📞 Soporte: +51 987 654 321`;
    
    return { mensaje: ayuda, nuevoEstado: sesion.estado };
  }
  else {
    // Procesar según estado actual
    switch (sesion.estado) {
      case ESTADOS.INICIO:
        resultado = await manejarInicio(telefono, nombre);
        break;
      
      case ESTADOS.SELECCIONANDO_RESTAURANTE:
        resultado = await manejarSeleccionRestaurante(telefono, mensaje, sesion);
        break;
      
      case ESTADOS.AGREGANDO_ITEMS:
        resultado = manejarAgregarItems(telefono, mensaje, sesion);
        break;
      
      case ESTADOS.CONFIRMANDO_CARRITO:
        resultado = manejarConfirmarCarrito(telefono, mensaje, sesion);
        break;
      
      case ESTADOS.INGRESANDO_DIRECCION:
        resultado = manejarDireccion(telefono, mensaje, sesion, ubicacion);
        break;
      
      case ESTADOS.CONFIRMANDO_UBICACION:
        resultado = manejarReferencia(telefono, mensaje, sesion);
        break;
      
      case ESTADOS.SELECCIONANDO_PAGO:
        resultado = await manejarMetodoPago(telefono, mensaje, sesion, nombre);
        break;
      
      case ESTADOS.PEDIDO_ACTIVO:
        resultado = manejarPedidoActivo(telefono, mensaje, sesion);
        break;
      
      default:
        resultado = await manejarInicio(telefono, nombre);
    }
  }
  
  // Actualizar sesión con nuevo estado y datos
  if (resultado.nuevoEstado) {
    actualizarSesion(telefono, {
      estado: resultado.nuevoEstado,
      ...resultado.datos
    });
  }
  
  return resultado.mensaje;
}

// --- RUTAS ---

app.get("/", (req, res) => {
  res.json({
    status: "🤖 Musuq Delivery Bot v3.0",
    system: "Sistema de pedidos completo",
    sesiones_activas: sesiones.size
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
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const telefono = message.from;
    const nombre = value.contacts?.[0]?.profile?.name || "Amigo";
    
    let textoMensaje = null;
    let ubicacion = null;
    
    if (message.type === "text") {
      textoMensaje = message.text.body.trim();
      console.log(`📩 ${nombre}: ${textoMensaje}`);
    } else if (message.type === "location") {
      ubicacion = {
        latitude: message.location.latitude,
        longitude: message.location.longitude
      };
      textoMensaje = "📍 Ubicación recibida";
      console.log(`📍 ${nombre} envió ubicación:`, ubicacion);
    } else {
      console.log(`⚠️ Tipo de mensaje no soportado: ${message.type}`);
      await enviarMensajeWhatsApp(telefono, "Lo siento, solo puedo procesar mensajes de texto y ubicaciones 📍");
      return;
    }

    // Obtener/crear usuario
    await obtenerUsuario(telefono, nombre);

    // Procesar mensaje
    const respuesta = await procesarMensaje(telefono, textoMensaje, nombre, ubicacion);
    
    // Enviar respuesta
    await enviarMensajeWhatsApp(telefono, respuesta);

  } catch (error) {
    console.error("❌ Error en webhook:", error);
  }
});

app.get("/stats", (req, res) => {
  const stats = {
    sesiones_activas: sesiones.size,
    por_estado: {}
  };
  
  for (const [telefono, sesion] of sesiones.entries()) {
    const estado = sesion.estado;
    stats.por_estado[estado] = (stats.por_estado[estado] || 0) + 1;
  }
  
  res.json(stats);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═════════════════════════════════════════╗
║   🤖 MUSUQ DELIVERY BOT v3.0           ║
║   📦 Sistema de Pedidos Completo       ║
║   🚀 Puerto: ${PORT}                       ║
╚═════════════════════════════════════════╝

✅ Sistema iniciado correctamente
📊 Visita /stats para ver estadísticas
  `);
  
  // Limpiar sesiones inactivas cada hora
  setInterval(() => {
    const ahora = new Date();
    let eliminadas = 0;
    
    for (const [telefono, sesion] of sesiones.entries()) {
      // Si no hay pedido activo y pasaron 2 horas, limpiar
      if (sesion.estado !== ESTADOS.PEDIDO_ACTIVO) {
        eliminadas++;
        sesiones.delete(telefono);
      }
    }
    
    if (eliminadas > 0) {
      console.log(`🧹 ${eliminadas} sesiones inactivas limpiadas`);
    }
  }, 60 * 60 * 1000);
});