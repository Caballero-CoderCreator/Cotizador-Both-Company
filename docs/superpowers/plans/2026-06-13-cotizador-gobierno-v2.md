# Cotizador v2 — Versión Gobierno · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una versión "Gobierno" al cotizador (selector dentro de la misma web) que genera un PDF de 2 páginas para licitaciones del Estado, sin modificar el flujo comercial v1.

**Architecture:** Se *agrega* todo en paralelo a v1. En `server.js`: constante `OFERENTE`, dos endpoints (`/gobierno/borrador`, `/gobierno/generar`), una función de cálculo pura, y `generarHtmlCotizacionGobierno()`. En `index.html`: un selector de versión que muestra/oculta el bloque v1 (intacto) o el bloque gobierno. Correlativo en serie separada `COT-GOB-###` persistido en `counter-gobierno.json` + Supabase.

**Tech Stack:** Node.js, Express, @anthropic-ai/sdk (Haiku), Puppeteer, Supabase REST. Sin framework de tests: verificación con un script Node de aserciones para funciones puras y `curl` contra el servidor en marcha.

**Referencia:** Spec en `docs/superpowers/specs/2026-06-13-cotizador-gobierno-v2-design.md`.

---

### Task 1: Constante `OFERENTE` y función pura de cálculo

**Files:**
- Modify: `server.js` (agregar tras `fechaHoy()`, ~línea 76, sin tocar nada existente)
- Test: `test-gobierno.js` (nuevo, en la raíz)

- [ ] **Step 1: Escribir el test de la función pura de cálculo**

Crear `test-gobierno.js`:

```js
const assert = require('assert');
const { calcularItemsGobierno } = require('./gobierno-calc');

// IVA: base 10.00 -> unitario con IVA 11.30; cantidad 5 -> total 56.50
const r = calcularItemsGobierno([
  { item: 1, cantidad: 5, um: 'Unidad', bien: 'Polo', descripcion: 'Polo azul', precioBase: 10 },
]);
assert.strictEqual(r.items[0].precioUnit, 11.30, 'precioUnit con IVA');
assert.strictEqual(r.items[0].total, 56.50, 'total linea con IVA');
assert.strictEqual(r.total, 56.50, 'total general');

// Redondeo a 2 decimales: base 9.99 -> 11.2887 -> 11.29
const r2 = calcularItemsGobierno([
  { item: 1, cantidad: 1, um: 'Unidad', bien: 'X', descripcion: 'Y', precioBase: 9.99 },
]);
assert.strictEqual(r2.items[0].precioUnit, 11.29, 'redondeo unitario');

console.log('OK calcularItemsGobierno');
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `node test-gobierno.js`
Expected: FAIL — `Cannot find module './gobierno-calc'`.

- [ ] **Step 3: Implementar la función pura en un módulo propio**

Crear `gobierno-calc.js`:

```js
// Cálculo de ítems de la cotización gobierno: precio base -> precio con IVA (13%).
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

function calcularItemsGobierno(itemsRaw) {
  const items = (itemsRaw || []).map((it, i) => {
    const cantidad   = Number(it.cantidad) || 0;
    const precioBase = Number(it.precioBase) || 0;
    const precioUnit = round2(precioBase * 1.13);
    const total      = round2(cantidad * precioUnit);
    return {
      item:        Number(it.item) || (i + 1),
      cantidad,
      um:          (it.um || 'Unidad').toString(),
      bien:        (it.bien || '').toString(),
      descripcion: (it.descripcion || '').toString(),
      precioBase:  round2(precioBase),
      precioUnit,
      total,
    };
  });
  const total = round2(items.reduce((s, it) => s + it.total, 0));
  return { items, total };
}

module.exports = { calcularItemsGobierno, round2 };
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `node test-gobierno.js`
Expected: `OK calcularItemsGobierno`.

- [ ] **Step 5: Agregar la constante `OFERENTE` en server.js**

En `server.js`, justo después de la función `fechaHoy()` (~línea 76) y antes de `const app = express();`, agregar:

```js
// ── Datos legales fijos del oferente (Persona Natural) — versión Gobierno ──
const { calcularItemsGobierno } = require('./gobierno-calc');

const OFERENTE = {
  nombre:        'JUAN RAMÓN CABALLERO MACHADO',
  comercial:     'Both Company',
  tipoPersona:   'natural',
  fechaNac:      '27/07/1975',
  direccion:     'Block 26, Senda 4, Urbanización Nuevo Lourdes, Casa #4, Colón, La Libertad',
  dui:           '06556130-4',
  nit:           '9615-270775-101-0',
  nrc:           '251642-9',
  giro:          'Comerciante — Venta al por mayor de otros productos',
  contacto:      'Juan Ramón Caballero',
  telefono:      '7585-9073',
  correo:        'bothcompanysv@gmail.com',
};

const DECLARACION_DEFAULT =
  'Manifiesto que la persona (natural/jurídica) {OFERENTE}, cuenta con la capacidad legal para poder ofertar y contratar con cualquier institución del Estado, según se establece en el art. 24 de LCP, ni se encuentra impedido para ofertar, acorde al art. 25 de LCP, ni está inhabilitado para participar en procesos de compras institucionales según se establece en el art. 181 de LCP; además declaro que "no empleo" a niños, niñas y adolescentes por debajo de la edad mínima de admisión al empleo, y se cumple con normativa vigente en El Salvador que prohíbe el trabajo infantil y de protección de la persona adolescente trabajadora" y tengo conocimiento que la {INSTITUCION}, está comprometida con los más altos estándares de ética y responsabilidad en todos nuestros procesos y relaciones comerciales. Por lo cual, la Municipalidad de San Salvador Centro ha implementado un Sistema de Gestión Antisoborno, de conformidad a lo establecido en el artículo 16, de la Ley de Compras Públicas, y en relación con la Norma ISO 37001, conforme a las mejores prácticas internacionales, con el objetivo de prevenir y erradicar cualquier forma de soborno o corrupción en nuestras operaciones, me comprometo a cumplir y hacer cumplir su Sistema de Gestión Antisoborno, lo cual incluye sus políticas, procedimientos y demás documentos de gestión, garantizando el cumplimiento de la legislación en materia de prevención de delitos y la gestión de riesgos de soborno, bajo el conocimiento que nuestra colaboración es crucial para fortalecer el compromiso conjunto en la lucha contra el soborno y la corrupción. Por lo tanto, ante el incumplimiento de la Política Antisoborno de la Alcaldía de San Salvador Centro o posibles hechos de soborno, se me aplicará el procedimiento establecido en el artículo 166 literal "d" de la LCP, lo que dará paso al procedimiento del artículo 158 de la Ley de Procedimientos Administrativos para la extinción de la relación comercial.';
```

