/**
 * Club de clientes · Backend de registro, sellos, canje de premios y estadísticas
 * Se pega en: Google Sheet > Extensiones > Apps Script
 *
 * Reglas:
 *  - El teléfono (formato 549 + 10 dígitos) es el ID único del cliente.
 *  - Cliente nuevo: se crea con 1 sello.
 *  - Cliente existente: suma 1 sello, máximo uno por día.
 *  - Con la tarjeta completa no suma más hasta que el personal canjea el premio.
 *
 * PINES (no van en el código). Se guardan en
 *   Configuración del proyecto > Propiedades de la secuencia de comandos
 *   PIN_PERSONAL : PIN del mozo/cajero. Solo puede canjear premios.
 *   PIN_DUENO    : PIN del dueño. Puede canjear y ver estadísticas y clientes.
 *   Los dos deben ser distintos (6 dígitos cada uno).
 */

const SELLOS_META = 5;                    // sellos para el premio
const ZONA = "America/Argentina/Buenos_Aires";

// MODO PRUEBA: en true permite sumar varios sellos el mismo día.
// Dejalo en false cuando el sistema esté en uso real.
const PERMITIR_VARIOS_POR_DIA = true;

// Sellos extra que recibe el cliente (una sola vez) al tocar el botón de WhatsApp
// de la pantalla de confirmación. Poné 0 para desactivar el sello extra.
const SELLO_BONO_WSP = 1;

const MAX_FALLOS_PIN = 5;                 // intentos fallidos antes de bloquear
const BLOQUEO_SEGUNDOS = 900;             // 15 minutos
const SEMANAS_GRAFICO = 8;                // semanas que muestra el gráfico

const HOJA_CLIENTES = "Clientes";
const HOJA_SELLOS = "Sellos";
const HOJA_CANJES = "Canjes";

// Posición de cada columna en la hoja "Clientes"
const COL = {
  TEL: 1, NOMBRE: 2, CUMPLE_DIA: 3, CUMPLE_MES: 4,
  ALTA: 5, SELLOS: 6, ULTIMO: 7, VISITAS: 8, CANJES: 9, WSP: 10
};

/** Ejecutar a mano (también después de actualizar el código): crea hojas y encabezados. */
function configurar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const clientes = ss.getSheetByName(HOJA_CLIENTES) || ss.insertSheet(HOJA_CLIENTES);
  clientes.getRange(1, 1, 1, 10)
    .setValues([["Teléfono", "Nombre", "Cumple día", "Cumple mes", "Fecha de alta", "Sellos", "Último sello", "Visitas", "Premios canjeados", "WhatsApp activado"]])
    .setFontWeight("bold");
  // Texto plano para que Sheets no convierta teléfonos ni fechas
  clientes.getRange("A:A").setNumberFormat("@");
  clientes.getRange("E:E").setNumberFormat("@");
  clientes.getRange("G:G").setNumberFormat("@");
  clientes.getRange("J:J").setNumberFormat("@");
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
      case "verificar":     return respuesta(accionVerificar(d));
      case "buscar":        return respuesta(accionBuscar(d));
      case "canjear":       return respuesta(accionCanjear(d));
      case "estadisticas":  return respuesta(accionEstadisticas(d));
      case "whatsapp":      return respuesta(accionWhatsapp(d));       // formulario público
      default:              return respuesta(accionRegistro(d));   // formulario público
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
    clientes.appendRow([tel, nombre, cumpleDia, cumpleMes, hoy, 1, hoy, 1, 0, ""]);
    hojaSellos.appendRow([hoy, hora, tel, nombre]);
    return {
      ok: true,
      estado: SELLOS_META <= 1 ? "completa" : "nuevo",
      nombre: nombre,
      sellos: 1,
      meta: SELLOS_META,
      sumo: true,
      wsp: false,
      bonoWsp: SELLO_BONO_WSP
    };
  }

  // ---- Cliente que vuelve ----
  const f = clientes.getRange(fila, 1, 1, 10).getValues()[0];
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

  return {
    ok: true,
    estado: estado,
    nombre: nombreGuardado,
    sellos: sellos,
    meta: SELLOS_META,
    sumo: sumo,
    wsp: String(f[COL.WSP - 1]) !== "",
    bonoWsp: SELLO_BONO_WSP
  };
}

