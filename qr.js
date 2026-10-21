/* Generador de códigos QR sin librerías externas.
   Modo byte, corrección de errores nivel M, versiones 1 a 10 (hasta ~213 caracteres).
   Uso:  const matriz = QR.generar("https://...");   // matriz[fila][columna] = true (oscuro)
         QR.dibujar(canvas, "https://...", 320);      // dibuja en un <canvas>            */
const QR = (function () {
  "use strict";

  // Nivel M: bytes de corrección por bloque y cantidad de bloques, versiones 1..10
  const ECC_POR_BLOQUE = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const NUM_BLOQUES    = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const VERSION_MAX = 10;

  function tamano(ver) { return ver * 4 + 17; }

  function modulosDeDatos(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function codewordsDeDatos(ver) {
    return Math.floor(modulosDeDatos(ver) / 8) - ECC_POR_BLOQUE[ver - 1] * NUM_BLOQUES[ver - 1];
  }

  function posicionesAlineacion(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const paso = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const res = [6];
    for (let pos = tamano(ver) - 7; res.length < n; pos -= paso) res.splice(1, 0, pos);
    return res;
  }

  /* ---------- Reed-Solomon sobre GF(256) ---------- */
  function mulGF(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function divisorRS(grado) {
    const coef = new Array(grado).fill(0);
    coef[grado - 1] = 1;
    let raiz = 1;
    for (let i = 0; i < grado; i++) {
      for (let j = 0; j < coef.length; j++) {
        coef[j] = mulGF(coef[j], raiz);
        if (j + 1 < coef.length) coef[j] ^= coef[j + 1];
      }
      raiz = mulGF(raiz, 0x02);
    }
    return coef;
  }
  function restoRS(datos, divisor) {
    const res = new Array(divisor.length).fill(0);
    datos.forEach(function (b) {
      const factor = b ^ res.shift();
      res.push(0);
      divisor.forEach(function (c, i) { res[i] ^= mulGF(c, factor); });
    });
    return res;
  }

  /* ---------- Datos: bits, relleno, bloques ---------- */
  function bytesUTF8(texto) {
    const s = unescape(encodeURIComponent(texto));
    const out = [];
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function armarDatos(bytes, ver) {
    const bits = [];
    function poner(valor, cant) {
      for (let i = cant - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
    }
    poner(0x4, 4);                                   // modo byte
    poner(bytes.length, ver >= 10 ? 16 : 8);         // cantidad de caracteres
    bytes.forEach(function (b) { poner(b, 8); });

    const capacidad = codewordsDeDatos(ver) * 8;
    poner(0, Math.min(4, capacidad - bits.length));  // terminador
    while (bits.length % 8 !== 0) bits.push(0);

    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      cw.push(v);
    }
    for (let pad = 0xEC; cw.length < codewordsDeDatos(ver); pad ^= 0xEC ^ 0x11) cw.push(pad);
    return cw;
  }

  function agregarCorreccion(datos, ver) {
    const nBloques = NUM_BLOQUES[ver - 1];
    const eccLen = ECC_POR_BLOQUE[ver - 1];
    const total = Math.floor(modulosDeDatos(ver) / 8);
    const cortos = nBloques - (total % nBloques);
    const largoCorto = Math.floor(total / nBloques);
    const divisor = divisorRS(eccLen);

    const bloques = [];
    for (let i = 0, k = 0; i < nBloques; i++) {
      const dat = datos.slice(k, k + largoCorto - eccLen + (i < cortos ? 0 : 1));
      k += dat.length;
      const ecc = restoRS(dat, divisor);
      if (i < cortos) dat.push(0);
      bloques.push(dat.concat(ecc));
    }
    const res = [];
    for (let i = 0; i < bloques[0].length; i++) {
      bloques.forEach(function (b, j) {
        if (i !== largoCorto - eccLen || j >= cortos) res.push(b[i]);
      });
    }
    return res;
  }

  /* ---------- Matriz ---------- */
  function crear(ver) {
    const n = tamano(ver);
    const mod = [], fun = [];
    for (let y = 0; y < n; y++) { mod.push(new Array(n).fill(false)); fun.push(new Array(n).fill(false)); }
    return { ver: ver, n: n, mod: mod, fun: fun };
  }
  function ponerFun(q, x, y, oscuro) { q.mod[y][x] = oscuro; q.fun[y][x] = true; }

  function dibujarPatrones(q) {
    const n = q.n;
    for (let i = 0; i < n; i++) { ponerFun(q, 6, i, i % 2 === 0); ponerFun(q, i, 6, i % 2 === 0); }

    [[3, 3], [n - 4, 3], [3, n - 4]].forEach(function (c) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          const x = c[0] + dx, y = c[1] + dy;
          if (x >= 0 && x < n && y >= 0 && y < n) ponerFun(q, x, y, d !== 2 && d !== 4);
        }
      }
    });

    const pos = posicionesAlineacion(q.ver);
    const u = pos.length - 1;
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === u) || (i === u && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            ponerFun(q, pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }
    dibujarFormato(q, 0);
    dibujarVersion(q);
  }

  function dibujarFormato(q, mascara) {
    const n = q.n;
    const datos = (0 << 3) | mascara;                // nivel M = 0
    let resto = datos;
    for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
    const bits = ((datos << 10) | resto) ^ 0x5412;
    function b(i) { return ((bits >>> i) & 1) !== 0; }

    for (let i = 0; i <= 5; i++) ponerFun(q, 8, i, b(i));
    ponerFun(q, 8, 7, b(6));
    ponerFun(q, 8, 8, b(7));
    ponerFun(q, 7, 8, b(8));
    for (let i = 9; i < 15; i++) ponerFun(q, 14 - i, 8, b(i));

    for (let i = 0; i < 8; i++) ponerFun(q, n - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) ponerFun(q, 8, n - 15 + i, b(i));
    ponerFun(q, 8, n - 8, true);
  }

  function dibujarVersion(q) {
    if (q.ver < 7) return;
    let resto = q.ver;
    for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1F25);
    const bits = (q.ver << 12) | resto;
    for (let i = 0; i < 18; i++) {
      const oscuro = ((bits >>> i) & 1) !== 0;
      const a = q.n - 11 + (i % 3), b = Math.floor(i / 3);
      ponerFun(q, a, b, oscuro);
      ponerFun(q, b, a, oscuro);
    }
  }

  function colocarDatos(q, cw) {
    const n = q.n;
    let i = 0;
    for (let der = n - 1; der >= 1; der -= 2) {
      if (der === 6) der = 5;
      for (let v = 0; v < n; v++) {
        for (let j = 0; j < 2; j++) {
          const x = der - j;
          const arriba = ((der + 1) & 2) === 0;
          const y = arriba ? n - 1 - v : v;
          if (!q.fun[y][x] && i < cw.length * 8) {
            q.mod[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  function mascaraActiva(m, x, y) {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
  }
  function aplicarMascara(q, m) {
    for (let y = 0; y < q.n; y++) {
      for (let x = 0; x < q.n; x++) {
        if (!q.fun[y][x] && mascaraActiva(m, x, y)) q.mod[y][x] = !q.mod[y][x];
      }
    }
  }

  /* ---------- Penalización para elegir la mejor máscara ---------- */
  function penalidad(q) {
    const n = q.n, m = q.mod;
    let p = 0;

    // Regla 1: rachas de 5 o más módulos iguales (filas y columnas)
    for (let a = 0; a < n; a++) {
      [true, false].forEach(function (porFila) {
        let racha = 1;
        for (let b = 1; b < n; b++) {
          const igual = porFila ? m[a][b] === m[a][b - 1] : m[b][a] === m[b - 1][a];
          if (igual) { racha++; if (racha === 5) p += 3; else if (racha > 5) p += 1; }
          else racha = 1;
        }
      });
    }
    // Regla 2: bloques de 2x2 del mismo color
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
    }
    // Regla 3: patrones parecidos a los cuadros de las esquinas
    const patA = [1,0,1,1,1,0,1,0,0,0,0];
    const patB = [0,0,0,0,1,0,1,1,1,0,1];
    function coincide(get, pat) {
      for (let k = 0; k < 11; k++) if ((get(k) ? 1 : 0) !== pat[k]) return false;
      return true;
    }
    for (let a = 0; a < n; a++) {
      for (let b = 0; b <= n - 11; b++) {
        const fila = function (k) { return m[a][b + k]; };
        const col = function (k) { return m[b + k][a]; };
        if (coincide(fila, patA) || coincide(fila, patB)) p += 40;
        if (coincide(col, patA) || coincide(col, patB)) p += 40;
      }
    }
    // Regla 4: equilibrio entre oscuros y claros
    let oscuros = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) oscuros++;
    const pct = oscuros * 100 / (n * n);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }

  /* ---------- API pública ---------- */
  function generar(texto) {
    const bytes = bytesUTF8(String(texto));
    let ver = 1;
    for (; ver <= VERSION_MAX; ver++) {
      const bitsNecesarios = 4 + (ver >= 10 ? 16 : 8) + bytes.length * 8;
      if (bitsNecesarios <= codewordsDeDatos(ver) * 8) break;
    }
    if (ver > VERSION_MAX) throw new Error("Texto demasiado largo para el QR");

    const cw = agregarCorreccion(armarDatos(bytes, ver), ver);
    const q = crear(ver);
    dibujarPatrones(q);
    colocarDatos(q, cw);

    let mejor = 0, mejorP = Infinity;
    for (let m = 0; m < 8; m++) {
      aplicarMascara(q, m);
      dibujarFormato(q, m);
      const p = penalidad(q);
      if (p < mejorP) { mejorP = p; mejor = m; }
      aplicarMascara(q, m);                          // deshace la máscara
    }
    aplicarMascara(q, mejor);
    dibujarFormato(q, mejor);
    return q.mod;
  }

  function dibujar(canvas, texto, lado) {
    const matriz = generar(texto);
    const n = matriz.length;
    const borde = 4;                                  // zona silenciosa de 4 módulos
    const celda = Math.max(1, Math.floor(lado / (n + borde * 2)));
    const px = celda * (n + borde * 2);
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#000";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (matriz[y][x]) ctx.fillRect((x + borde) * celda, (y + borde) * celda, celda, celda);
      }
    }
  }

  return { generar: generar, dibujar: dibujar };
})();

if (typeof module !== "undefined") module.exports = QR;