- [ ] **Step 6: Verificar que server.js sigue cargando**

Run: `node -e "require('dotenv').config(); process.env.ANTHROPIC_API_KEY=process.env.ANTHROPIC_API_KEY||'x'; require('./server.js')" ` — o más simple: `node -c server.js`
Expected: sin errores de sintaxis (`node -c` no imprime nada si OK).

- [ ] **Step 7: Commit**

```bash
git add gobierno-calc.js test-gobierno.js server.js
git commit -m "feat(gobierno): constante OFERENTE y calculo de items con IVA"
```

---

### Task 2: Contador de serie separada `COT-GOB-###`

**Files:**
- Modify: `server.js` (agregar bloque de contador gobierno tras `inicializarContador`, ~línea 50)
- Create (runtime): `counter-gobierno.json`

- [ ] **Step 1: Agregar el contador gobierno en server.js**

Después de la función `inicializarContador()` (~línea 50), agregar:

```js
// ── Contador separado para cotizaciones de gobierno (COT-GOB-###) ──
const COUNTER_GOB_FILE = path.join(__dirname, 'counter-gobierno.json');
let quoteCounterGob = 0;
try {
  quoteCounterGob = JSON.parse(fs.readFileSync(COUNTER_GOB_FILE, 'utf8')).n || 0;
} catch { quoteCounterGob = 0; }

function nextQuoteNumberGob() {
  quoteCounterGob++;
  try { fs.writeFileSync(COUNTER_GOB_FILE, JSON.stringify({ n: quoteCounterGob }), 'utf8'); } catch {}
  return `COT-GOB-${String(quoteCounterGob).padStart(3, '0')}`;
}

async function inicializarContadorGob() {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return;
  try {
    const res  = await fetch(
      `${SUPA_URL}/rest/v1/cotizaciones?numero=like.COT-GOB-*&select=numero&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && data[0].numero) {
      const match = data[0].numero.match(/(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > quoteCounterGob) {
          quoteCounterGob = n;
          console.log(`[CounterGob] Retomando desde ${quoteCounterGob} (último: ${data[0].numero})`);
        }
      }
    }
  } catch (err) {
    console.error('[CounterGob] Error al sincronizar contador:', err.message);
  }
}
```

- [ ] **Step 2: Llamar a `inicializarContadorGob` en el arranque**

En el IIFE final de `server.js` (~línea 683), modificar para incluir la inicialización del contador gobierno:

```js
(async () => {
  await inicializarContador();
  await inicializarContadorGob();
  app.listen(PORT, () => {
    console.log(`✅ Both Company Cotizador corriendo en puerto ${PORT} (com: ${quoteCounter} · gob: ${quoteCounterGob})`);
  });
})();
```

- [ ] **Step 3: Ignorar el archivo de contador en git**

Verificar si existe `.gitignore`. Si existe y no incluye `counter-gobierno.json`, agregar esa línea junto a cómo se maneje `counter.json` (si `counter.json` está versionado, dejar `counter-gobierno.json` también versionado por consistencia; si está ignorado, ignorarlo igual). Replicar el tratamiento exacto de `counter.json`.

Run: `git check-ignore counter.json; echo "---"`
Expected: si imprime `counter.json`, está ignorado → ignorar también el de gobierno; si no imprime nada, está versionado → versionar el de gobierno.

- [ ] **Step 4: Verificar sintaxis**

Run: `node -c server.js`
Expected: sin salida (OK).

- [ ] **Step 5: Commit**

```bash
git add server.js .gitignore
git commit -m "feat(gobierno): contador de serie separada COT-GOB-###"
```

---

### Task 3: Función `generarHtmlCotizacionGobierno()` (PDF 2 páginas)

**Files:**
- Modify: `server.js` (agregar la función después de `generarPreviewHtml`, ~línea 585)

- [ ] **Step 1: Agregar la función generadora de HTML del PDF gobierno**

Después de `generarPreviewHtml()` (~línea 585), agregar la función completa. Reutiliza la paleta y fuentes del PDF v1 (Fraunces + Plus Jakarta Sans, negro `#14130F` + dorado `#C4923A`):

