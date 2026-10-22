/* ============ DATOS DEL LOCAL: completá esto para cada restaurante ============
   Se usa en privacidad.html y terminos.html. Lo que quede entre [corchetes]
   se muestra resaltado en amarillo en la página, para que no se te pase ninguno. */
const LEGAL = {
  nombreLocal: "La Brasa",
  razonSocial: "[RAZÓN SOCIAL DEL LOCAL]",
  cuit: "[CUIT DEL LOCAL]",
  domicilio: "[DOMICILIO DEL LOCAL]",
  email: "[EMAIL DE CONTACTO DEL LOCAL]",
  proveedor: "[NOMBRE DEL PROVEEDOR DEL SISTEMA]",
  fecha: "[FECHA DE VIGENCIA, ej: 21 de octubre de 2026]",
  version: "2026-10",              // tiene que coincidir con versionTextos de script.js
  sellosMeta: "5",
  premio: "[DESCRIPCIÓN DEL PREMIO, ej: un plato principal de la carta]",
  mesesConservacion: "24",
  diasAvisoCierre: "30"
};

document.querySelectorAll("[data-campo]").forEach(function (nodo) {
  const valor = LEGAL[nodo.dataset.campo];
  if (valor === undefined) return;
  nodo.textContent = valor;
  if (/\[.*\]/.test(valor)) nodo.classList.add("completar");
});
document.title = document.title.replace("{local}", LEGAL.nombreLocal);
