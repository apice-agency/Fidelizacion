/* ============ CONFIGURACIÓN ============ */
const CONFIG = {
  nombreLocal: "La Brasa",
  // Misma URL de Apps Script que usa el formulario público (script.js)
  endpoint: "https://script.google.com/macros/s/AKfycbw1XMosN14jNwn2Xq5TP0IuJmMiseiFUQ3muQUK5q2ib-zBeMaimauGaUxMJMh5zDBqSQ/exec"
};

const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MAX_FILAS_TABLA = 300;

const el = (id) => document.getElementById(id);
function texto(id, valor) { el(id).textContent = valor; }

el("marca-login").textContent = CONFIG.nombreLocal;
el("marca-lateral").textContent = CONFIG.nombreLocal;
document.title = "Panel · " + CONFIG.nombreLocal;

/* ============ Sesión (el PIN vive solo mientras la pestaña está abierta) ============ */
function leerSesion(clave) {
  try { return sessionStorage.getItem(clave) || ""; } catch (e) { return ""; }
}
function guardarSesion(clave, valor) {
  try { sessionStorage.setItem(clave, valor); } catch (e) { /* sin almacenamiento: se pide de nuevo */ }
}
function borrarSesion(clave) {
  try { sessionStorage.removeItem(clave); } catch (e) { /* nada */ }
}

let pinActual = leerSesion("club_pin");
let rolActual = "";
let telActual = "";
let metaActual = 5;
let datosPanel = null;
let cargando = false;

/* ============ Mensajes y llamadas al servidor ============ */
const MENSAJES = {
  pin_incorrecto: "PIN incorrecto.",
  bloqueado: "Demasiados intentos fallidos. Probá de nuevo en 15 minutos.",
  sin_pin: "Falta configurar el PIN del local en las propiedades del script.",
  sin_permiso: "Tu PIN no permite ver esta sección.",
  telefono_invalido: "Revisá el número: código de área + número, sin el 15.",
  no_encontrado: "No encontramos a ese cliente.",
  tarjeta_incompleta: "Esa tarjeta todavía no tiene todos los sellos.",
  datos_invalidos: "Los datos no son válidos.",
  error_servidor: "Algo falló en el servidor. Probá de nuevo."
};
function mensajeDe(r) {
  return (r && MENSAJES[r.error]) || "No pudimos completar la acción. Revisá tu conexión y probá de nuevo.";
}

async function llamar(accion, extra) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 25000);
  try {
    const cuerpo = Object.assign({ accion: accion, pin: pinActual }, extra || {});
    const res = await fetch(CONFIG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(cuerpo),
      signal: control.signal
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ============ Utilidades ============ */
function limpiarTelefono(valor) {
  let n = valor.replace(/\D/g, "");
  n = n.replace(/^00/, "");
  if (n.startsWith("54")) {
    n = n.slice(2);
    n = n.replace(/^9/, "");
  }
  n = n.replace(/^0/, "");
  n = n.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");
  return n;
}
function telefonoValido(valor) { return limpiarTelefono(valor).length === 10; }
function aE164(valor) { return "549" + limpiarTelefono(valor); }

function aUTC(fecha) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha || "");
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}
function diasEntre(desde, hasta) {
  const a = aUTC(desde), b = aUTC(hasta);
  return (isNaN(a) || isNaN(b)) ? 0 : Math.round((b - a) / 86400000);
}
function fechaCorta(fecha) {          // 2026-10-12 -> 12/10/2026
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha || "");
  return m ? m[3] + "/" + m[2] + "/" + m[1] : "—";
}
function diaMes(fecha) {              // 2026-10-12 -> 12/10
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha || "");
  return m ? m[3] + "/" + m[2] : "";
}

/* ============ Ingreso y salida ============ */
function entrarAlPanel(rol) {
  rolActual = rol;
  document.body.classList.add("en-panel");
  el("vista-pin").hidden = true;
  el("app").hidden = false;
  texto("rol-etiqueta", rol === "dueno" ? "Dueño" : "Personal");
  document.querySelectorAll("[data-solo-dueno]").forEach((x) => { x.hidden = (rol !== "dueno"); });
  menu(esEscritorio.matches);
  mostrarCanje("buscar");
  irASeccion("canjear");
  el("telefono").focus();
}

function salirDelPanel(mensaje) {
  pinActual = "";
  rolActual = "";
  datosPanel = null;
  borrarSesion("club_pin");
  document.body.classList.remove("en-panel");
  el("app").hidden = true;
  el("vista-pin").hidden = false;
  el("pin").value = "";
  el("telefono").value = "";
  texto("err-pin", mensaje || "");
  menu(false);
  el("pin").focus();
}