```js
function generarHtmlCotizacionGobierno(d, logoB64) {
  const fmt = v => '$' + Number(v).toFixed(2);

  const filas = d.items.map(item => `
    <tr>
      <td style="padding:9px 8px;text-align:center;border:1px solid #D8D3C8">${item.item}</td>
      <td style="padding:9px 8px;text-align:center;border:1px solid #D8D3C8">${item.cantidad}</td>
      <td style="padding:9px 8px;text-align:center;border:1px solid #D8D3C8">${item.um}</td>
      <td style="padding:9px 8px;border:1px solid #D8D3C8"><strong style="color:#14130F">${item.bien}</strong></td>
      <td style="padding:9px 8px;border:1px solid #D8D3C8">${item.descripcion}</td>
      <td style="padding:9px 8px;text-align:right;border:1px solid #D8D3C8">${fmt(item.precioUnit)}</td>
      <td style="padding:9px 8px;text-align:right;border:1px solid #D8D3C8"><strong>${fmt(item.total)}</strong></td>
    </tr>`).join('');

  const filaCampo = (label, valor) => `
    <tr>
      <td style="padding:5px 10px;font-size:11px;color:#8A857B;width:42%;vertical-align:top">${label}</td>
      <td style="padding:5px 10px;font-size:11.5px;color:#14130F;font-weight:600">${valor || '—'}</td>
    </tr>`;

  const declaracionTxt = (d.declaracion || '')
    .replace('{OFERENTE}', `${d.tipoPersona}, ${d.oferente.nombre}`)
    .replace('{INSTITUCION}', d.institucion);

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 15mm 16mm; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Plus Jakarta Sans','Segoe UI',Arial,sans-serif; color:#423E37; font-size:12px; line-height:1.5; }
  .serif { font-family:'Fraunces',Georgia,serif; }
  table { width:100%; border-collapse:collapse; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>

  <!-- ENCABEZADO -->
  <table style="margin-bottom:14px">
    <tr>
      <td style="vertical-align:top">
        <img src="${logoB64}" alt="Both Company" style="height:54px;width:auto;display:block;margin-bottom:6px" />
        <div style="font-size:10px;color:#8A857B;line-height:1.6">
          Uniformes · Bordados · Estampados — El Salvador<br>
          ${d.oferente.correo} · WhatsApp ${d.oferente.telefono} · NRC: ${d.oferente.nrc}
        </div>
      </td>
      <td style="text-align:right;vertical-align:top">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:3px;color:#8A857B;font-weight:600">Cotización</div>
        <div class="serif" style="font-size:26px;font-weight:600;color:#14130F;line-height:1.05;margin-top:2px">${d.numero}</div>
        <div style="font-size:11px;color:#8A857B;margin-top:4px">Fecha: ${d.fecha}</div>
      </td>
    </tr>
  </table>
  <div style="height:2.5px;background:#14130F;border-radius:2px"></div>
  <div style="height:2.5px;background:#C4923A;border-radius:2px;margin-top:2.5px;margin-bottom:16px;width:42%"></div>

  <!-- INSTITUCIÓN -->
  <div style="margin-bottom:14px;font-size:11.5px">
    <span style="font-size:9.5px;text-transform:uppercase;letter-spacing:1.5px;color:#A67C2E;font-weight:700">Señores</span><br>
    <strong class="serif" style="font-size:16px;color:#14130F">${d.institucion}</strong>
  </div>

  <!-- DATOS DEL OFERENTE -->
  <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:1.5px;color:#A67C2E;font-weight:700;margin-bottom:6px">Datos del Oferente</div>
  <table style="margin-bottom:16px;background:#FBFAF7;border:1px solid #ECE8E0;border-radius:8px;overflow:hidden">
    ${filaCampo('Nombre completo (Persona Natural)', d.oferente.nombre)}
    ${filaCampo('Nombre comercial', d.oferente.comercial)}
    ${filaCampo('Fecha de nacimiento', d.oferente.fechaNac)}
    ${filaCampo('Dirección', d.oferente.direccion)}
    ${filaCampo('Teléfonos', d.oferente.telefono)}
    ${filaCampo('Documento de identidad (DUI)', d.oferente.dui)}
    ${filaCampo('NIT', d.oferente.nit)}
    ${filaCampo('NRC', d.oferente.nrc)}
    ${filaCampo('Persona de contacto', d.oferente.contacto)}
    ${filaCampo('Correo para notificaciones', d.oferente.correo)}
  </table>

  <!-- CUADRO DE OFERTA -->
  <table style="margin-bottom:4px;font-size:10.5px">
    <thead>
      <tr style="background:#14130F;color:#fff">
        <th style="padding:8px 6px;border:1px solid #14130F;width:6%">ÍTEM</th>
        <th style="padding:8px 6px;border:1px solid #14130F;width:8%">CANTIDAD</th>
        <th style="padding:8px 6px;border:1px solid #14130F;width:8%">U/M</th>
        <th style="padding:8px 6px;border:1px solid #14130F;width:16%">BIEN</th>
        <th style="padding:8px 6px;border:1px solid #14130F">DESCRIPCIÓN DEL BIEN</th>
        <th style="padding:8px 6px;border:1px solid #14130F;width:14%">PRECIO UNITARIO<br>(CON IVA)</th>
        <th style="padding:8px 6px;border:1px solid #14130F;width:14%">PRECIO TOTAL<br>(CON IVA)</th>
      </tr>
    </thead>
    <tbody>
      ${filas}
      <tr style="background:#14130F;color:#fff">
        <td colspan="6" style="padding:10px;text-align:right;font-weight:600;border:1px solid #14130F">TOTAL (CON IVA INCLUIDO)</td>
        <td class="serif" style="padding:10px;text-align:right;font-weight:600;font-size:15px;color:#E6BE73;border:1px solid #14130F">${fmt(d.total)}</td>
      </tr>
    </tbody>
  </table>

  <!-- CONDICIONES -->
  <table style="margin-top:16px;font-size:11.5px;background:#FBFAF7;border:1px solid #ECE8E0;border-radius:8px;overflow:hidden">
    ${filaCampo('Validez de la oferta', d.validez)}
    ${filaCampo('Forma de pago', d.formaPago)}
    ${filaCampo('Forma de entrega', d.formaEntrega)}
    ${filaCampo('Lugar donde se requiere el bien', d.lugarEntrega)}
    ${filaCampo('Garantía de fabricación / funcionamiento', d.garantia)}
  </table>

  <!-- PÁGINA 2: DECLARACIÓN JURADA -->
  <div class="page-break"></div>
  <div style="height:2.5px;background:#14130F;border-radius:2px"></div>
  <div style="height:2.5px;background:#C4923A;border-radius:2px;margin-top:2.5px;margin-bottom:20px;width:42%"></div>

  <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:1.5px;color:#A67C2E;font-weight:700;margin-bottom:10px">Declaración Jurada</div>

  <p style="font-size:12px;color:#2A2823;line-height:1.85;text-align:justify">
    ${declaracionTxt}
  </p>

  <!-- FIRMA Y SELLO -->
  <div style="margin-top:70px">
    <table>
      <tr>
        <td style="width:55%;padding-right:24px">
          <div style="border-top:1.5px solid #14130F;padding-top:8px">
            <div style="font-size:12px;color:#14130F;font-weight:600">${d.oferente.nombre}</div>
            <div style="font-size:11px;color:#423E37;margin-top:2px">DUI: ${d.oferente.dui}</div>
            <div style="font-size:11px;color:#8A857B;margin-top:1px">Firma y sello de la empresa</div>
          </div>
        </td>
        <td style="width:45%"></td>
      </tr>
    </table>
  </div>

</body>
</html>`;
}
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node -c server.js`
Expected: sin salida (OK).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(gobierno): generarHtmlCotizacionGobierno (PDF 2 paginas)"
```

