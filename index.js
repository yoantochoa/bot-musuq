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

// Memoria de sesiones
const sesiones = new Map();

// --- CONSTANTES ---
const ESTADOS = {
  INICIO: 'inicio',
  SELECCIONANDO_RESTAURANTE: 'seleccionando_restaurante',
  VIENDO_MENU: 'viendo_menu',
  AGREGANDO_ITEMS: 'agregando_items',
  CONFIRMANDO_CARRITO: 'confirmando_carrito',
  GESTIONANDO_DIRECCION: 'gestionando_direccion', // NUEVO
  SELECCIONANDO_DIRECCION_GUARDADA: 'seleccionando_direccion_guardada', // NUEVO
  INGRESANDO_DIRECCION_NUEVA: 'ingresando_direccion_nueva',
  CONFIRMANDO_UBICACION: 'confirmando_ubicacion',
  SELECCIONANDO_PAGO: 'seleccionando_pago',
  PEDIDO_ACTIVO: 'pedido_activo'
};

const METODOS_PAGO = {
  EFECTIVO: 'Efectivo',
  YAPE: 'Yape',
  PLIN: 'Plin',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta (POS)'
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
    console.log("✅ Mensaje enviado");
  } catch (error) {
    console.error("❌ Error WhatsApp:", error.response?.data || error.message);
  }
}

// NUEVO: Enviar mensaje con botones interactivos
async function enviarMensajeConBotones(telefono, texto, opciones) {
  // WhatsApp solo soporta hasta 3 botones
  if (opciones.length <= 3) {
    try {
      const buttons = opciones.map((opcion, idx) => ({
        type: "reply",
        reply: {
          id: `opt_${idx}`,
          title: opcion.texto.substring(0, 20) // Máximo 20 caracteres
        }
      }));

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
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: texto },
            action: { buttons }
          }
        },
      });
      
      console.log("✅ Mensaje con botones enviado");
      return true;
    } catch (error) {
      console.error("❌ Error enviando botones:", error.response?.data || error.message);
    }
  }
  
  // Fallback: enviar como texto con números
  let mensajeConOpciones = texto + "\n\n";
  opciones.forEach((opcion, idx) => {
    mensajeConOpciones += `*${idx + 1}.* ${opcion.texto}\n`;
  });
  
  await enviarMensajeWhatsApp(telefono, mensajeConOpciones);
  return false;
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
      direccionesGuardadas: [],
      distanciaKm: 0,
      tiempoEstimado: 30
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
  const sesionAnterior = obtenerSesion(telefono);
  sesiones.set(telefono, {
    estado: ESTADOS.INICIO,
    restaurante: null,
    carrito: [],
    direccion: null,
    ubicacion: null,
    metodoPago: null,
    pedidoActual: null,
    direccionesGuardadas: sesionAnterior.direccionesGuardadas || [],
    distanciaKm: 0,
    tiempoEstimado: 30
  });
}

function calcularSubtotal(carrito) {
  return carrito.reduce((total, item) => total + (item.precio * item.cantidad), 0);
}