/**
 * El cliente tocó el botón de WhatsApp de la confirmación (acción pública, sin PIN).
 * Se registra la fecha una sola vez y se le suma el sello extra, sin pasar de la meta.
 * No se cuenta como visita ni como fila en la hoja Sellos.
 */
function accionWhatsapp(d) {
  const tel = normalizarTel(d.whatsapp);
  if (!tel) return { ok: false, error: "telefono_invalido" };

  const clientes = hoja(HOJA_CLIENTES);
  const fila = buscarFila(clientes, tel);
  if (fila === -1) return { ok: false, error: "no_encontrado" };

  const f = clientes.getRange(fila, 1, 1, 10).getValues()[0];
  let sellos = Number(f[COL.SELLOS - 1]) || 0;

  if (String(f[COL.WSP - 1]) !== "") {
    return { ok: true, yaReclamado: true, bono: 0, sellos: sellos, meta: SELLOS_META };
  }

  const antes = sellos;
  sellos = Math.min(SELLOS_META, sellos + SELLO_BONO_WSP);
  const hoy = Utilities.formatDate(new Date(), ZONA, "yyyy-MM-dd");
  clientes.getRange(fila, COL.SELLOS).setValue(sellos);
  clientes.getRange(fila, COL.WSP).setValue(hoy);

  return {
    ok: true,
    yaReclamado: false,
    bono: sellos - antes,
    sellos: sellos,
    meta: SELLOS_META,
    estado: sellos >= SELLOS_META ? "completa" : "suma"
  };
}

/* ===================== PIN Y ROLES ===================== */

/**
 * Identifica quién es según el PIN: "personal", "dueno", o un código de error
 * ("pin_incorrecto", "bloqueado", "sin_pin").
 * Bloquea unos minutos después de varios intentos fallidos.
 */
function identificarRol(pin) {
  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get("pin_fallos")) || 0;
  if (fallos >= MAX_FALLOS_PIN) return "bloqueado";

  const props = PropertiesService.getScriptProperties();
  const pinPersonal = props.getProperty("PIN_PERSONAL");
  const pinDueno = props.getProperty("PIN_DUENO");
  if (!pinPersonal && !pinDueno) return "sin_pin";

  const ingresado = String(pin || "");
  let rol = "";
  if (pinDueno && ingresado === String(pinDueno)) rol = "dueno";
  else if (pinPersonal && ingresado === String(pinPersonal)) rol = "personal";

  if (!rol) {
    cache.put("pin_fallos", String(fallos + 1), BLOQUEO_SEGUNDOS);
    return "pin_incorrecto";
  }
  cache.remove("pin_fallos");
  return rol;
}

/**
 * Comprueba que el PIN tenga permiso para la acción.
 * soloDueno = true: únicamente el PIN del dueño.
 * Devuelve { ok: true, rol } o { ok: false, error }.
 */
function validarAcceso(pin, soloDueno) {
  const rol = identificarRol(pin);
  if (rol === "dueno") return { ok: true, rol: rol };
  if (rol === "personal") {
    return soloDueno ? { ok: false, error: "sin_permiso" } : { ok: true, rol: rol };
  }
  return { ok: false, error: rol };
}

/* ===================== PERSONAL Y DUEÑO ===================== */

function accionVerificar(d) {
  const a = validarAcceso(d.pin, false);
  return a.ok ? { ok: true, rol: a.rol } : a;
}