---

### Task 4: Endpoint `POST /gobierno/borrador`

**Files:**
- Modify: `server.js` (agregar el endpoint y su system prompt después de `/actualizar`, ~línea 366)

- [ ] **Step 1: Agregar el system prompt y el endpoint del borrador**

Después del endpoint `/actualizar` (cierre `});` ~línea 366), agregar:

```js
// ── SYSTEM PROMPT borrador gobierno ──
const SYSTEM_PROMPT_GOB = `Eres el asistente que arma el cuadro de oferta para licitaciones del Estado de El Salvador de Both Company (uniformes y prendas personalizadas).

A partir del mensaje/requerimiento del cliente, identifica cada bien a ofertar y devuelve un cuadro.

REGLAS:
1. Un objeto por cada bien distinto. Si hay tallas o variantes que comparten precio, agrúpalas en una sola línea y detállalas en la descripción.
2. "bien" = nombre corto del producto (ej: "Polo tipo piqué"). "descripcion" = detalle completo (color, tela, tallas, bordado, etc.).
3. "um" = unidad de medida, normalmente "Unidad". Para pares de calcetas usa "Par".
4. "precioBase" = precio unitario SIN IVA (número). NO agregues IVA, el sistema lo calcula.
5. "cantidad" = número entero.
6. Responde ÚNICAMENTE con JSON válido, sin texto adicional ni markdown.

FORMATO:
{
  "items": [
    { "item": 1, "cantidad": 25, "um": "Unidad", "bien": "Polo tipo piqué", "descripcion": "Polo azul marino con logo bordado, tallas S/M/L", "precioBase": 12.50 }
  ]
}`;

// ── POST /gobierno/borrador — la IA arma el cuadro, sin PDF ni correlativo ──
app.post('/gobierno/borrador', async (req, res) => {
  const { mensaje } = req.body;
  if (!mensaje) return res.status(400).json({ error: 'Falta el mensaje del cliente.' });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM_PROMPT_GOB, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Requerimiento del cliente:\n${mensaje}` }],
    });

    let datos;
    try {
      datos = JSON.parse(response.content[0].text);
    } catch {
      const match = response.content[0].text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('La IA no devolvió JSON válido.');
      datos = JSON.parse(match[0]);
    }

    const items = Array.isArray(datos.items) ? datos.items.map((it, i) => ({
      item:        Number(it.item) || (i + 1),
      cantidad:    Number(it.cantidad) || 0,
      um:          it.um || 'Unidad',
      bien:        it.bien || '',
      descripcion: it.descripcion || '',
      precioBase:  Number(it.precioBase) || 0,
    })) : [];

    res.json({ items });
  } catch (err) {
    console.error('Error en /gobierno/borrador:', err.message);
    res.status(500).json({ error: 'Error al generar el borrador: ' + err.message });
  }
});
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node -c server.js`
Expected: sin salida (OK).

- [ ] **Step 3: Probar el endpoint contra el servidor en marcha**

Arrancar el servidor en una terminal (`npm start`) con `ANTHROPIC_API_KEY` configurada, y en otra:

Run:
```bash
curl -s -X POST http://localhost:3000/gobierno/borrador \
  -H "Content-Type: application/json" \
  -d '{"mensaje":"Necesito 25 polos azul marino con logo bordado tallas S M L"}'
```
Expected: JSON `{ "items": [ { "item":1, "cantidad":25, "um":"Unidad", "bien":"...", "descripcion":"...", "precioBase":<n> } ] }`.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(gobierno): endpoint /gobierno/borrador (IA arma el cuadro)"
```

---

### Task 5: Endpoint `POST /gobierno/generar` (PDF + correlativo + CRM)

**Files:**
- Modify: `server.js` (agregar el endpoint después de `/gobierno/borrador`)

- [ ] **Step 1: Agregar el endpoint de generación**