// NUEVO: Calcular delivery basado en distancia
async function calcularDelivery(restaurantId, latCliente, lngCliente) {
  if (!latCliente || !lngCliente) {
    return { costo: 5.00, distancia: 0, tiempo: 30 };
  }

  try {
    const { data, error } = await supabase.rpc('calculate_delivery_cost', {
      restaurant_id_param: restaurantId,
      customer_lat: latCliente,
      customer_lon: lngCliente
    });

    if (error) throw error;

    if (data && data.length > 0) {
      return {
        costo: parseFloat(data[0].delivery_cost), // Ya viene redondeado de la función SQL
        distancia: parseFloat(data[0].distance_km),
        tiempo: parseInt(data[0].estimated_time_minutes)
      };
    }
  } catch (error) {
    console.error("Error calculando delivery:", error);
  }

  return { costo: 5.00, distancia: 0, tiempo: 30 };
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

function generarVoucher(pedido, deliveryInfo) {
  const subtotal = calcularSubtotal(pedido.carrito);
  const delivery = deliveryInfo.costo;
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
📍 ${pedido.restaurante.address || 'Sin dirección'}

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
🏍️ *Delivery:* S/ ${delivery.toFixed(2)}`;

  if (deliveryInfo.distancia > 0) {
    voucher += `\n   📏 Distancia: ${deliveryInfo.distancia.toFixed(2)} km`;
  }

  voucher += `
━━━━━━━━━━━━━━━━━━━━━━━
💰 *TOTAL:* S/ ${total.toFixed(2)}

📍 *DIRECCIÓN DE ENTREGA:*
${pedido.direccion}`;

  if (pedido.referencia) {
    voucher += `\n🏢 Ref: ${pedido.referencia}`;
  }

  voucher += `

💳 *MÉTODO DE PAGO:*
${pedido.metodoPago}

⏱️ *Tiempo estimado:* ${deliveryInfo.tiempo || 30} min

━━━━━━━━━━━━━━━━━━━━━━━
📞 Soporte: +51 987 654 321
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
    .from('restaurants_with_status')
    .select('*')
    .eq('is_open_now', true)  // ✅ SOLO RESTAURANTES ABIERTOS
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

// NUEVO: Obtener direcciones guardadas del usuario
async function obtenerDireccionesGuardadas(userId) {
  const { data, error } = await supabase
    .from('user_addresses')
    .select('*')
    .eq('user_id', userId)
    .order('is_default DESC, created_at DESC');
  
  if (error) {
    console.error("Error obteniendo direcciones:", error);
    return [];
  }
  
  return data || [];
}

// NUEVO: Guardar nueva dirección
async function guardarDireccion(userId, datos) {
  const { data, error } = await supabase
    .from('user_addresses')
    .insert([{
      user_id: userId,
      label: datos.label || 'Otra',
      address: datos.address,
      reference: datos.reference,
      latitude: datos.latitude,
      longitude: datos.longitude,
      is_default: datos.is_default || false
    }])
    .select()
    .single();
  
  if (error) {
    console.error("Error guardando dirección:", error);
    return null;
  }
  
  return data;
}

async function crearPedido(telefono, sesion, deliveryInfo) {
  const numeroOrden = generarNumeroOrden();
  const subtotal = calcularSubtotal(sesion.carrito);
  const delivery = deliveryInfo.costo;
  const total = subtotal + delivery;
  
  // Obtener usuario
  const { data: usuario } = await supabase
    .from('users')
    .select('id')
    .eq('phone_number', telefono)
    .single();
  
  // Crear pedido
  const { data: pedido, error: errorPedido } = await supabase
    .from('orders')
    .insert([{
      order_number: numeroOrden,
      user_id: usuario?.id,
      restaurant_id: sesion.restaurante.id,
      customer_phone: telefono,
      delivery_address: sesion.direccion,
      delivery_reference: sesion.referencia,
      delivery_latitude: sesion.ubicacion?.latitude,
      delivery_longitude: sesion.ubicacion?.longitude,
      payment_method: sesion.metodoPago,
      subtotal: subtotal,
      delivery_fee: delivery,
      total_amount: total,
      status: 'PENDING',
      created_at: new Date().toISOString()
    }])
    .select()
    .single();
  
  if (errorPedido) {
    console.error("Error creando pedido:", errorPedido);
    throw new Error("No se pudo crear el pedido");
  }
  
  // Crear items del pedido
  const orderItems = sesion.carrito.map(item => ({
    order_id: pedido.id,
    menu_item_id: item.menuItemId,
    quantity: item.cantidad,
    unit_price: item.precio,
    notes: item.notas
  }));
  
  await supabase
    .from('order_items')
    .insert(orderItems);
  
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
      mensaje: "😔 No hay restaurantes abiertos en este momento.\n\n⏰ Intenta más tarde.",
      nuevoEstado: ESTADOS.INICIO
    };
  }
  
  let mensaje = `¡Hola ${nombre}! 👋 Bienvenido a *Musuq Delivery*\n\n`;
  mensaje += `🍽️ *RESTAURANTES ABIERTOS AHORA:*\n\n`;
  
  restaurantes.forEach((rest, index) => {
    mensaje += `*${index + 1}.* ${rest.name} ${rest.status_display}\n`;
    mensaje += `   ${rest.description || 'Deliciosa comida'}\n`;
    if (rest.address) {
      mensaje += `   📍 ${rest.address}\n`;
    }
    if (rest.opening_time && rest.closing_time) {
      mensaje += `   🕐 Horario: ${rest.opening_time.substring(0,5)} - ${rest.closing_time.substring(0,5)}\n`;
    }
    mensaje += `   ⏱️ ${rest.delivery_time || '30-40 min'}\n\n`;
  });
  
  mensaje += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  mensaje += `📝 Escribe el *número* del restaurante`;
  
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
  
  let respuesta = `🍽️ *${restaurante.name.toUpperCase()}*\n`;
  if (restaurante.address) {
    respuesta += `📍 ${restaurante.address}\n`;
  }
  respuesta += `\n`;
  
  Object.keys(categorias).forEach(categoria => {
    respuesta += `━━ *${categoria}* ━━\n\n`;
    categorias[categoria].forEach((item) => {
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
  respuesta += `📝 Para ordenar:\n`;
  respuesta += `*Número Cantidad* (notas opcionales)\n\n`;
  respuesta += `Ejemplos:\n`;
  respuesta += `• *1 2*\n`;
  respuesta += `• *3 1 sin cebolla*\n\n`;
  respuesta += `Escribe *LISTO* cuando termines`;
  
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
  
  if (textoLimpio === 'LISTO' || textoLimpio === 'YA' || textoLimpio === 'CONFIRMAR') {
    if (sesion.carrito.length === 0) {
      return {
        mensaje: "❌ Tu carrito está vacío.\n\nAgrega al menos un item.",
        nuevoEstado: ESTADOS.AGREGANDO_ITEMS
      };
    }
    
    const carritoTexto = formatearCarrito(sesion.carrito);
    const subtotal = calcularSubtotal(sesion.carrito);
    
    let respuesta = carritoTexto + `\n\n`;
    respuesta += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    respuesta += `💰 *Subtotal:* S/ ${subtotal.toFixed(2)}\n`;
    respuesta += `🏍️ *Delivery:* Se calculará según tu ubicación\n\n`;
    respuesta += `¿Todo correcto?\n\n`;
    respuesta += `✅ *SI* para continuar\n`;
    respuesta += `❌ *NO* para modificar`;
    
    return {
      mensaje: respuesta,
      nuevoEstado: ESTADOS.CONFIRMANDO_CARRITO
    };
  }
  
  if (textoLimpio === 'VER' || textoLimpio === 'CARRITO') {
    return {
      mensaje: formatearCarrito(sesion.carrito) + `\n\nEscribe *LISTO* cuando termines.`,
      nuevoEstado: ESTADOS.AGREGANDO_ITEMS
    };
  }
  
  if (textoLimpio === 'VACIAR') {
    return {
      mensaje: "🗑️ Carrito vaciado.\n\nAgrega nuevos items o *MENU* para cambiar de restaurante.",
      nuevoEstado: ESTADOS.AGREGANDO_ITEMS,
      datos: { carrito: [] }
    };
  }
  
  // Parsear input
  const partes = mensaje.trim().split(/\s+/);
  const itemNum = parseInt(partes[0]);
  const cantidad = partes.length > 1 ? parseInt(partes[1]) : 1;
  const notas = partes.length > 2 ? partes.slice(2).join(' ') : null;
  
  if (isNaN(itemNum) || itemNum < 1 || itemNum > sesion.menuItems.length) {
    return {
      mensaje: `❌ Item #${itemNum} no existe.\n\nEscribe 1-${sesion.menuItems.length}`,
      nuevoEstado: ESTADOS.AGREGANDO_ITEMS
    };
  }
  
  if (isNaN(cantidad) || cantidad < 1) {
    return {
      mensaje: "❌ Cantidad inválida.",
      nuevoEstado: ESTADOS.AGREGANDO_ITEMS
    };
  }
  
  const itemMenu = sesion.menuItems[itemNum - 1];
  const carritoActual = sesion.carrito || [];
  
  carritoActual.push({
    menuItemId: itemMenu.id,
    nombre: itemMenu.name,
    precio: itemMenu.price,
    cantidad: cantidad,
    notas: notas
  });
  
  let respuesta = `✅ Agregado:\n\n`;
  respuesta += `${cantidad}x ${itemMenu.name}\n`;
  respuesta += `S/ ${(itemMenu.price * cantidad).toFixed(2)}\n`;
  if (notas) respuesta += `📝 ${notas}\n`;
  respuesta += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  respuesta += `Items: ${carritoActual.length} | Subtotal: S/ ${calcularSubtotal(carritoActual).toFixed(2)}\n\n`;
  respuesta += `Agrega más o escribe *LISTO*`;
  
  return {
    mensaje: respuesta,
    nuevoEstado: ESTADOS.AGREGANDO_ITEMS,
    datos: { carrito: carritoActual }
  };
}

function manejarConfirmarCarrito(telefono, mensaje, sesion) {
  const textoLimpio = mensaje.trim().toUpperCase();
  
  if (textoLimpio === 'SI' || textoLimpio === 'SÍ' || textoLimpio === 'OK' || textoLimpio === '✅ CONFIRMAR') {
    return {
      mensaje: "Cargando tus direcciones...",
      nuevoEstado: ESTADOS.GESTIONANDO_DIRECCION
    };
  }
  
  if (textoLimpio === 'NO' || textoLimpio === 'MODIFICAR' || textoLimpio === '✏️ MODIFICAR') {
    return {
      mensaje: formatearCarrito(sesion.carrito) + `\n\n*VACIAR* o agrega más. *LISTO* para continuar.`,
      nuevoEstado: ESTADOS.AGREGANDO_ITEMS
    };
  }
  
  // Si es primera vez que llega aquí, enviar con botones
  if (!sesion.botonEnviado) {
    const carritoTexto = formatearCarrito(sesion.carrito);
    const subtotal = calcularSubtotal(sesion.carrito);
    
    let respuesta = carritoTexto + `\n\n`;
    respuesta += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    respuesta += `💰 *Subtotal:* S/ ${subtotal.toFixed(2)}\n`;
    respuesta += `🏍️ *Delivery:* Se calculará según ubicación\n\n`;
    respuesta += `¿Todo correcto?`;
    
    // Intentar enviar con botones
    setTimeout(async () => {
      await enviarMensajeConBotones(telefono, respuesta, [
        { texto: "✅ Confirmar" },
        { texto: "✏️ Modificar" },
        { texto: "🗑️ Vaciar" }
      ]);
    }, 100);
    
    return {
      mensaje: "", // No enviar texto, los botones ya fueron enviados
      nuevoEstado: ESTADOS.CONFIRMANDO_CARRITO,
      datos: { botonEnviado: true }
    };
  }
  
  return {
    mensaje: "✅ *SI* para continuar\n❌ *NO* para modificar",
    nuevoEstado: ESTADOS.CONFIRMANDO_CARRITO
  };
}

// NUEVO: Manejar gestión de direcciones
async function manejarGestionDireccion(telefono, sesion, usuario) {
  const direcciones = await obtenerDireccionesGuardadas(usuario.id);
  
  if (direcciones.length === 0) {
    let respuesta = `📍 *DIRECCIÓN DE ENTREGA*\n\n`;
    respuesta += `No tienes direcciones guardadas.\n\n`;
    respuesta += `Envía tu *ubicación* 📍 o escribe tu dirección:\n\n`;
    respuesta += `Ejemplo: _Av. Arequipa 1234, dpto 501_`;
    
    return {
      mensaje: respuesta,
      nuevoEstado: ESTADOS.INGRESANDO_DIRECCION_NUEVA,
      datos: { direccionesGuardadas: [] }
    };
  }
  
  let respuesta = `📍 *DIRECCIÓN DE ENTREGA*\n\n`;
  respuesta += `Selecciona una dirección:\n\n`;
  
  direcciones.forEach((dir, index) => {
    const emoji = dir.is_default ? '⭐' : '📍';
    respuesta += `*${index + 1}.* ${emoji} ${dir.label}\n`;
    respuesta += `   ${dir.address}\n`;
    if (dir.reference) {
      respuesta += `   🏢 ${dir.reference}\n`;
    }
    respuesta += `\n`;
  });
  
  respuesta += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  respuesta += `📝 Escribe el número\n`;
  respuesta += `O escribe *NUEVA* para agregar otra dirección`;
  
  return {
    mensaje: respuesta,
    nuevoEstado: ESTADOS.SELECCIONANDO_DIRECCION_GUARDADA,
    datos: { direccionesGuardadas: direcciones }
  };
}

async function manejarSeleccionDireccionGuardada(telefono, mensaje, sesion) {
  const textoLimpio = mensaje.trim().toUpperCase();
  
  if (textoLimpio === 'NUEVA' || textoLimpio === 'OTRA') {
    let respuesta = `📍 *NUEVA DIRECCIÓN*\n\n`;
    respuesta += `Envía tu *ubicación* 📍 o escribe tu dirección completa.`;
    
    return {
      mensaje: respuesta,
      nuevoEstado: ESTADOS.INGRESANDO_DIRECCION_NUEVA
    };
  }
  
  const numero = parseInt(mensaje.trim());
  
  if (isNaN(numero) || numero < 1 || numero > sesion.direccionesGuardadas.length) {
    return {
      mensaje: `❌ Opción inválida.\n\nEscribe 1-${sesion.direccionesGuardadas.length} o *NUEVA*`,
      nuevoEstado: ESTADOS.SELECCIONANDO_DIRECCION_GUARDADA
    };
  }
  
  const dirSeleccionada = sesion.direccionesGuardadas[numero - 1];
  
  // Calcular delivery
  const deliveryInfo = await calcularDelivery(
    sesion.restaurante.id,
    dirSeleccionada.latitude,
    dirSeleccionada.longitude
  );
  
  let respuesta = `📍 Dirección seleccionada:\n`;
  respuesta += `${dirSeleccionada.address}\n`;
  if (dirSeleccionada.reference) {
    respuesta += `🏢 ${dirSeleccionada.reference}\n`;
  }
  respuesta += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  if (deliveryInfo.distancia > 0) {
    respuesta += `📏 Distancia: ${deliveryInfo.distancia.toFixed(2)} km\n`;
  }
  respuesta += `🏍️ Costo delivery: S/ ${deliveryInfo.costo.toFixed(2)}\n`;
  respuesta += `⏱️ Tiempo estimado: ${deliveryInfo.tiempo} min\n\n`;
  
  respuesta += `💳 *MÉTODO DE PAGO*\n\n`;
  Object.keys(METODOS_PAGO).forEach((key, index) => {
    respuesta += `*${index + 1}.* ${METODOS_PAGO[key]}\n`;
  });
  respuesta += `\n📝 Escribe el número`;
  
  return {
    mensaje: respuesta,
    nuevoEstado: ESTADOS.SELECCIONANDO_PAGO,
    datos: {
      direccion: dirSeleccionada.address,
      referencia: dirSeleccionada.reference,
      ubicacion: {
        latitude: dirSeleccionada.latitude,
        longitude: dirSeleccionada.longitude
      },
      distanciaKm: deliveryInfo.distancia,
      costoDelivery: deliveryInfo.costo,
      tiempoEstimado: deliveryInfo.tiempo
    }
  };
}

async function manejarDireccionNueva(telefono, mensaje, sesion, ubicacion = null, usuario = null) {
  let direccion, lat, lng;
  
  if (ubicacion) {
    // Usuario envió ubicación GPS
    lat = ubicacion.latitude;
    lng = ubicacion.longitude;
    direccion = `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
    
    let respuesta = `📍 *Ubicación recibida*\n\n`;
    respuesta += `¿Alguna referencia?\n`;
    respuesta += `_(Casa, edificio, color, etc.)_\n\n`;
    respuesta += `O escribe *OMITIR*`;
    
    return {
      mensaje: respuesta,
      nuevoEstado: ESTADOS.CONFIRMANDO_UBICACION,
      datos: {
        ubicacion: { latitude: lat, longitude: lng },
        direccion: direccion
      }
    };
  } else {
    // Usuario escribió dirección
    direccion = mensaje.trim();
    
    if (direccion.length < 10) {
      return {
        mensaje: "❌ Dirección muy corta.\n\nEscribe tu dirección completa o envía tu ubicación 📍",
        nuevoEstado: ESTADOS.INGRESANDO_DIRECCION_NUEVA
      };
    }
    
    let respuesta = `📍 Dirección: _${direccion}_\n\n`;
    respuesta += `¿Referencia?\n\nO escribe *OMITIR*`;
    
    return {
      mensaje: respuesta,
      nuevoEstado: ESTADOS.CONFIRMANDO_UBICACION,
      datos: { direccion }
    };
  }
}

async function manejarReferencia(telefono, mensaje, sesion, usuario) {
  const textoLimpio = mensaje.trim().toUpperCase();
  
  let referencia = null;
  if (textoLimpio !== 'OMITIR' && textoLimpio !== 'NO') {
    referencia = mensaje.trim();
  }
  
  // Calcular delivery
  const deliveryInfo = await calcularDelivery(
    sesion.restaurante.id,
    sesion.ubicacion?.latitude,
    sesion.ubicacion?.longitude
  );
  
  // Preguntar si quiere guardar la dirección
  let respuesta = `📍 Dirección confirmada\n\n`;
  
  if (deliveryInfo.distancia > 0) {
    respuesta += `📏 Distancia: ${deliveryInfo.distancia.toFixed(2)} km\n`;
  }
  respuesta += `🏍️ Costo delivery: S/ ${deliveryInfo.costo.toFixed(2)}\n`;
  respuesta += `⏱️ Tiempo: ${deliveryInfo.tiempo} min\n\n`;
  
  respuesta += `¿Guardar esta dirección para futuros pedidos?\n\n`;
  respuesta += `*1.* Sí, como "Casa"\n`;
  respuesta += `*2.* Sí, como "Trabajo"\n`;
  respuesta += `*3.* Sí, como "Oficina"\n`;
  respuesta += `*4.* No guardar\n\n`;
  respuesta += `Escribe el número:`;
  
  return {
    mensaje: respuesta,
    nuevoEstado: ESTADOS.SELECCIONANDO_PAGO,
    datos: {
      referencia,
      distanciaKm: deliveryInfo.distancia,
      costoDelivery: deliveryInfo.costo,
      tiempoEstimado: deliveryInfo.tiempo,
      esperandoGuardarDireccion: true
    }
  };
}

async function manejarMetodoPago(telefono, mensaje, sesion, nombre, usuario) {
  // Si está esperando guardar dirección
  if (sesion.esperandoGuardarDireccion) {
    const opcion = parseInt(mensaje.trim());
    
    if (!isNaN(opcion) && opcion >= 1 && opcion <= 4) {
      if (opcion <= 3) {
        const labels = ['Casa', 'Trabajo', 'Oficina'];
        await guardarDireccion(usuario.id, {
          label: labels[opcion - 1],
          address: sesion.direccion,
          reference: sesion.referencia,
          latitude: sesion.ubicacion?.latitude,
          longitude: sesion.ubicacion?.longitude,
          is_default: false
        });
        console.log(`✅ Dirección guardada como ${labels[opcion - 1]}`);
      }
      
      // Mostrar métodos de pago
      let respuesta = `💳 *MÉTODO DE PAGO*\n\n`;
      Object.keys(METODOS_PAGO).forEach((key, index) => {
        respuesta += `*${index + 1}.* ${METODOS_PAGO[key]}\n`;
      });
      respuesta += `\n📝 Escribe el número`;
      
      return {
        mensaje: respuesta,
        nuevoEstado: ESTADOS.SELECCIONANDO_PAGO,
        datos: { esperandoGuardarDireccion: false }
      };
    }
  }
  
  // Seleccionar método de pago
  const numero = parseInt(mensaje.trim());
  const metodos = Object.values(METODOS_PAGO);
  
  if (isNaN(numero) || numero < 1 || numero > metodos.length) {
    return {
      mensaje: `❌ Opción inválida.\n\nEscribe 1-${metodos.length}`,
      nuevoEstado: ESTADOS.SELECCIONANDO_PAGO
    };
  }
  
  const metodoPago = metodos[numero - 1];
  
  try {
    actualizarSesion(telefono, { metodoPago });
    const sesionActualizada = obtenerSesion(telefono);
    
    const deliveryInfo = {
      costo: sesionActualizada.costoDelivery || 5.00,
      distancia: sesionActualizada.distanciaKm || 0,
      tiempo: sesionActualizada.tiempoEstimado || 30
    };
    
    const pedido = await crearPedido(telefono, sesionActualizada, deliveryInfo);
    
    const voucher = generarVoucher({
      numeroOrden: pedido.order_number,
      createdAt: pedido.created_at,
      restaurante: sesion.restaurante,
      carrito: sesion.carrito,
      direccion: sesion.direccion,
      referencia: sesion.referencia,
      metodoPago: metodoPago
    }, deliveryInfo);
    
    return {
      mensaje: voucher,
      nuevoEstado: ESTADOS.PEDIDO_ACTIVO,
      datos: { pedidoActual: pedido }
    };
    
  } catch (error) {
    console.error("Error creando pedido:", error);
    return {
      mensaje: "❌ Error al procesar tu pedido.\n\nContacta a soporte.",
      nuevoEstado: ESTADOS.INICIO
    };
  }
}

function manejarPedidoActivo(telefono, mensaje, sesion) {
  const textoLimpio = mensaje.trim().toUpperCase();
  
  if (textoLimpio === 'RASTREAR' || textoLimpio === 'ESTADO') {
    let respuesta = `📦 *ESTADO DEL PEDIDO*\n\n`;
    respuesta += `📋 Orden: ${sesion.pedidoActual.order_number}\n`;
    respuesta += `🏪 ${sesion.restaurante.name}\n\n`;
    respuesta += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    respuesta += `✅ Pedido recibido\n`;
    respuesta += `🍳 En preparación...\n`;
    respuesta += `⏱️ Tiempo estimado: ${sesion.tiempoEstimado || 30} min\n\n`;
    respuesta += `Te avisaremos cuando salga 🏍️`;
    
    return { mensaje: respuesta, nuevoEstado: ESTADOS.PEDIDO_ACTIVO };
  }
  
  return {
    mensaje: `Pedido activo (#${sesion.pedidoActual.order_number}).\n\n*RASTREAR* - Ver estado\n*AYUDA* - Soporte`,
    nuevoEstado: ESTADOS.PEDIDO_ACTIVO
  };
}

// --- MANEJADOR PRINCIPAL ---

async function procesarMensaje(telefono, mensaje, nombre, ubicacion = null, usuario = null) {
  const sesion = obtenerSesion(telefono);
  let resultado;
  
  const textoLimpio = mensaje.trim().toUpperCase();
  
  // Comandos globales
  if (textoLimpio === 'MENU' || textoLimpio === 'INICIO') {
    limpiarSesion(telefono);
    resultado = await manejarInicio(telefono, nombre);
  }
  else if (textoLimpio === 'AYUDA') {
    const ayuda = `🆘 *AYUDA*\n\n` +
      `*Comandos:*\n` +
      `• MENU - Ver restaurantes\n` +
      `• VER - Ver carrito\n` +
      `• LISTO - Confirmar\n` +
      `• VACIAR - Limpiar carrito\n` +
      `• RASTREAR - Estado pedido\n\n` +
      `📞 Soporte: +51 987 654 321`;
    
    return { mensaje: ayuda, nuevoEstado: sesion.estado };
  }
  else {
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
      
      case ESTADOS.GESTIONANDO_DIRECCION:
        resultado = await manejarGestionDireccion(telefono, sesion, usuario);
        break;
      
      case ESTADOS.SELECCIONANDO_DIRECCION_GUARDADA:
        resultado = await manejarSeleccionDireccionGuardada(telefono, mensaje, sesion);
        break;
      
      case ESTADOS.INGRESANDO_DIRECCION_NUEVA:
        resultado = await manejarDireccionNueva(telefono, mensaje, sesion, ubicacion, usuario);
        break;
      
      case ESTADOS.CONFIRMANDO_UBICACION:
        resultado = await manejarReferencia(telefono, mensaje, sesion, usuario);
        break;
      
      case ESTADOS.SELECCIONANDO_PAGO:
        resultado = await manejarMetodoPago(telefono, mensaje, sesion, nombre, usuario);
        break;
      
      case ESTADOS.PEDIDO_ACTIVO:
        resultado = manejarPedidoActivo(telefono, mensaje, sesion);
        break;
      
      default:
        resultado = await manejarInicio(telefono, nombre);
    }
  }
  
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
    status: "🤖 Musuq Delivery Bot v4.0",
    features: ["Gestión de direcciones", "Cálculo automático de delivery", "Botones interactivos"],
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
    } 
    else if (message.type === "location") {
      ubicacion = {
        latitude: message.location.latitude,
        longitude: message.location.longitude
      };
      textoMensaje = "📍 Ubicación recibida";
      console.log(`📍 ${nombre} envió ubicación`);
    } 
    else if (message.type === "interactive") {
      // ✅ MANEJAR RESPUESTA DE BOTONES
      const buttonReply = message.interactive.button_reply;
      textoMensaje = buttonReply.title;
      console.log(`🔘 ${nombre} presionó botón: ${textoMensaje}`);
    } 
    else {
      console.log(`⚠️ Tipo no soportado: ${message.type}`);
      await enviarMensajeWhatsApp(telefono, "Solo puedo procesar texto y ubicaciones 📍");
      return;
    }

    const usuario = await obtenerUsuario(telefono, nombre);
    const respuesta = await procesarMensaje(telefono, textoMensaje, nombre, ubicacion, usuario);
    
    // Solo enviar si hay respuesta (los botones ya se envían en manejarConfirmarCarrito)
    if (respuesta && respuesta.trim().length > 0) {
      await enviarMensajeWhatsApp(telefono, respuesta);
    }

  } catch (error) {
    console.error("❌ Error webhook:", error);
  }
});

app.get("/stats", (req, res) => {
  const stats = {
    sesiones_activas: sesiones.size,
    por_estado: {}
  };
  
  for (const [, sesion] of sesiones.entries()) {
    const estado = sesion.estado;
    stats.por_estado[estado] = (stats.por_estado[estado] || 0) + 1;
  }
  
  res.json(stats);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═════════════════════════════════════════╗
║   🤖 MUSUQ DELIVERY BOT v4.0           ║
║   📍 Geolocalización integrada         ║
║   💾 Direcciones guardadas             ║
║   📏 Cálculo automático de delivery    ║
╚═════════════════════════════════════════╝

✅ Sistema iniciado
📊 /stats para estadísticas
  `);
});