el("form-pin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = el("pin").value.trim();
  const boton = el("btn-pin");
  if (!pin) { texto("err-pin", "Escribí el PIN."); return; }

  texto("err-pin", "");
  pinActual = pin;
  boton.disabled = true;
  boton.textContent = "Verificando…";
  try {
    const r = await llamar("verificar");
    if (r && r.ok) {
      guardarSesion("club_pin", pin);
      el("pin").value = "";
      entrarAlPanel(r.rol);
    } else {
      pinActual = "";
      texto("err-pin", mensajeDe(r));
    }
  } catch (err) {
    pinActual = "";
    texto("err-pin", mensajeDe(null));
  } finally {
    boton.disabled = false;
    boton.textContent = "Entrar";
  }
});

el("btn-salir").addEventListener("click", () => salirDelPanel(""));

/* ============ Menú lateral ============ */
const esEscritorio = window.matchMedia("(min-width: 900px)");

function menu(abrir) {
  el("app").classList.toggle("menu-abierto", abrir);
  el("btn-menu").setAttribute("aria-expanded", String(abrir));
  el("btn-menu").setAttribute("aria-label", abrir ? "Cerrar menú" : "Abrir menú");
  el("velo").hidden = !abrir || esEscritorio.matches;
}
el("btn-menu").addEventListener("click", () => {
  menu(!el("app").classList.contains("menu-abierto"));
});
el("velo").addEventListener("click", () => menu(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !esEscritorio.matches && el("app").classList.contains("menu-abierto")) {
    menu(false);
    el("btn-menu").focus();
  }
});
esEscritorio.addEventListener("change", (e) => menu(e.matches));

const TITULOS = { canjear: "Canjear premio", estadisticas: "Estadísticas", clientes: "Clientes" };

