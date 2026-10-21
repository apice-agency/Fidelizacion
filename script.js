/* ============ CONFIGURACIÓN: editá esto para cada local ============ */
const CONFIG = {
  nombreLocal: "La Brasa",
  whatsappNegocio: "5492665263564",   // con código de país, sin + ni espacios
  sellosMeta: 5,                      // el valor real lo manda el servidor; este es de respaldo
  mensajeBienvenida: "Hola! Me sumé al Club desde el QR. Quiero recibir las promos.",
  // Link del canal de WhatsApp del local (opcional). Si lo dejás vacío, el botón no aparece.
  canalUrl: "",
  // URL de la implementación de Apps Script (termina en /exec).
  // Si queda vacío, la página funciona en modo demo y no guarda nada.
  endpoint: "https://script.google.com/macros/s/AKfycbw1XMosN14jNwn2Xq5TP0IuJmMiseiFUQ3muQUK5q2ib-zBeMaimauGaUxMJMh5zDBqSQ/exec"
};

const el = (id) => document.getElementById(id);

// Código del QR del día: viene en el link que se escanea (?k=...)
const codigoQR = new URLSearchParams(location.search).get("k") || "";

/* ============ Textos dinámicos ============ */
function aplicarTextos(meta) {
  document.querySelectorAll("[data-nombre]").forEach((x) => { x.textContent = CONFIG.nombreLocal; });
  el("marca").textContent = CONFIG.nombreLocal;
  document.title = "Sumate al Club · " + CONFIG.nombreLocal;
  el("titular").textContent = "Juntá " + meta + " sellos y tu próximo plato va por la casa.";
  el("valor-detalle").textContent = "Con " + meta + " sellos. Se canjea pidiendo una bebida.";
}
aplicarTextos(CONFIG.sellosMeta);

/* ============ Selects de cumpleaños ============ */
const dia = el("dia");
const mes = el("mes");
for (let d = 1; d <= 31; d++) dia.add(new Option(d, d));
["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"]
  .forEach((m, i) => mes.add(new Option(m, i + 1)));

/* ============ Utilidades de teléfono ============ */
function limpiarTelefono(valor) {
  let n = valor.replace(/\D/g, "");
  n = n.replace(/^00/, "");
  if (n.startsWith("54")) {
    n = n.slice(2);
    n = n.replace(/^9/, "");
  }
  n = n.replace(/^0/, "");                          // 011 -> 11
  n = n.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");  // quita el 15 móvil
  return n;
}
function telefonoValido(valor) { return limpiarTelefono(valor).length === 10; }
function aE164(valor) { return "549" + limpiarTelefono(valor); }

function marcarError(inputId, errId, mensaje) {
  const input = inputId ? el(inputId) : null;
  const err = el(errId);
  if (mensaje) { if (input) input.classList.add("invalido"); err.textContent = mensaje; }
  else { if (input) input.classList.remove("invalido"); err.textContent = ""; }
}

/* ============ Estado de la sesión del cliente ============ */
let telefonoCliente = "";
let metaCliente = CONFIG.sellosMeta;
let sellosCliente = 0;
let bonoWsp = 0;
let wspActivado = false;
let activando = false;

/* ============ Modo demo (sin endpoint) ============
   Podés previsualizar cada pantalla con ?demo=nuevo | suma | ya_hoy | completa */
const demoParam = new URLSearchParams(location.search).get("demo");
const demoDB = {};
function respuestaDemo(nombre, tel) {
  const meta = CONFIG.sellosMeta;
  const extra = { wsp: false, bonoWsp: 1 };
  const forzados = {
    nuevo:    { estado: "nuevo",    sellos: 1,    sumo: true },
    suma:     { estado: "suma",     sellos: 3,    sumo: true },
    ya_hoy:   { estado: "ya_hoy",   sellos: 3,    sumo: false },
    completa: { estado: "completa", sellos: meta, sumo: true }
  };
  if (forzados[demoParam]) return Object.assign({ ok: true, nombre, meta }, extra, forzados[demoParam]);
  if (!demoDB[tel]) {
    demoDB[tel] = 1;
    return Object.assign({ ok: true, estado: "nuevo", nombre, sellos: 1, meta, sumo: true }, extra);
  }
  return Object.assign({ ok: true, estado: "ya_hoy", nombre, sellos: demoDB[tel], meta, sumo: false }, extra);
}
function respuestaDemoWsp() {
  const sellos = Math.min(metaCliente, sellosCliente + bonoWsp);
  return { ok: true, yaReclamado: false, bono: sellos - sellosCliente, sellos: sellos, meta: metaCliente,
           estado: sellos >= metaCliente ? "completa" : "suma" };
}