Después del endpoint `/gobierno/borrador`, agregar:

```js
// ── POST /gobierno/generar — items ya editados -> PDF 2 páginas + correlativo + CRM ──
app.post('/gobierno/generar', async (req, res) => {
  const {
    institucion, tipoPersona, items, validez, formaPago,
    formaEntrega, lugarEntrega, garantia, declaracion,
  } = req.body;

  if (!institucion || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Falta la institución o los ítems.' });
  }

  try {
    const { items: itemsCalc, total } = calcularItemsGobierno(items);

    const datos = {
      numero:       nextQuoteNumberGob(),
      fecha:        fechaHoy(),
      institucion,
      tipoPersona:  tipoPersona === 'jurídica' ? 'jurídica' : 'natural',
      oferente:     OFERENTE,
      items:        itemsCalc,
      total,
      validez:      validez || '',
      formaPago:    formaPago || '',
      formaEntrega: formaEntrega || '',
      lugarEntrega: lugarEntrega || '',
      garantia:     garantia || '',
      declaracion:  declaracion || DECLARACION_DEFAULT,
    };

    const html    = generarHtmlCotizacionGobierno(datos, LOGO_B64);
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '15mm', right: '16mm', bottom: '15mm', left: '16mm' },
      printBackground: true,
    });
    await browser.close();

    res.json({
      numero:      datos.numero,
      cliente:     institucion,
      previewHtml: generarPreviewGobierno(datos),
      pdfBase64:   pdfBuffer.toString('base64'),
    });

    // Sync CRM en background — no bloquea la respuesta
    guardarGobiernoEnCRM(datos, pdfBuffer).catch(err => console.error('[CRM gob]', err.message));
  } catch (err) {
    console.error('Error en /gobierno/generar:', err.message);
    res.status(500).json({ error: 'Error al generar la cotización: ' + err.message });
  }
});
```

- [ ] **Step 2: Agregar `generarPreviewGobierno` y `guardarGobiernoEnCRM`**

Después de la función `generarHtmlCotizacionGobierno` (de Task 3), agregar el preview web:

```js
function generarPreviewGobierno(d) {
  const fmt = v => '$' + Number(v).toFixed(2);
  const filas = d.items.map(item => `
    <tr style="background:#ffffff">
      <td style="padding:8px 10px;border-bottom:1px solid #ECE8E0">
        <strong style="color:#14130F">${item.bien}</strong><br>
        <small style="color:#8A857B">${item.descripcion}</small>
      </td>
      <td style="padding:8px 10px;text-align:center;border-bottom:1px solid #ECE8E0">${item.cantidad} ${item.um}</td>
      <td style="padding:8px 10px;text-align:right;border-bottom:1px solid #ECE8E0">${fmt(item.precioUnit)}</td>
      <td style="padding:8px 10px;text-align:right;border-bottom:1px solid #ECE8E0;color:#14130F"><strong>${fmt(item.total)}</strong></td>
    </tr>`).join('');

  return `
    <div style="background:#ffffff;border-radius:10px;padding:20px 22px;color:#423E37;font-family:'Plus Jakarta Sans',sans-serif">
      <div style="border-left:3px solid #C4923A;padding-left:12px;margin-bottom:14px">
        <h3 style="font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:18px;color:#14130F;margin:0">${d.institucion}</h3>
        <p style="font-size:12px;color:#8A857B;margin:2px 0 0">${d.numero} · ${d.fecha} · Oferta de gobierno</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#14130F;color:#fff">
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.7px">Bien</th>
            <th style="padding:9px 10px;text-align:center;font-size:10px;text-transform:uppercase">Cant.</th>
            <th style="padding:9px 10px;text-align:right;font-size:10px;text-transform:uppercase">P.Unit (IVA)</th>
            <th style="padding:9px 10px;text-align:right;font-size:10px;text-transform:uppercase">Total</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding:11px 14px;background:#14130F;border-radius:8px">
        <span style="font-size:12px;color:#E6BE73;text-transform:uppercase;font-weight:600">Total con IVA</span>
        <span style="font-family:'Fraunces',Georgia,serif;font-size:19px;font-weight:600;color:#E6BE73">${fmt(d.total)}</span>
      </div>
    </div>`;
}

async function guardarGobiernoEnCRM(datos, pdfBuffer) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return;

  const h = {
    apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json', Accept: 'application/json',
  };

  // Cliente = institución
  const searchRes = await fetch(
    `${SUPA_URL}/rest/v1/clientes?nombre=eq.${encodeURIComponent(datos.institucion)}&limit=1&select=id`,
    { headers: h }
  );
  const encontrados = await searchRes.json();
  let clienteId;
  if (Array.isArray(encontrados) && encontrados.length > 0) {
    clienteId = encontrados[0].id;
  } else {
    const insertRes = await fetch(`${SUPA_URL}/rest/v1/clientes`, {
      method: 'POST', headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify({ nombre: datos.institucion }),
    });
    const [nuevo] = await insertRes.json();
    clienteId = nuevo?.id;
  }
  if (!clienteId) { console.error('[CRM gob] sin cliente_id'); return; }

  let pdfUrl = null;
  if (pdfBuffer) {
    const filename = `${datos.numero}.pdf`;
    const storageRes = await fetch(
      `${SUPA_URL}/storage/v1/object/cotizaciones-pdf/${filename}`,
      { method: 'POST', headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: pdfBuffer }
    );
    if (storageRes.ok) pdfUrl = `${SUPA_URL}/storage/v1/object/public/cotizaciones-pdf/${filename}`;
    else console.error('[CRM gob] PDF upload error:', await storageRes.text());
  }

  await fetch(`${SUPA_URL}/rest/v1/cotizaciones`, {
    method: 'POST', headers: { ...h, Prefer: 'return=minimal' },
    body: JSON.stringify({
      cliente_id: clienteId, numero: datos.numero, estado: 'borrador',
      total: datos.total, notas: `Cotización gobierno · ${datos.institucion}`,
      pdf_url: pdfUrl,
      datos: {
        tipo: 'gobierno', institucion: datos.institucion, items: datos.items,
        total: datos.total, validez: datos.validez, formaPago: datos.formaPago,
        formaEntrega: datos.formaEntrega, lugarEntrega: datos.lugarEntrega, garantia: datos.garantia,
      },
    }),
  });
  console.log(`[CRM gob] ✅ ${datos.numero} guardado (${datos.institucion})`);
}
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node -c server.js`
Expected: sin salida (OK).

