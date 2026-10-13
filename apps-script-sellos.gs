/**
 * Club de clientes · Backend de registro, sellos y canje de premios
 * Se pega en: Google Sheet > Extensiones > Apps Script
 *
 * Reglas:
 *  - El teléfono (formato 549 + 10 dígitos) es el ID único del cliente.
 *  - Cliente nuevo: se crea con 1 sello.
 *  - Cliente existente: suma 1 sello, máximo uno por día.
 *  - Con la tarjeta completa no suma más hasta que el personal canjea el premio.
 *  - El canje solo lo puede hacer el personal con el PIN del local.
 *
 * PIN del personal: no va en el código. Se guarda en
 *   Configuración del proyecto > Propiedades de la secuencia de comandos
 *   Propiedad: PIN_PERSONAL   Valor: 6 dígitos (por ejemplo 482913)
 */

const SELLOS_META = 5;                    // sellos para el premio
const ZONA = "America/Argentina/Buenos_Aires";

// MODO PRUEBA: en true permite sumar varios sellos el mismo día.
// Dejalo en false cuando el sistema esté en uso real.
const PERMITIR_VARIOS_POR_DIA = true;

const MAX_FALLOS_PIN = 5;                 // intentos fallidos antes de bloquear
const BLOQUEO_SEGUNDOS = 900;             // 15 minutos

const HOJA_CLIENTES = "Clientes";
const HOJA_SELLOS = "Sellos";
const HOJA_CANJES = "Canjes";

// Posición de cada columna en la hoja "Clientes"
const COL = {
  TEL: 1, NOMBRE: 2, CUMPLE_DIA: 3, CUMPLE_MES: 4,
  ALTA: 5, SELLOS: 6, ULTIMO: 7, VISITAS: 8, CANJES: 9
};

/** Ejecutar a mano (también después de actualizar el código): crea hojas y encabezados. */
function configurar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const clientes = ss.getSheetByName(HOJA_CLIENTES) || ss.insertSheet(HOJA_CLIENTES);
  clientes.getRange(1, 1, 1, 9)
    .setValues([["Teléfono", "Nombre", "Cumple día", "Cumple mes", "Fecha de alta", "Sellos", "Último sello", "Visitas", "Premios canjeados"]])
    .setFontWeight("bold");
  // Texto plano para que Sheets no convierta teléfonos ni fechas
  clientes.getRange("A:A").setNumberFormat("@");
  clientes.getRange("E:E").setNumberFormat("@");
  clientes.getRange("G:G").setNumberFormat("@");
  clientes.setFrozenRows(1);

  const sellos = ss.getSheetByName(HOJA_SELLOS) || ss.insertSheet(HOJA_SELLOS);
  sellos.getRange(1, 1, 1, 4)
    .setValues([["Fecha", "Hora", "Teléfono", "Nombre"]])
    .setFontWeight("bold");
  sellos.getRange("A:C").setNumberFormat("@");
  sellos.setFrozenRows(1);

  const canjes = ss.getSheetByName(HOJA_CANJES) || ss.insertSheet(HOJA_CANJES);
  canjes.getRange(1, 1, 1, 5)
    .setValues([["Fecha", "Hora", "Teléfono", "Nombre", "Atendió"]])
    .setFontWeight("bold");
  canjes.getRange("A:C").setNumberFormat("@");
  canjes.setFrozenRows(1);
}

/** Sirve para probar que el despliegue funciona (abrir la URL en el navegador). */
function doGet() {
  return respuesta({ ok: true, servicio: "club-de-clientes" });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let tomado = false;
  try {
    lock.waitLock(15000);       // evita que dos pedidos simultáneos se pisen
    tomado = true;

    const d = JSON.parse(e.postData.contents);
    switch (d.accion) {
      case "verificar": return respuesta(accionVerificar(d));
      case "buscar":    return respuesta(accionBuscar(d));
      case "canjear":   return respuesta(accionCanjear(d));
      default:          return respuesta(accionRegistro(d));   // formulario público
    }
  } catch (err) {
    return respuesta({ ok: false, error: "error_servidor" });
  } finally {
    if (tomado) lock.releaseLock();
  }
}