function accionBuscar(d) {
  const a = validarAcceso(d.pin, false);
  if (!a.ok) return a;

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
  const a = validarAcceso(d.pin, false);
  if (!a.ok) return a;

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

/* ===================== ESTADÍSTICAS (solo dueño) ===================== */

function accionEstadisticas(d) {
  const a = validarAcceso(d.pin, true);
  if (!a.ok) return a;

  // Clientes
  const hojaClientes = hoja(HOJA_CLIENTES);
  const ultimaCliente = hojaClientes.getLastRow();
  const clientes = [];
  if (ultimaCliente >= 2) {
    const filas = hojaClientes.getRange(2, 1, ultimaCliente - 1, 10).getValues();
    filas.forEach(function (f) {
      clientes.push({
        nombre: String(f[COL.NOMBRE - 1]),
        telefono: String(f[COL.TEL - 1]),
        cumpleDia: Number(f[COL.CUMPLE_DIA - 1]) || 0,
        cumpleMes: Number(f[COL.CUMPLE_MES - 1]) || 0,
        alta: fechaATexto(f[COL.ALTA - 1]),
        sellos: Number(f[COL.SELLOS - 1]) || 0,
        ultimo: fechaATexto(f[COL.ULTIMO - 1]),
        visitas: Number(f[COL.VISITAS - 1]) || 0,
        canjes: Number(f[COL.CANJES - 1]) || 0,
        wsp: String(f[COL.WSP - 1]) !== ""
      });
    });
  }

  // Semanas (de lunes a domingo), de la más antigua a la actual
  const hoy = Utilities.formatDate(new Date(), ZONA, "yyyy-MM-dd");
  const lunesActual = lunesDe(hoy);
  const semanas = [];
  for (let i = SEMANAS_GRAFICO - 1; i >= 0; i--) {
    semanas.push({ inicio: sumarDias(lunesActual, -7 * i), sellos: 0, nuevos: 0, volvieron: 0 });
  }
  const indice = {};
  semanas.forEach(function (s, i) { indice[s.inicio] = i; });

  // Sellos entregados en total y por semana.
  // "Volvieron" = clientes distintos que sumaron en esa semana un sello que NO era su primero
  // (las filas de la hoja Sellos están en orden cronológico).
  const hojaSellos = hoja(HOJA_SELLOS);
  const ultimaSello = hojaSellos.getLastRow();
  let totalSellos = 0;
  const vistos = {};
  const retornos = semanas.map(function () { return {}; });
  if (ultimaSello >= 2) {
    const filasSellos = hojaSellos.getRange(2, 1, ultimaSello - 1, 3).getValues();
    totalSellos = filasSellos.length;
    filasSellos.forEach(function (r) {
      const tel = String(r[2]);
      const i = indice[lunesDe(fechaATexto(r[0]))];
      if (i !== undefined) semanas[i].sellos++;
      if (vistos[tel]) {
        if (i !== undefined) retornos[i][tel] = true;   // ya tenía un sello antes: volvió
      } else {
        vistos[tel] = true;                              // su primer sello
      }
    });
  }
  semanas.forEach(function (s, i) { s.volvieron = Object.keys(retornos[i]).length; });

  // Clientes nuevos por semana
  clientes.forEach(function (c) {
    const i = indice[lunesDe(c.alta)];
    if (i !== undefined) semanas[i].nuevos++;
  });

  return {
    ok: true,
    hoy: hoy,
    meta: SELLOS_META,
    resumen: {
      clientes: clientes.length,
      sellos: totalSellos,
      canjes: clientes.reduce(function (t, c) { return t + c.canjes; }, 0),
      completas: clientes.filter(function (c) { return c.sellos >= SELLOS_META; }).length,
      wsp: clientes.filter(function (c) { return c.wsp; }).length
    },
    semanas: semanas,
    clientes: clientes
  };
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

/** Lunes de la semana de una fecha yyyy-MM-dd (devuelve "" si la fecha no es válida). */
function lunesDe(fechaTexto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaTexto || ""));
  if (!m) return "";
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const diaSemana = (dt.getUTCDay() + 6) % 7;          // lunes = 0
  dt.setUTCDate(dt.getUTCDate() - diaSemana);
  return dt.toISOString().slice(0, 10);
}

/** Suma (o resta) días a una fecha yyyy-MM-dd. */
function sumarDias(fechaTexto, dias) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaTexto);
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

function respuesta(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