function irASeccion(nombre) {
  if (nombre !== "canjear" && rolActual !== "dueno") nombre = "canjear";

  Object.keys(TITULOS).forEach((s) => { el("sec-" + s).hidden = (s !== nombre); });
  document.querySelectorAll(".nav-item").forEach((b) => {
    const activo = (b.dataset.seccion === nombre);
    b.classList.toggle("activo", activo);
    if (activo) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  texto("titulo-seccion", TITULOS[nombre]);

  if (!esEscritorio.matches) menu(false);
  if (nombre !== "canjear") cargarDatos(false);
  window.scrollTo(0, 0);
}
document.querySelectorAll(".nav-item").forEach((b) => {
  b.addEventListener("click", () => irASeccion(b.dataset.seccion));
});

/* ============ CANJEAR PREMIO ============ */
function mostrarCanje(vista) {
  el("canj-buscar").hidden = (vista !== "buscar");
  el("canj-resultado").hidden = (vista !== "resultado");
}

el("form-buscar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const campo = el("telefono");
  const boton = el("btn-buscar");

  if (!telefonoValido(campo.value.trim())) {
    texto("err-telefono", "Revisá el número: código de área + número, sin el 15. Ej: 11 2345 6789.");
    campo.classList.add("invalido");
    return;
  }
  texto("err-telefono", "");
  campo.classList.remove("invalido");

  telActual = aE164(campo.value.trim());
  boton.disabled = true;
  boton.textContent = "Buscando…";
  try {
    const r = await llamar("buscar", { whatsapp: telActual });
    if (!r || !r.ok) {
      if (r && r.error === "pin_incorrecto") { salirDelPanel(MENSAJES.pin_incorrecto); return; }
      texto("err-telefono", mensajeDe(r));
      return;
    }
    mostrarResultado(r);
  } catch (err) {
    texto("err-telefono", mensajeDe(null));
  } finally {
    boton.disabled = false;
    boton.textContent = "Buscar tarjeta";
  }
});

function dibujarSellos(sellos, meta) {
  const cont = el("res-sellos");
  const giros = [-7, 5, -3, 8, -5, 4, -8, 6];
  const inicial = CONFIG.nombreLocal.trim().charAt(0).toUpperCase();
  cont.innerHTML = "";
  for (let i = 0; i < meta; i++) {
    const d = document.createElement("div");
    const lleno = i < sellos;
    d.className = "sello" + (lleno ? " lleno" : "") + (i === meta - 1 ? " premio" : "");
    d.style.setProperty("--giro", giros[i % giros.length] + "deg");
    d.textContent = lleno ? inicial : (i === meta - 1 ? "★" : "");
    cont.appendChild(d);
  }
  cont.setAttribute("aria-label", sellos + " de " + meta + " sellos");
}

function textoFaltan(n) {
  return (n === 1 ? "Le falta 1 sello" : "Le faltan " + n + " sellos") + " para el plato libre.";
}

function reiniciarPasos() {
  texto("err-resultado", "");
  el("paso-canjear").hidden = false;
  el("paso-confirmar").hidden = true;
  el("btn-canjear").disabled = false;
}

function mostrarResultado(r) {
  reiniciarPasos();
  const bloque = el("bloque-canje");

  if (!r.encontrado) {
    texto("res-titulo", "No encontramos ese número");
    texto("res-texto", "Revisá que sea el mismo WhatsApp con el que se registró el cliente.");
    el("res-sellos").innerHTML = "";
    texto("res-cuenta", "");
    bloque.hidden = true;
  } else {
    metaActual = r.meta;
    texto("res-titulo", r.nombre);
    dibujarSellos(r.sellos, r.meta);
    let cuenta = r.sellos + " de " + r.meta + " sellos.";
    if (r.canjes > 0) cuenta += " Premios canjeados antes: " + r.canjes + ".";
    texto("res-cuenta", cuenta);

    if (r.canjeable) {
      texto("res-texto", "Tiene la tarjeta completa. El plato libre está listo para canjear.");
      el("atendio").value = leerSesion("club_atendio");
      bloque.hidden = false;
    } else {
      texto("res-texto", textoFaltan(Math.max(r.meta - r.sellos, 0)) + " Todavía no puede canjear.");
      bloque.hidden = true;
    }
  }

  mostrarCanje("resultado");
  el("res-titulo").focus({ preventScroll: true });
}

// Canje en dos pasos para evitar toques accidentales
el("btn-canjear").addEventListener("click", () => {
  el("paso-canjear").hidden = true;
  el("paso-confirmar").hidden = false;
  el("btn-confirmar").focus();
});
el("btn-cancelar").addEventListener("click", reiniciarPasos);

el("btn-confirmar").addEventListener("click", async () => {
  const boton = el("btn-confirmar");
  const atendio = el("atendio").value.trim();
  boton.disabled = true;
  boton.textContent = "Canjeando…";
  texto("err-resultado", "");

  try {
    const r = await llamar("canjear", { whatsapp: telActual, atendio: atendio });
    if (r && r.ok) {
      guardarSesion("club_atendio", atendio);
      datosPanel = null;                       // las estadísticas cambiaron: se recargan
      texto("res-titulo", "Canje registrado");
      texto("res-texto", "Plato libre entregado a " + r.nombre + ". Su tarjeta vuelve a empezar.");
      dibujarSellos(0, metaActual);
      texto("res-cuenta", "0 sellos. Premios canjeados en total: " + r.canjes + ".");
      el("bloque-canje").hidden = true;
    } else {
      if (r && r.error === "pin_incorrecto") { salirDelPanel(MENSAJES.pin_incorrecto); return; }
      texto("err-resultado", mensajeDe(r));
      reiniciarPasos();
    }
  } catch (err) {
    texto("err-resultado", mensajeDe(null));
    reiniciarPasos();
  } finally {
    boton.disabled = false;
    boton.textContent = "Sí, canjear";
  }
});

el("btn-otro").addEventListener("click", () => {
  el("telefono").value = "";
  mostrarCanje("buscar");
  el("telefono").focus();
});

/* ============ ESTADÍSTICAS Y CLIENTES (solo dueño) ============ */
async function cargarDatos(forzar) {
  if (cargando) return;
  if (datosPanel && !forzar) return;

  cargando = true;
  texto("stats-estado", "Cargando…");
  texto("clientes-estado", "Cargando…");
  try {
    const r = await llamar("estadisticas");
    if (r && r.ok) {
      datosPanel = r;
      texto("stats-estado", "");
      texto("clientes-estado", "");
      renderEstadisticas();
      renderClientes();
    } else {
      if (r && r.error === "pin_incorrecto") { salirDelPanel(MENSAJES.pin_incorrecto); return; }
      const m = mensajeDe(r);
      texto("stats-estado", m);
      texto("clientes-estado", m);
    }
  } catch (err) {
    const m = mensajeDe(null);
    texto("stats-estado", m);
    texto("clientes-estado", m);
  } finally {
    cargando = false;
  }
}
el("btn-actualizar-stats").addEventListener("click", () => cargarDatos(true));
el("btn-actualizar-clientes").addEventListener("click", () => cargarDatos(true));

/* ---------- Estadísticas ---------- */
function renderEstadisticas() {
  const d = datosPanel;
  const nuevosSemana = d.semanas.length ? d.semanas[d.semanas.length - 1].nuevos : 0;
  const sinVolver = d.clientes.filter((c) => c.ultimo && diasEntre(c.ultimo, d.hoy) >= 7).length;
  // "Visitas" cuenta los sellos sumados: 1 = solo se registró, 2 o más = volvió
  const recurrentes = d.clientes
    .filter((c) => c.visitas >= 2)
    .sort((a, b) => b.visitas - a.visitas || (b.ultimo || "").localeCompare(a.ultimo || ""));

  const tarjetas = [
    { n: d.resumen.clientes,  t: "Clientes registrados" },
    { n: d.resumen.sellos,    t: "Sellos entregados" },
    { n: d.resumen.canjes,    t: "Premios canjeados" },
    { n: d.resumen.completas, t: "Tarjetas completas sin canjear" },
    { n: nuevosSemana,        t: "Clientes nuevos esta semana" },
    { n: recurrentes.length,  t: "Clientes que volvieron a sumar sello" },
    { n: sinVolver,           t: "Sin volver hace 7 días o más" }
  ];
  const cont = el("stats-cards");
  cont.innerHTML = "";
  tarjetas.forEach((x) => {
    const caja = document.createElement("div");
    caja.className = "dato";
    const num = document.createElement("b");
    num.textContent = String(x.n);
    const lab = document.createElement("span");
    lab.textContent = x.t;
    caja.appendChild(num);
    caja.appendChild(lab);
    cont.appendChild(caja);
  });

  dibujarGrafico(d.semanas);
  renderRecurrentes(d, recurrentes);
  renderCumples(d);
}

function renderRecurrentes(d, recurrentes) {
  const total = d.clientes.length;
  const lista = el("recurrentes-lista");
  lista.innerHTML = "";

  if (!recurrentes.length) {
    texto("recurrentes-nota", "");
    const li = document.createElement("li");
    li.className = "vacio";
    li.textContent = "Todavía ningún cliente volvió a sumar un sello.";
    lista.appendChild(li);
    return;
  }

  const porcentaje = Math.round((recurrentes.length / total) * 100);
  texto("recurrentes-nota",
    recurrentes.length + " de " + total + " clientes registrados volvieron al menos una vez (" + porcentaje + "%).");
  recurrentes.forEach((c) => {
    const li = document.createElement("li");
    li.textContent = c.nombre + ": " + c.visitas + " sellos sumados, última visita " + fechaCorta(c.ultimo) + ".";
    lista.appendChild(li);
  });
}

function dibujarGrafico(semanas) {
  const NS = "http://www.w3.org/2000/svg";
  const W = 640, H = 270, izq = 34, der = 8, arriba = 26, abajo = 34;
  const maxDato = Math.max(1, ...semanas.map((s) => Math.max(s.sellos, s.nuevos, s.volvieron || 0)));
  const tope = maxDato <= 5 ? 5 : Math.ceil(maxDato / 5) * 5;
  const altoUtil = H - arriba - abajo;
  const ancho = (W - izq - der) / semanas.length;
  const bw = ancho * 0.24;

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Sellos entregados, clientes nuevos y clientes que volvieron por semana, últimas " + semanas.length + " semanas");

  function crear(tag, attrs, contenido) {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k]));
    if (contenido !== undefined) n.textContent = contenido;
    svg.appendChild(n);
    return n;
  }

  for (let i = 0; i <= 4; i++) {
    const y = arriba + altoUtil - (altoUtil * i) / 4;
    crear("line", { x1: izq, x2: W - der, y1: y, y2: y, class: "rejilla" });
    crear("text", { x: izq - 6, y: y + 4, "text-anchor": "end", class: "eje-texto" }, String(Math.round((tope * i) / 4)));
  }

  semanas.forEach((s, i) => {
    const centro = izq + ancho * i + ancho / 2;
    const pares = [
      { v: s.sellos,           x: centro - bw * 1.5 - 3, clase: "barra-sellos" },
      { v: s.nuevos,           x: centro - bw * 0.5,     clase: "barra-nuevos" },
      { v: s.volvieron || 0,   x: centro + bw * 0.5 + 3, clase: "barra-volvieron" }
    ];
    pares.forEach((p) => {
      const alto = (p.v / tope) * altoUtil;
      crear("rect", { x: p.x, y: arriba + altoUtil - alto, width: bw, height: Math.max(alto, 0), rx: 3, class: p.clase });
      if (p.v > 0) {
        crear("text", { x: p.x + bw / 2, y: arriba + altoUtil - alto - 5, "text-anchor": "middle", class: "valor-texto" }, String(p.v));
      }
    });
    crear("text", { x: centro, y: H - 12, "text-anchor": "middle", class: "eje-texto" }, diaMes(s.inicio));
  });

  const cont = el("grafico");
  cont.innerHTML = "";
  cont.appendChild(svg);
}

