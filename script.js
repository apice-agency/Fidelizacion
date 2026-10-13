
/* ============ CONFIGURACIÓN: editá esto para cada local ============ */
const CONFIG = {
  nombreLocal: "La Brasa",
  whatsappNegocio: "5492665263564",   // con código de país, sin + ni espacios
  sellosMeta: 5,                      // el valor real lo manda el servidor; este es de respaldo
  mensajeBienvenida: "Hola! Me sumé al Club desde el QR. Quiero recibir las promos.",
  // URL de la implementación de Apps Script (termina en /exec).
  // Si queda vacío, la página funciona en modo demo y no guarda nada.
  endpoint: "https://script.google.com/macros/s/AKfycbw1XMosN14jNwn2Xq5TP0IuJmMiseiFUQ3muQUK5q2ib-zBeMaimauGaUxMJMh5zDBqSQ/exec"
};

/* ============ Textos dinámicos ============ */
function aplicarTextos(meta) {
  document.querySelectorAll("[data-nombre]").forEach(el => el.textContent = CONFIG.nombreLocal);
  document.getElementById("marca").textContent = CONFIG.nombreLocal;
  document.title = "Sumate al Club · " + CONFIG.nombreLocal;
  document.getElementById("titular").textContent = "Juntá " + meta + " sellos y tu próximo plato va por la casa.";
  document.getElementById("valor-detalle").textContent = "Con " + meta + " sellos. Se canjea pidiendo una bebida.";
}
aplicarTextos(CONFIG.sellosMeta);

/* ============ Selects de cumpleaños ============ */
const dia = document.getElementById("dia");
const mes = document.getElementById("mes");
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
  const input = inputId ? document.getElementById(inputId) : null;
  const err = document.getElementById(errId);
  if (mensaje) { if (input) input.classList.add("invalido"); err.textContent = mensaje; }
  else { if (input) input.classList.remove("invalido"); err.textContent = ""; }
}

/* ============ Modo demo (sin endpoint) ============
   Podés previsualizar cada pantalla con ?demo=nuevo | suma | ya_hoy | completa */
const demoParam = new URLSearchParams(location.search).get("demo");
const demoDB = {};
function respuestaDemo(nombre, tel) {
  const meta = CONFIG.sellosMeta;
  const forzados = {
    nuevo:    { estado: "nuevo",    sellos: 1,    sumo: true },
    suma:     { estado: "suma",     sellos: 3,    sumo: true },
    ya_hoy:   { estado: "ya_hoy",   sellos: 3,    sumo: false },
    completa: { estado: "completa", sellos: meta, sumo: true }
  };
  if (forzados[demoParam]) return Object.assign({ ok: true, nombre, meta }, forzados[demoParam]);
  if (!demoDB[tel]) {
    demoDB[tel] = 1;
    return { ok: true, estado: "nuevo", nombre, sellos: 1, meta, sumo: true };
  }
  return { ok: true, estado: "ya_hoy", nombre, sellos: demoDB[tel], meta, sumo: false };
}

/* ============ Envío ============ */
const form = document.getElementById("form");
const botonEnviar = document.getElementById("enviar");

async function enviarAlServidor(datos) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 20000);
  try {
    const res = await fetch(CONFIG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },  // evita el preflight CORS
      body: JSON.stringify(datos),
      signal: control.signal
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

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
    origen: "qr"
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
    marcarError(null, "err-general", "No pudimos sumar tu sello. Revisá tu conexión y probá de nuevo.");
  }
});

/* ============ Confirmación y tarjeta de sellos ============ */
function textoFaltan(n) {
  return (n === 1 ? "Te falta 1 sello" : "Te faltan " + n + " sellos") + " para tu plato libre.";
}

function dibujarSellos(sellos, meta, sumo) {
  const cont = document.getElementById("sellos");
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
  document.getElementById("sellos-cuenta").textContent = sellos + " de " + meta + " sellos";
}

function mostrarExito(r, telefono) {
  const meta = r.meta || CONFIG.sellosMeta;
  const sellos = r.sellos;
  const nombre = (r.nombre || "").split(" ")[0];
  const faltan = Math.max(meta - sellos, 0);

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
  document.getElementById("exito-titulo").textContent = titulo;
  const t = document.getElementById("exito-texto");
  t.textContent = texto;
  t.classList.toggle("destacado", destacado);

  dibujarSellos(sellos, meta, !!r.sumo);
  document.getElementById("canje").classList.toggle("visible", r.estado === "completa");

  document.getElementById("solo-wsp").href = linkWsp();
  document.querySelector(".ticket").classList.add("confirmado");

  const h = document.getElementById("exito-titulo");
  h.scrollIntoView({ behavior: "smooth", block: "start" });
  h.focus({ preventScroll: true });
}

/* ============ WhatsApp y contacto ============ */
function linkWsp() {
  return "https://wa.me/" + CONFIG.whatsappNegocio + "?text=" + encodeURIComponent(CONFIG.mensajeBienvenida);
}

function descargarContacto() {
  const vcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:" + CONFIG.nombreLocal,
    "ORG:" + CONFIG.nombreLocal,
    "TEL;TYPE=CELL:+" + CONFIG.whatsappNegocio,
    "END:VCARD"
  ].join("\r\n");
  const blob = new Blob([vcf], { type: "text/vcard" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = CONFIG.nombreLocal.replace(/\s+/g, "-").toLowerCase() + ".vcf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Un solo botón: baja el contacto y enseguida abre el chat de WhatsApp.
document.getElementById("guardar-y-abrir").addEventListener("click", () => {
  descargarContacto();
  setTimeout(() => { window.location.href = linkWsp(); }, 800);
});