/* ===================== REGISTRO (formulario público) ===================== */

function accionRegistro(d) {
  const tel = normalizarTel(d.whatsapp);
  // Quita =, +, -, @ del inicio para que Sheets no lo interprete como fórmula
  const nombre = limpiarTexto(d.nombre, 60);
  const cumpleDia = String(d.cumple_dia || "");
  const cumpleMes = String(d.cumple_mes || "");

  if (!tel || nombre.length < 2 || d.consentimiento !== true) {
    return { ok: false, error: "datos_invalidos" };
  }

  const clientes = hoja(HOJA_CLIENTES);
  const hojaSellos = hoja(HOJA_SELLOS);

  const ahora = new Date();
  const hoy = Utilities.formatDate(ahora, ZONA, "yyyy-MM-dd");
  const hora = Utilities.formatDate(ahora, ZONA, "HH:mm:ss");

  const fila = buscarFila(clientes, tel);

  // ---- Cliente nuevo ----
  if (fila === -1) {
    clientes.appendRow([tel, nombre, cumpleDia, cumpleMes, hoy, 1, hoy, 1, 0]);
    hojaSellos.appendRow([hoy, hora, tel, nombre]);
    return {
      ok: true,
      estado: SELLOS_META <= 1 ? "completa" : "nuevo",
      nombre: nombre,
      sellos: 1,
      meta: SELLOS_META,
      sumo: true
    };
  }

  // ---- Cliente que vuelve ----
  const f = clientes.getRange(fila, 1, 1, 9).getValues()[0];
  const nombreGuardado = String(f[COL.NOMBRE - 1]) || nombre;
  let sellos = Number(f[COL.SELLOS - 1]) || 0;
  const ultimo = fechaATexto(f[COL.ULTIMO - 1]);
  let estado;
  let sumo = false;

  // Si todavía no tenía cumpleaños y ahora lo dejó, lo completamos
  if (!f[COL.CUMPLE_DIA - 1] && cumpleDia && cumpleMes) {
    clientes.getRange(fila, COL.CUMPLE_DIA, 1, 2).setValues([[cumpleDia, cumpleMes]]);
  }

  if (sellos >= SELLOS_META) {
    estado = "completa";                       // premio pendiente de canje
  } else if (ultimo === hoy && !PERMITIR_VARIOS_POR_DIA) {
    estado = "ya_hoy";                         // ya sumó su sello hoy
  } else {
    sellos += 1;
    sumo = true;
    clientes.getRange(fila, COL.SELLOS).setValue(sellos);
    clientes.getRange(fila, COL.ULTIMO).setValue(hoy);
    clientes.getRange(fila, COL.VISITAS).setValue((Number(f[COL.VISITAS - 1]) || 0) + 1);
    hojaSellos.appendRow([hoy, hora, tel, nombreGuardado]);
    estado = sellos >= SELLOS_META ? "completa" : "suma";
  }

  return { ok: true, estado: estado, nombre: nombreGuardado, sellos: sellos, meta: SELLOS_META, sumo: sumo };
}

/* ===================== PERSONAL (requiere PIN) ===================== */

/** Comprueba el PIN. Bloquea unos minutos después de varios intentos fallidos. */
function comprobarPin(pin) {
  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get("pin_fallos")) || 0;
  if (fallos >= MAX_FALLOS_PIN) return "bloqueado";

  const correcto = PropertiesService.getScriptProperties().getProperty("PIN_PERSONAL");
  if (!correcto) return "sin_pin";

  if (String(pin || "") !== String(correcto)) {
    cache.put("pin_fallos", String(fallos + 1), BLOQUEO_SEGUNDOS);
    return "pin_incorrecto";
  }
  cache.remove("pin_fallos");
  return "ok";
}