function renderCumples(d) {
  const mes = Number(d.hoy.slice(5, 7));
  texto("cumples-titulo", "Cumpleaños de " + MESES[mes - 1]);
  const lista = el("cumples-lista");
  lista.innerHTML = "";

  const delMes = d.clientes
    .filter((c) => c.cumpleMes === mes && c.cumpleDia > 0)
    .sort((a, b) => a.cumpleDia - b.cumpleDia);

  if (!delMes.length) {
    const li = document.createElement("li");
    li.className = "vacio";
    li.textContent = "Nadie cumple este mes con la fecha cargada.";
    lista.appendChild(li);
    return;
  }
  delMes.forEach((c) => {
    const li = document.createElement("li");
    li.textContent = c.cumpleDia + " de " + MESES[mes - 1] + ": " + c.nombre;
    lista.appendChild(li);
  });
}

/* ---------- Clientes ---------- */
function renderClientes() {
  if (!datosPanel) return;
  const q = el("buscador-clientes").value.trim().toLowerCase();
  const soloDigitos = q.replace(/\D/g, "");

  let lista = datosPanel.clientes.slice()
    .sort((a, b) => (b.ultimo || "").localeCompare(a.ultimo || ""));
  if (q) {
    lista = lista.filter((c) =>
      c.nombre.toLowerCase().includes(q) || (soloDigitos && c.telefono.includes(soloDigitos)));
  }

  const total = lista.length;
  const visibles = lista.slice(0, MAX_FILAS_TABLA);
  let cuenta = total + (total === 1 ? " cliente." : " clientes.");
  if (total > visibles.length) cuenta += " Mostrando los primeros " + visibles.length + ", usá el buscador para ver el resto.";
  texto("clientes-cuenta", cuenta);

  const cuerpo = el("clientes-filas");
  cuerpo.innerHTML = "";
  const frag = document.createDocumentFragment();
  visibles.forEach((c) => {
    const tr = document.createElement("tr");
    const celdas = [
      c.nombre,
      c.telefono.slice(3),
      c.sellos + " de " + datosPanel.meta,
      fechaCorta(c.ultimo),
      String(c.canjes)
    ];
    celdas.forEach((t) => {
      const td = document.createElement("td");
      td.textContent = t;
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  cuerpo.appendChild(frag);
}
el("buscador-clientes").addEventListener("input", renderClientes);

/* ---------- Exportar CSV ---------- */
function celdaCSV(valor) {
  let s = String(valor === undefined || valor === null ? "" : valor);
  if (/^[=+\-@]/.test(s)) s = "'" + s;           // evita fórmulas al abrirlo en Excel
  return '"' + s.replace(/"/g, '""') + '"';
}

el("btn-exportar").addEventListener("click", () => {
  if (!datosPanel) { texto("clientes-estado", "Todavía no hay datos cargados."); return; }

  const encabezado = ["Nombre", "Teléfono", "Cumpleaños", "Fecha de alta", "Sellos", "Último sello", "Visitas", "Premios canjeados"];
  const filas = datosPanel.clientes.map((c) => [
    c.nombre,
    c.telefono,
    (c.cumpleDia && c.cumpleMes) ? c.cumpleDia + "/" + c.cumpleMes : "",
    c.alta,
    c.sellos,
    c.ultimo,
    c.visitas,
    c.canjes
  ]);
  const csv = [encabezado].concat(filas)
    .map((fila) => fila.map(celdaCSV).join(","))
    .join("\r\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "clientes-" + CONFIG.nombreLocal.replace(/\s+/g, "-").toLowerCase() + "-" + datosPanel.hoy + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
});

/* ============ Inicio ============ */
(async function inicio() {
  if (!pinActual) return;
  try {
    const r = await llamar("verificar");
    if (r && r.ok) entrarAlPanel(r.rol);
    else salirDelPanel(r && r.error === "pin_incorrecto" ? "" : mensajeDe(r));
  } catch (err) {
    salirDelPanel("");
  }
})();