- [ ] **Step 4: Probar generación de PDF contra el servidor en marcha**

Run:
```bash
curl -s -X POST http://localhost:3000/gobierno/generar \
  -H "Content-Type: application/json" \
  -d '{"institucion":"Alcaldía de San Salvador Centro","items":[{"item":1,"cantidad":5,"um":"Unidad","bien":"Polo","descripcion":"Polo azul","precioBase":10}],"validez":"30 días","formaPago":"Crédito 30 días","formaEntrega":"Entrega única","lugarEntrega":"San Salvador","garantia":"6 meses"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);require('fs').writeFileSync('test-gob.pdf',Buffer.from(j.pdfBase64,'base64'));console.log('numero:',j.numero)})"
```
Expected: imprime `numero: COT-GOB-001` y crea `test-gob.pdf`. Abrir el PDF y verificar: página 1 (datos oferente + cuadro 7 columnas, unitario $11.30, total $56.50) y página 2 (declaración + firma + DUI). Borrar `test-gob.pdf` al terminar.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(gobierno): endpoint /gobierno/generar (PDF, correlativo, CRM)"
```

---

### Task 6: Selector de versión y formulario gobierno en index.html

**Files:**
- Modify: `index.html` (envolver bloque v1, agregar selector + bloque gobierno + JS; sin alterar funciones v1)

- [ ] **Step 1: Agregar el selector de versión bajo el `<h1 class="page-title">`**

En `index.html`, justo después de `<p class="page-sub">...</p>` (~línea 564), insertar:

```html
  <!-- SELECTOR DE VERSIÓN -->
  <div class="toggles" style="margin-bottom:28px">
    <label class="toggle-chip">
      <input type="radio" name="version" value="comercial" checked onchange="cambiarVersion('comercial')" />
      <span class="dot"></span> Comercial (v1)
    </label>
    <label class="toggle-chip">
      <input type="radio" name="version" value="gobierno" onchange="cambiarVersion('gobierno')" />
      <span class="dot"></span> Gobierno (v2)
    </label>
  </div>
```

- [ ] **Step 2: Envolver el bloque v1 en un contenedor**

Envolver TODO el contenido v1 existente (desde el primer `<div class="card">` de "Datos del cliente" hasta el `<div id="resultado">` inclusive, ~líneas 570-701) en:

```html
<div id="bloque-comercial">
  ... (todo el markup v1 existente, sin cambios) ...
</div>
```

No modificar nada dentro; solo abrir el `<div id="bloque-comercial">` antes y cerrarlo después.

- [ ] **Step 3: Agregar el bloque gobierno (oculto por defecto) tras `#bloque-comercial`**

```html
<div id="bloque-gobierno" style="display:none">

  <div class="card">
    <div class="card-title">Institución y requerimiento</div>
    <div class="form-row single" style="margin-bottom:16px">
      <div>
        <label>Institución del Estado <span class="required">*</span></label>
        <input type="text" id="g_institucion" value="Alcaldía de San Salvador Centro" />
      </div>
    </div>
    <div class="form-row single">
      <div>
        <label>Requerimiento del cliente <span class="required">*</span></label>
        <textarea class="mensaje" id="g_mensaje" placeholder="Pega el requerimiento. La IA armará el cuadro y luego podrás editarlo."></textarea>
      </div>
    </div>
    <button class="btn-nueva" style="margin-top:14px;width:100%" onclick="generarBorradorGob()">Generar borrador del cuadro</button>
  </div>

  <div class="card" id="g_cuadro_card" style="display:none">
    <div class="card-title">Cuadro de oferta (editable)</div>
    <div style="overflow-x:auto">
      <table class="items-table" id="g_tabla">
        <thead>
          <tr>
            <th>Ítem</th><th>Cant.</th><th>U/M</th><th>Bien</th><th>Descripción</th><th>Precio base</th><th></th>
          </tr>
        </thead>
        <tbody id="g_tbody"></tbody>
      </table>
    </div>
    <button class="btn-nueva" style="margin-top:12px" onclick="agregarFilaGob()">+ Agregar fila</button>
  </div>

  <div class="card" id="g_cond_card" style="display:none">
    <div class="card-title">Condiciones</div>
    <div class="form-row">
      <div><label>Validez de la oferta</label><input type="text" id="g_validez" value="30 días" /></div>
      <div><label>Forma de pago</label><input type="text" id="g_formaPago" value="Crédito a 30 días" /></div>
    </div>
    <div class="form-row">
      <div><label>Forma de entrega</label><input type="text" id="g_formaEntrega" value="Entrega única" /></div>
      <div><label>Lugar donde se requiere el bien</label><input type="text" id="g_lugar" /></div>
    </div>
    <div class="form-row">
      <div><label>Garantía de fabricación / funcionamiento</label><input type="text" id="g_garantia" /></div>
      <div>
        <label>Tipo de persona (declaración)</label>
        <select id="g_tipoPersona"><option value="natural" selected>Natural</option><option value="jurídica">Jurídica</option></select>
      </div>
    </div>
    <div class="form-row single">
      <div>
        <label>Texto de la declaración jurada</label>
        <textarea id="g_declaracion" style="min-height:180px"></textarea>
        <p class="hint">Precargada para Alcaldía de San Salvador Centro. Edítala si ofertas a otra institución.</p>
      </div>
    </div>
    <button class="btn-generar" style="margin-top:14px" onclick="generarPdfGob()">Generar PDF de gobierno</button>
  </div>

  <div id="g_resultado" style="display:none;margin-top:24px">
    <div class="card">
      <div class="resultado-header">
        <div class="resultado-badge">✓ Cotización lista</div>
        <span class="resultado-num" id="g_num"></span>
      </div>
      <div class="preview-box" id="g_preview"></div>
      <div class="acciones">
        <button class="btn-pdf" onclick="descargarPdfGob()">Descargar PDF</button>
        <button class="btn-nueva" onclick="nuevaGob()">Nueva cotización</button>
      </div>
    </div>
  </div>

</div>
```