/* ============ Comunicación con el servidor ============ */
async function enviarAlServidor(datos) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 20000);
  try {
    const res = await fetch(CONFIG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },  // evita el preflight CORS
      body: JSON.stringify(datos),
      signal: control.signal,
      keepalive: true                                            // sigue aunque se abra WhatsApp
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ============ Envío del formulario ============ */
const form = el("form");
const botonEnviar = el("enviar");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const nombre = form.nombre.value.trim();
  const wsp = form.whatsapp.value.trim();
  let ok = true;

  if (nombre.length < 2) { marcarError("nombre", "err-nombre", "Escribí tu nombre."); ok = false; }
  else marcarError("nombre", "err-nombre", "");

  if (!telefonoValido(wsp)) {
    marcarError("whatsapp", "err-whatsapp", "Revisá el número: código de área + número, sin el 15. Ej: 11 2345 6789.");
    ok = false;
  } else marcarError("whatsapp", "err-whatsapp", "");

  if (!form.consent.checked) {
    marcarError(null, "err-general", "Para sumarte tenemos que tener tu permiso para escribirte.");
    ok = false;
  } else marcarError(null, "err-general", "");

  if (!ok) {
    const primero = form.querySelector(".invalido");
    if (primero) primero.focus();
    return;
  }

  // Campo trampa lleno = bot: no hacemos nada.
  if (form.web.value !== "") return;

  const datos = {
    nombre,
    whatsapp: aE164(wsp),
    cumple_dia: dia.value,
    cumple_mes: mes.value,
    consentimiento: true,
    origen: "qr",
    k: codigoQR
  };

  botonEnviar.disabled = true;
  botonEnviar.textContent = "Sumando…";

  try {
    const respuesta = CONFIG.endpoint
      ? await enviarAlServidor(datos)
      : respuestaDemo(nombre, datos.whatsapp);

    if (!respuesta || !respuesta.ok) throw new Error(respuesta && respuesta.error || "error");
    mostrarExito(respuesta, datos.whatsapp);
  } catch (err) {
    botonEnviar.disabled = false;
    botonEnviar.textContent = "Sumar mi sello";
    if (err && err.message === "qr_vencido") {
      marcarError(null, "err-general", "Este QR venció o no es válido. Pedile al mozo que te muestre el QR de hoy y escanealo de nuevo.");
    } else {
      marcarError(null, "err-general", "No pudimos sumar tu sello. Revisá tu conexión y probá de nuevo.");
    }
  }
});

/* ============ Confirmación y tarjeta de sellos ============ */
function textoFaltan(n) {
  return (n === 1 ? "Te falta 1 sello" : "Te faltan " + n + " sellos") + " para tu plato libre.";
}

function dibujarSellos(sellos, meta, sumo) {
  const cont = el("sellos");
  const giros = [-7, 5, -3, 8, -5, 4, -8, 6];
  const inicial = CONFIG.nombreLocal.trim().charAt(0).toUpperCase();
  cont.innerHTML = "";
  for (let i = 0; i < meta; i++) {
    const d = document.createElement("div");
    const lleno = i < sellos;
    d.className = "sello" + (lleno ? " lleno" : "") + (i === meta - 1 ? " premio" : "") +
                  (sumo && i === sellos - 1 ? " nuevo" : "");
    d.style.setProperty("--giro", giros[i % giros.length] + "deg");
    d.textContent = lleno ? inicial : (i === meta - 1 ? "★" : "");
    cont.appendChild(d);
  }
  cont.setAttribute("aria-label", sellos + " de " + meta + " sellos");
  el("sellos-cuenta").textContent = sellos + " de " + meta + " sellos";
}

function mostrarExito(r, telefono) {
  const meta = r.meta || CONFIG.sellosMeta;
  const sellos = r.sellos;
  const nombre = (r.nombre || "").split(" ")[0];
  const faltan = Math.max(meta - sellos, 0);

  telefonoCliente = telefono;
  metaCliente = meta;
  sellosCliente = sellos;
  bonoWsp = Number(r.bonoWsp) || 0;
  wspActivado = !!r.wsp;

  let titulo, texto, destacado = false;
  switch (r.estado) {
    case "nuevo":
      titulo = "¡Bienvenido, " + nombre + "!";
      texto = "Ya sos parte del Club y tu tarjeta arranca con 1 sello. " + textoFaltan(faltan);
      break;
    case "suma":
      titulo = "¡Sello sumado, " + nombre + "!";
      texto = textoFaltan(faltan);
      break;
    case "ya_hoy":
      titulo = nombre + ", hoy ya sumaste tu sello.";
      texto = textoFaltan(faltan) + " Te esperamos en tu próxima visita.";
      break;
    case "completa":
      titulo = "¡Tarjeta completa, " + nombre + "!";
      texto = "Juntaste los " + meta + " sellos. Tu plato libre está listo.";
      destacado = true;
      break;
    default:
      titulo = "¡Listo, " + nombre + "!";
      texto = "";
  }

  aplicarTextos(meta);
  el("exito-titulo").textContent = titulo;
  const t = el("exito-texto");
  t.textContent = texto;
  t.classList.toggle("destacado", destacado);

  dibujarSellos(sellos, meta, !!r.sumo);
  el("canje").classList.toggle("visible", r.estado === "completa" || sellos >= meta);

  prepararBloqueWhatsapp();
  prepararExtras();
  el("form").closest(".ticket").classList.add("confirmado");

  const h = el("exito-titulo");
  h.scrollIntoView({ behavior: "smooth", block: "start" });
  h.focus({ preventScroll: true });
}