function accionVerificar(d) {
  const p = comprobarPin(d.pin);
  return p === "ok" ? { ok: true } : { ok: false, error: p };
}

function accionBuscar(d) {
  const p = comprobarPin(d.pin);
  if (p !== "ok") return { ok: false, error: p };

  const tel = normalizarTel(d.whatsapp);
  if (!tel) return { ok: false, error: "telefono_invalido" };

  const clientes = hoja(HOJA_CLIENTES);
  const fila = buscarFila(clientes, tel);
  if (fila === -1) return { ok: true, encontrado: false };

  const f = clientes.getRange(fila, 1, 1, 9).getValues()[0];
  const sellos = Number(f[COL.SELLOS - 1]) || 0;
  return {
    ok: true,
    encontrado: true,
    nombre: String(f[COL.NOMBRE - 1]),
    sellos: sellos,
    meta: SELLOS_META,
    canjeable: sellos >= SELLOS_META,
    canjes: Number(f[COL.CANJES - 1]) || 0
  };
}

function accionCanjear(d) {
  const p = comprobarPin(d.pin);
  if (p !== "ok") return { ok: false, error: p };

  const tel = normalizarTel(d.whatsapp);
  if (!tel) return { ok: false, error: "telefono_invalido" };

  const clientes = hoja(HOJA_CLIENTES);
  const fila = buscarFila(clientes, tel);
  if (fila === -1) return { ok: false, error: "no_encontrado" };

  const f = clientes.getRange(fila, 1, 1, 9).getValues()[0];
  const sellos = Number(f[COL.SELLOS - 1]) || 0;
  if (sellos < SELLOS_META) {
    return { ok: false, error: "tarjeta_incompleta", sellos: sellos, meta: SELLOS_META };
  }

  const nombre = String(f[COL.NOMBRE - 1]);
  const canjesTotal = (Number(f[COL.CANJES - 1]) || 0) + 1;
  const atendio = limpiarTexto(d.atendio, 40);

  const ahora = new Date();
  const hoy = Utilities.formatDate(ahora, ZONA, "yyyy-MM-dd");
  const hora = Utilities.formatDate(ahora, ZONA, "HH:mm:ss");

  clientes.getRange(fila, COL.SELLOS).setValue(0);          // la tarjeta vuelve a empezar
  clientes.getRange(fila, COL.CANJES).setValue(canjesTotal);
  hoja(HOJA_CANJES).appendRow([hoy, hora, tel, nombre, atendio]);

  return { ok: true, nombre: nombre, canjes: canjesTotal };
}

/* ===================== Utilidades ===================== */

function hoja(nombre) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
}

/** Devuelve el teléfono si tiene formato 549 + 10 dígitos; si no, cadena vacía. */
function normalizarTel(valor) {
  const tel = String(valor || "").replace(/\D/g, "");
  return /^549\d{10}$/.test(tel) ? tel : "";
}

/** Limpia un texto del usuario: recorta, limita el largo y evita fórmulas en Sheets. */
function limpiarTexto(valor, maximo) {
  return String(valor || "").trim().replace(/^[=+\-@\s]+/, "").slice(0, maximo);
}

/** Número de fila (empezando en 2) del teléfono, o -1 si no existe. */
function buscarFila(clientes, tel) {
  const ultima = clientes.getLastRow();
  if (ultima < 2) return -1;
  const telefonos = clientes.getRange(2, COL.TEL, ultima - 1, 1).getValues();
  for (let i = 0; i < telefonos.length; i++) {
    if (String(telefonos[i][0]) === tel) return i + 2;
  }
  return -1;
}

/** Si Sheets convirtió la fecha en un Date, la vuelve a texto yyyy-MM-dd. */
function fechaATexto(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, ZONA, "yyyy-MM-dd");
  return String(valor);
}

function respuesta(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