- [ ] **Step 4: Agregar el JS de gobierno antes de `</script>` (sin tocar funciones v1)**

Al final del `<script>` existente (antes de `</script>`, ~línea 896), agregar la constante con el texto y las funciones:

```js
  // ═══ VERSIÓN GOBIERNO ═══
  const DECLARACION_GOB = 'Manifiesto que la persona (natural/jurídica) {OFERENTE}, cuenta con la capacidad legal para poder ofertar y contratar con cualquier institución del Estado, según se establece en el art. 24 de LCP, ni se encuentra impedido para ofertar, acorde al art. 25 de LCP, ni está inhabilitado para participar en procesos de compras institucionales según se establece en el art. 181 de LCP; además declaro que "no empleo" a niños, niñas y adolescentes por debajo de la edad mínima de admisión al empleo, y se cumple con normativa vigente en El Salvador que prohíbe el trabajo infantil y de protección de la persona adolescente trabajadora" y tengo conocimiento que la {INSTITUCION}, está comprometida con los más altos estándares de ética y responsabilidad en todos nuestros procesos y relaciones comerciales. Por lo cual, la Municipalidad de San Salvador Centro ha implementado un Sistema de Gestión Antisoborno, de conformidad a lo establecido en el artículo 16, de la Ley de Compras Públicas, y en relación con la Norma ISO 37001, conforme a las mejores prácticas internacionales, con el objetivo de prevenir y erradicar cualquier forma de soborno o corrupción en nuestras operaciones, me comprometo a cumplir y hacer cumplir su Sistema de Gestión Antisoborno, lo cual incluye sus políticas, procedimientos y demás documentos de gestión, garantizando el cumplimiento de la legislación en materia de prevención de delitos y la gestión de riesgos de soborno, bajo el conocimiento que nuestra colaboración es crucial para fortalecer el compromiso conjunto en la lucha contra el soborno y la corrupción. Por lo tanto, ante el incumplimiento de la Política Antisoborno de la Alcaldía de San Salvador Centro o posibles hechos de soborno, se me aplicará el procedimiento establecido en el artículo 166 literal "d" de la LCP, lo que dará paso al procedimiento del artículo 158 de la Ley de Procedimientos Administrativos para la extinción de la relación comercial.';
  let gobPdfBlob = null;

  document.getElementById('g_declaracion').value = DECLARACION_GOB;

  function cambiarVersion(v) {
    document.getElementById('bloque-comercial').style.display = v === 'comercial' ? 'block' : 'none';
    document.getElementById('bloque-gobierno').style.display  = v === 'gobierno'  ? 'block' : 'none';
    document.querySelector('.header-badge').textContent = v === 'gobierno' ? 'Gobierno v2' : 'v1.0';
  }

  function filaGobHtml(it = {}) {
    return `<tr>
      <td><input type="text" value="${it.item || ''}" style="width:42px"></td>
      <td><input type="text" value="${it.cantidad || ''}" style="width:54px"></td>
      <td><input type="text" value="${it.um || 'Unidad'}" style="width:70px"></td>
      <td><input type="text" value="${(it.bien || '').replace(/"/g,'&quot;')}"></td>
      <td><input type="text" value="${(it.descripcion || '').replace(/"/g,'&quot;')}"></td>
      <td><input type="text" value="${it.precioBase || ''}" style="width:80px"></td>
      <td><button onclick="this.closest('tr').remove()" style="border:none;background:none;color:#F87171;cursor:pointer">✕</button></td>
    </tr>`;
  }

  function agregarFilaGob() {
    document.getElementById('g_tbody').insertAdjacentHTML('beforeend', filaGobHtml());
  }

  function leerItemsGob() {
    return [...document.querySelectorAll('#g_tbody tr')].map((tr, i) => {
      const c = tr.querySelectorAll('input');
      return {
        item: c[0].value || (i + 1), cantidad: c[1].value, um: c[2].value,
        bien: c[3].value, descripcion: c[4].value, precioBase: c[5].value,
      };
    });
  }

  function generarBorradorGob() {
    const mensaje = document.getElementById('g_mensaje').value.trim();
    if (!mensaje) { alert('Pega el requerimiento del cliente.'); return; }
    const btn = event.target; btn.disabled = true; btn.textContent = 'Generando borrador...';
    fetch('/gobierno/borrador', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensaje }),
    })
    .then(r => r.json())
    .then(data => {
      const tbody = document.getElementById('g_tbody');
      tbody.innerHTML = (data.items || []).map(filaGobHtml).join('') || filaGobHtml();
      document.getElementById('g_cuadro_card').style.display = 'block';
      document.getElementById('g_cond_card').style.display   = 'block';
      document.getElementById('g_cuadro_card').scrollIntoView({ behavior: 'smooth' });
    })
    .catch(() => alert('No se pudo generar el borrador.'))
    .finally(() => { btn.disabled = false; btn.textContent = 'Generar borrador del cuadro'; });
  }

  function generarPdfGob() {
    const institucion = document.getElementById('g_institucion').value.trim();
    const items = leerItemsGob();
    if (!institucion || items.length === 0) { alert('Falta institución o ítems.'); return; }
    const btn = event.target; btn.disabled = true; btn.textContent = 'Generando PDF...';
    fetch('/gobierno/generar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        institucion, tipoPersona: document.getElementById('g_tipoPersona').value,
        items,
        validez:      document.getElementById('g_validez').value,
        formaPago:    document.getElementById('g_formaPago').value,
        formaEntrega: document.getElementById('g_formaEntrega').value,
        lugarEntrega: document.getElementById('g_lugar').value,
        garantia:     document.getElementById('g_garantia').value,
        declaracion:  document.getElementById('g_declaracion').value,
      }),
    })
    .then(r => r.json())
    .then(data => {
      document.getElementById('g_num').textContent     = data.numero || '';
      document.getElementById('g_preview').innerHTML    = data.previewHtml || '';
      window._gobInst = institucion;
      if (data.pdfBase64) {
        const bytes = atob(data.pdfBase64); const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        gobPdfBlob = new Blob([arr], { type: 'application/pdf' });
      }
      document.getElementById('g_resultado').style.display = 'block';
      document.getElementById('g_resultado').scrollIntoView({ behavior: 'smooth' });
    })
    .catch(() => alert('No se pudo generar el PDF.'))
    .finally(() => { btn.disabled = false; btn.textContent = 'Generar PDF de gobierno'; });
  }

  function descargarPdfGob() {
    if (!gobPdfBlob) return;
    const url = URL.createObjectURL(gobPdfBlob);
    const a = document.createElement('a');
    const num = document.getElementById('g_num').textContent;
    a.href = url; a.download = `Cotizacion-Gobierno-${num}.pdf`; a.click();
    URL.revokeObjectURL(url);
  }

  function nuevaGob() {
    document.getElementById('g_resultado').style.display = 'none';
    document.getElementById('g_cuadro_card').style.display = 'none';
    document.getElementById('g_cond_card').style.display = 'none';
    document.getElementById('g_mensaje').value = '';
    document.getElementById('g_tbody').innerHTML = '';
    gobPdfBlob = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
```