/* ============ Incentivo de WhatsApp ============ */
function linkWsp() {
  return "https://wa.me/" + CONFIG.whatsappNegocio + "?text=" + encodeURIComponent(CONFIG.mensajeBienvenida);
}

function textoSellosExtra(n) { return n === 1 ? "1 sello extra" : n + " sellos extra"; }

function prepararBloqueWhatsapp() {
  const bloque = el("bloque-wsp");
  el("abrir-wsp").href = linkWsp();

  // Si ya lo activó en una visita anterior, no se lo pedimos de nuevo
  if (wspActivado) {
    bloque.hidden = true;
    el("abrir-wsp").hidden = false;
    return;
  }

  const ofreceBono = bonoWsp > 0 && sellosCliente < metaCliente;
  el("wsp-titulo").textContent = ofreceBono
    ? "Mandanos un mensaje y ganá " + textoSellosExtra(bonoWsp)
    : "Mandanos un mensaje y enterate primero de las promos";
  el("wsp-texto").textContent =
    "Te respondemos al instante con el link de nuestro canal para que no te pierdas ninguna novedad.";
  el("wsp-titulo").hidden = false;
  el("wsp-texto").hidden = false;
  el("wsp-hecho").hidden = true;

  const boton = el("btn-wsp");
  boton.hidden = false;
  boton.href = linkWsp();
  bloque.hidden = false;
  el("abrir-wsp").hidden = true;
}

// El link se abre solo (es un enlace común); acá avisamos al servidor para dar el sello extra.
el("btn-wsp").addEventListener("click", async () => {
  if (activando || wspActivado) return;
  activando = true;
  try {
    const r = CONFIG.endpoint
      ? await enviarAlServidor({ accion: "whatsapp", whatsapp: telefonoCliente })
      : respuestaDemoWsp();
    if (r && r.ok) mostrarWspHecho(r);
  } catch (err) {
    // WhatsApp ya se abrió. Si falló el aviso, el sello extra se puede reclamar en la próxima visita.
  } finally {
    activando = false;
  }
});

function mostrarWspHecho(r) {
  wspActivado = true;
  el("btn-wsp").hidden = true;
  el("wsp-titulo").hidden = true;
  el("wsp-texto").hidden = true;

  const hecho = el("wsp-hecho");
  if (r.bono > 0) {
    sellosCliente = r.sellos;
    dibujarSellos(r.sellos, r.meta, true);
    hecho.textContent = "¡Listo! Te sumamos " + textoSellosExtra(r.bono) + ". Ahora llevás " + r.sellos + " de " + r.meta + " sellos.";
    if (r.sellos >= r.meta) el("canje").classList.add("visible");
  } else {
    hecho.textContent = "¡Listo! Ya vas a recibir nuestras novedades.";
  }
  hecho.hidden = false;
  el("abrir-wsp").hidden = false;
}

/* ============ Extras: canal y contacto ============ */
function prepararExtras() {
  const canal = el("seguir-canal");
  if (CONFIG.canalUrl) {
    canal.href = CONFIG.canalUrl;
    canal.hidden = false;
  } else {
    canal.hidden = true;
  }
  el("ayuda-contacto").hidden = true;
}

async function guardarContacto() {
  const vcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:" + CONFIG.nombreLocal,
    "ORG:" + CONFIG.nombreLocal,
    "TEL;TYPE=CELL:+" + CONFIG.whatsappNegocio,
    "END:VCARD"
  ].join("\r\n");
  const nombreArchivo = CONFIG.nombreLocal.replace(/\s+/g, "-").toLowerCase() + ".vcf";
  const ayuda = el("ayuda-contacto");

  // 1) Menú de compartir del celular: permite elegir "Contactos" directamente
  try {
    const archivo = new File([vcf], nombreArchivo, { type: "text/vcard" });
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      ayuda.textContent = "En el menú que se abre, elegí Contactos para guardar el número de " + CONFIG.nombreLocal + ".";
      ayuda.hidden = false;
      try {
        await navigator.share({ files: [archivo], title: CONFIG.nombreLocal });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;   // el cliente cerró el menú
        // si falló por otra causa, seguimos con la descarga
      }
    }
  } catch (err) {
    // el navegador no soporta File: seguimos con la descarga
  }

  // 2) Descarga del archivo
  const url = URL.createObjectURL(new Blob([vcf], { type: "text/vcard" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  ayuda.textContent = "Se descargó el contacto. Tocá la notificación de descarga (o abrí el archivo desde Descargas) y elegí Contactos para guardarlo.";
  ayuda.hidden = false;
}
el("guardar-contacto").addEventListener("click", guardarContacto);