- [ ] **Step 5: Verificar en el navegador**

Arrancar `npm start`, abrir `http://localhost:3000`. Verificar:
1. Selector visible; "Comercial (v1)" muestra el formulario original intacto y genera como antes.
2. "Gobierno (v2)" oculta v1 y muestra el bloque gobierno.
3. "Generar borrador" llena la tabla editable.
4. Editar filas + "Generar PDF de gobierno" descarga el PDF de 2 páginas correcto.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(gobierno): selector de version y formulario gobierno en index.html"
```

---

### Task 7: Verificación final y limpieza

- [ ] **Step 1: Re-correr el test de cálculo**

Run: `node test-gobierno.js`
Expected: `OK calcularItemsGobierno`.

- [ ] **Step 2: Verificar que v1 no se rompió**

Con el servidor en marcha, generar una cotización comercial normal desde la web (modo "Comercial v1") y confirmar que descarga el PDF v1 sin cambios.

- [ ] **Step 3: Confirmar archivos temporales fuera del repo**

Verificar que `test-gob.pdf` no quedó. Run: `git status` — Expected: solo cambios intencionales (`gobierno-calc.js`, `test-gobierno.js`, `server.js`, `index.html`, contador). Si `test-gobierno.js` se quiere conservar como verificación, dejarlo; si no, está versionado y es inocuo.

- [ ] **Step 4: Commit final si hay pendientes**

```bash
git add -A
git commit -m "chore(gobierno): verificacion final v2"
```

---

## Self-Review (cobertura del spec)

- Constante `OFERENTE` con datos fijos → Task 1 ✓
- Cálculo base→IVA (×1.13) → Task 1 (`calcularItemsGobierno`) ✓
- Correlativo separado `COT-GOB-###` → Task 2 ✓
- PDF 2 páginas (datos oferente, cuadro 7 columnas, condiciones, declaración, firma/sello, DUI) → Task 3 ✓
- `/gobierno/borrador` (IA arma cuadro, sin PDF ni correlativo) → Task 4 ✓
- `/gobierno/generar` (precios servidor, correlativo, PDF, CRM) → Task 5 ✓
- Preview web + sync CRM gobierno → Task 5 ✓
- Selector de versión + formulario + tabla editable + declaración editable (default SS Centro) → Task 6 ✓
- v1 intacto → envoltura sin modificar en Task 6; verificado en Task 7 ✓
- Institución editable default "Alcaldía de San Salvador Centro" → Task 6 (`value=`) ✓
- Tipo persona natural/jurídica en declaración → Task 5 (datos) + Task 3 (`replace`) + Task 6 (select) ✓

Sin placeholders. Nombres consistentes: `calcularItemsGobierno`, `generarHtmlCotizacionGobierno`,
`generarPreviewGobierno`, `guardarGobiernoEnCRM`, `nextQuoteNumberGob`, `OFERENTE`,
`DECLARACION_DEFAULT` / `DECLARACION_GOB` (cliente).
