require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const puppeteer = require('puppeteer');

const LOGO_B64 = 'data:image/jpeg;base64,' +
  fs.readFileSync(path.join(__dirname, 'logo.jpeg')).toString('base64');

// ── Contador secuencial de cotizaciones ──
// Se inicializa desde Supabase al arrancar para sobrevivir reinicios en Railway
const COUNTER_FILE = path.join(__dirname, 'counter.json');
let quoteCounter = 0;
try {
  quoteCounter = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')).n || 0;
} catch { quoteCounter = 0; }

function nextQuoteNumber() {
  quoteCounter++;
  try { fs.writeFileSync(COUNTER_FILE, JSON.stringify({ n: quoteCounter }), 'utf8'); } catch {}
  return `COT-${String(quoteCounter).padStart(3, '0')}`;
}

async function inicializarContador() {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return;
  try {
    const res  = await fetch(
      `${SUPA_URL}/rest/v1/cotizaciones?select=numero&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && data[0].numero) {
      const match = data[0].numero.match(/(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > quoteCounter) {
          quoteCounter = n;
          console.log(`[Counter] Retomando desde ${quoteCounter} (último: ${data[0].numero})`);
        }
      }
    }
  } catch (err) {
    console.error('[Counter] Error al sincronizar contador:', err.message);
  }
}

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

function formatearPago(tipo, total) {
  const fmt = v => '$' + Number(v).toFixed(2);
  switch (tipo) {
    case '50/50': {
      const mitad = total / 2;
      return `50% anticipo (${fmt(mitad)}) — 50% contra entrega (${fmt(total - mitad)})`;
    }
    case '40/30/30': {
      const a = total * 0.4, b = total * 0.3;
      return `40% anticipo (${fmt(a)}) — 30% en proceso (${fmt(b)}) — 30% contra entrega (${fmt(total - a - b)})`;
    }
    case 'contado':       return 'Contado';
    case 'contraentrega': return '100% contra entrega';
    case 'credito30':     return 'Crédito a 30 días';
    case 'cheque':        return 'Cheque a nombre de Juan Ramon Caballero Machado';
    default:              return tipo;
  }
}

function fechaHoy() {
  return new Date().toLocaleDateString('es-SV', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'America/El_Salvador',
  });
}

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

const app      = express();
const PORT     = process.env.PORT || 3000;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ───────────────────────────────────────────────────────────────────
//  SYSTEM PROMPT — se cachea automáticamente (ahorra costo)
// ───────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el generador de cotizaciones de Both Company, empresa salvadoreña de uniformes y prendas personalizadas.

DATOS DE LA EMPRESA:
- Empresa: Both Company
- Contacto: Juan Ramon Caballero
- WhatsApp: 7585-9073
- Email: bothcompanysv@gmail.com
- NRC: 2516429
- Banco: Banco Cuscatlán #001-401-00-053402-6 — Juan Ramon Caballero

CATÁLOGO DE PRECIOS:
| Producto                      | T2-T10  | T12-T14 | T16-XL   | 2XL+    |
|-------------------------------|---------|---------|----------|---------|
| Polo doble piqué              | $9.00   | $10.75  | $12.50   | $14.50  |
| Polo doble piqué (premium)    | $10.50  | $12.00  | $16.00   | $18.00  |
| Camiseta deportiva Dryfit     | $6.00   | $6.50   | $7.50    | $8.00   |
| Pants deportivo               | $7.00   | $8.00   | $9.00    | $11.50  |
| Hoodie Adidas afelpado        | $16.00  | $18.00  | $20.00   | —       |
| Chumpa (tela Rodeo Sport)     | —       | —       | $28–$35  | —       |
| Camisa Oxford / Columbia      | —       | —       | $22–$28  | —       |
| Mandil Sincatex               | —       | —       | $6.50–$12| —       |
| Gabacha doble cara            | $7.50   | —       | —        | —       |
| Gabacha con elástico          | $5.50   | —       | —        | —       |
| Chaleco Mackartur             | —       | —       | $25.00   | —       |
| Filipina jefe cocina          | —       | —       | $22.00   | —       |
| Filipina auxiliar cocina      | —       | —       | $19.00   | —       |
| Bordado adicional (por pieza) | $3.50   | $3.50   | $3.50    | $3.50   |
| Calcetas infantiles/juveniles | $1.95   | $1.95   | —        | —       |
| Pantalón Sincatex / Casimir   | —       | —       | $22–$25  | —       |

REGLAS:
1. Identifica todos los productos, cantidades y tallas del mensaje del cliente.
2. Asigna precio unitario según la tabla. Si hay bordados o personalización extra incluidos en la descripción, ajusta el precio o agrega línea de bordado.
3. Calcula total por línea. Suma todos para obtener subtotal.
4. Si conIva es true: total = subtotal * 1.13, iva = subtotal * 0.13. Si es false: iva = 0, total = subtotal.
5. Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código markdown.

FORMATO JSON DE RESPUESTA:
{
  "cliente": "Nombre del cliente",
  "contacto": "Persona de contacto o vacío",
  "items": [
    {
      "descripcion": "Descripción completa del producto",
      "tallas": "Desglose de tallas si aplica, o vacío",
      "cantidad": 25,
      "precioUnit": 12.50,
      "total": 312.50
    }
  ],
  "subtotal": 312.50,
  "iva": 0,
  "total": 312.50,
  "formaPago": "50% anticipo — 50% contra entrega",
  "entrega": "30 días",
  "validez": "15 días"
}`;

// ───────────────────────────────────────────────────────────────────
//  RUTA PRINCIPAL — POST /cotizar
// ───────────────────────────────────────────────────────────────────
app.post('/cotizar', async (req, res) => {
  const { cliente, contacto, mensaje, formaPago, entrega, conIva, conBanco, validez15, conFirma } = req.body;

  if (!cliente || !mensaje) {
    return res.status(400).json({ error: 'Faltan campos obligatorios.' });
  }

  try {
    // 1 — Llamar a Claude Haiku (modelo más eficiente en costo)
    const userPrompt = [
      `Cliente: ${cliente}`,
      `Contacto: ${contacto || ''}`,
      `Mensaje del cliente: ${mensaje}`,
      `Forma de pago: ${formaPago}`,
      `Tiempo de entrega: ${entrega}`,
      `Incluir IVA (13%): ${conIva ? 'Sí' : 'No'}`,
      `Mostrar datos bancarios: ${conBanco ? 'Sí' : 'No'}`,
      `Validez de oferta: ${validez15 ? '15 días' : 'Sin especificar'}`,
      `Fecha de hoy: ${fechaHoy()}`,
    ].join('\n');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },  // cachea el prompt → menos costo
        }
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    // 2 — Parsear JSON
    let datos;
    try {
      datos = JSON.parse(response.content[0].text);
    } catch {
      const match = response.content[0].text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Claude no devolvió JSON válido.');
      datos = JSON.parse(match[0]);
    }

    // Número y fecha los controla el servidor — no Claude
    datos.numero = nextQuoteNumber();
    datos.fecha  = fechaHoy();

    // Total por línea siempre calculado aquí — Claude a veces lo omite
    datos.items = datos.items.map(item => ({
      ...item,
      total: Number(item.cantidad) * Number(item.precioUnit),
    }));
    datos.subtotal  = datos.items.reduce((s, i) => s + i.total, 0);
    datos.iva       = conIva ? datos.subtotal * 0.13 : 0;
    datos.total     = datos.subtotal + datos.iva;
    datos.formaPago = formatearPago(formaPago, datos.total);

    // 3 — Generar HTML → PDF con Puppeteer
    const html       = generarHtmlCotizacion(datos, conBanco, conFirma, LOGO_B64);
    const browser    = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '15mm', right: '20mm', bottom: '15mm', left: '20mm' },
      printBackground: true,
    });
    await browser.close();

    res.json({
      numero:      datos.numero,
      cliente:     datos.cliente,
      previewHtml: generarPreviewHtml(datos),
      pdfBase64:   pdfBuffer.toString('base64'),
    });

    // Sync to CRM in background — does not affect mobile/standalone use
    guardarEnCRM(datos, pdfBuffer, { conIva, conBanco, conFirma, formaPagoKey: formaPago }).catch(err => console.error('[CRM sync]', err.message));

  } catch (err) {
    console.error('Error al generar cotización:', err.message);
    res.status(500).json({ error: 'Error al generar la cotización: ' + err.message });
  }
});

// ───────────────────────────────────────────────────────────────────
//  RUTA EDICIÓN — POST /actualizar (no incrementa contador)
// ───────────────────────────────────────────────────────────────────
app.post('/actualizar', async (req, res) => {
  const { numero, cliente, contacto, items, formaPago, entrega, validez, conIva, conBanco, conFirma } = req.body;

  if (!numero || !cliente || !Array.isArray(items) || !formaPago) {
    return res.status(400).json({ error: 'Faltan campos obligatorios.' });
  }

  try {
    const itemsCalc = items.map(item => ({
      descripcion: item.descripcion || '',
      tallas:      item.tallas || '',
      cantidad:    Number(item.cantidad) || 0,
      precioUnit:  Number(item.precioUnit) || 0,
      total:       (Number(item.cantidad) || 0) * (Number(item.precioUnit) || 0),
    }));

    const subtotal     = itemsCalc.reduce((s, i) => s + i.total, 0);
    const ivaVal       = conIva ? subtotal * 0.13 : 0;
    const total        = subtotal + ivaVal;
    const formaPagoTxt = formatearPago(formaPago, total);

    const datos = {
      numero,
      cliente,
      contacto: contacto || '',
      items:    itemsCalc,
      subtotal,
      iva:      ivaVal,
      total,
      formaPago: formaPagoTxt,
      entrega,
      validez:  validez || '15 días',
      fecha:    fechaHoy(),
    };

    // Generar PDF con Puppeteer
    const html    = generarHtmlCotizacion(datos, conBanco, conFirma, LOGO_B64);
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '15mm', right: '20mm', bottom: '15mm', left: '20mm' },
      printBackground: true,
    });
    await browser.close();

    const SUPA_URL = process.env.SUPABASE_URL;
    const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    let pdfUrl = null;

    if (SUPA_URL && SUPA_KEY) {
      // Subir PDF al mismo path (x-upsert reemplaza el archivo existente)
      const filename   = `${numero}.pdf`;
      const storageRes = await fetch(
        `${SUPA_URL}/storage/v1/object/cotizaciones-pdf/${filename}`,
        {
          method: 'POST',
          headers: {
            apikey: SUPA_KEY,
            Authorization: `Bearer ${SUPA_KEY}`,
            'Content-Type': 'application/pdf',
            'x-upsert': 'true',
          },
          body: pdfBuffer,
        }
      );
      if (storageRes.ok) {
        pdfUrl = `${SUPA_URL}/storage/v1/object/public/cotizaciones-pdf/${filename}`;
      } else {
        console.error('[/actualizar] PDF upload error:', await storageRes.text());
      }

      // Actualizar registro en Supabase
      const patch = {
        total,
        datos: {
          cliente,
          contacto:    contacto || null,
          items:       itemsCalc,
          subtotal,
          iva:         ivaVal,
          formaPago:   formaPagoTxt,
          formaPagoKey: formaPago,
          entrega,
          validez:     validez || '15 días',
          conIva:      !!conIva,
          conBanco:    !!conBanco,
          conFirma:    !!conFirma,
        },
      };
      if (pdfUrl) patch.pdf_url = pdfUrl;

      const updateRes = await fetch(
        `${SUPA_URL}/rest/v1/cotizaciones?numero=eq.${encodeURIComponent(numero)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SUPA_KEY,
            Authorization: `Bearer ${SUPA_KEY}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(patch),
        }
      );
      if (!updateRes.ok) {
        console.error('[/actualizar] DB update error:', await updateRes.text());
      }
    }

    console.log(`[/actualizar] ✅ ${numero} actualizado`);
    res.json({ numero, pdfBase64: pdfBuffer.toString('base64'), pdfUrl });

  } catch (err) {
    console.error('Error al actualizar cotización:', err.message);
    res.status(500).json({ error: 'Error al actualizar: ' + err.message });
  }
});

// ───────────────────────────────────────────────────────────────────
//  HTML DEL PDF
// ───────────────────────────────────────────────────────────────────
function generarHtmlCotizacion(d, conBanco, conFirma, logoB64) {
  const filas = d.items.map((item, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#FBFAF7'}">
      <td style="padding:11px 13px;text-align:center;color:#8A857B;font-size:12px;border-bottom:1px solid #ECE8E0">${i + 1}</td>
      <td style="padding:11px 13px;border-bottom:1px solid #ECE8E0">
        <strong style="color:#14130F;font-weight:600">${item.descripcion}</strong>
        ${item.tallas ? `<br><small style="color:#8A857B;font-size:10.5px">${item.tallas}</small>` : ''}
      </td>
      <td style="padding:11px 13px;text-align:center;border-bottom:1px solid #ECE8E0">${item.cantidad}</td>
      <td style="padding:11px 13px;text-align:right;border-bottom:1px solid #ECE8E0">$${Number(item.precioUnit).toFixed(2)}</td>
      <td style="padding:11px 13px;text-align:right;color:#14130F;border-bottom:1px solid #ECE8E0"><strong>$${Number(item.total).toFixed(2)}</strong></td>
    </tr>`).join('');

  const filaSubtotal = d.iva > 0 ? `
    <tr>
      <td colspan="4" style="padding:6px 13px;text-align:right;color:#8A857B;font-size:12px">Subtotal</td>
      <td style="padding:6px 13px;text-align:right;font-size:12px;color:#423E37;font-weight:600">$${Number(d.subtotal).toFixed(2)}</td>
    </tr>
    <tr>
      <td colspan="4" style="padding:6px 13px;text-align:right;color:#8A857B;font-size:12px">IVA (13%)</td>
      <td style="padding:6px 13px;text-align:right;font-size:12px;color:#423E37;font-weight:600">$${Number(d.iva).toFixed(2)}</td>
    </tr>` : '';

  const banco = (nombre, cuenta) => `
        <div style="background:#ffffff;border:1px solid #ECE8E0;border-radius:8px;padding:9px 11px">
          <div style="font-weight:700;color:#14130F;margin-bottom:2px;font-size:11.5px">${nombre}</div>
          <div style="font-size:11px;color:#423E37">${cuenta}</div>
        </div>`;

  const bancoDatos = conBanco ? `
    <div style="margin-top:11px">
      <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:1.5px;color:#A67C2E;font-weight:700;margin-bottom:6px">Datos bancarios — Juan Ramón Caballero Machado</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px">
        ${banco('BAC Credomatic', 'Cta. Ahorro #122795339')}
        ${banco('Banco Cuscatlán', 'Cta. Ahorro #001-401-00-053402-6')}
        ${banco('Banco Hipotecario', 'Cta. Ahorro #01540008937')}
      </div>
    </div>` : '';

  const firmaSection = conFirma ? `
    <div style="margin-top:30px;padding-top:18px;border-top:1px solid #ECE8E0">
      <p style="font-size:11px;color:#8A857B;margin-bottom:30px;line-height:1.6">
        Al firmar esta cotización, el cliente acepta los productos, cantidades, precios y condiciones descritos arriba.
      </p>
      <table style="width:100%">
        <tr>
          <td style="width:45%;padding-right:20px">
            <div style="border-top:1.5px solid #14130F;padding-top:7px">
              <div style="font-size:11px;color:#423E37">Firma y nombre del cliente</div>
              <div style="font-size:11px;color:#8A857B;margin-top:3px">Fecha: _______________</div>
            </div>
          </td>
          <td style="width:10%"></td>
          <td style="width:45%;padding-left:20px">
            <div style="border-top:1.5px solid #14130F;padding-top:7px">
              <div style="font-size:11px;color:#423E37">Sello / DUI</div>
            </div>
          </td>
        </tr>
      </table>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 15mm 18mm; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #423E37; font-size: 13px; line-height: 1.5; }
  .serif { font-family: 'Fraunces', Georgia, serif; }
  table { width: 100%; border-collapse: collapse; }
</style>
</head>
<body>

  <!-- ENCABEZADO -->
  <table style="margin-bottom:18px">
    <tr>
      <td style="vertical-align:top">
        <img src="${logoB64}" alt="Both Company" style="height:58px;width:auto;display:block;margin-bottom:7px" />
        <div style="font-size:10.5px;color:#8A857B;line-height:1.6">
          Uniformes · Bordados · Estampados — El Salvador<br>
          bothcompanysv@gmail.com · WhatsApp 7585-9073 · NRC: 2516429
        </div>
      </td>
      <td style="text-align:right;vertical-align:top">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:3px;color:#8A857B;font-weight:600">Cotización</div>
        <div class="serif" style="font-size:30px;font-weight:600;color:#14130F;line-height:1.05;margin-top:2px">${d.numero}</div>
        <div style="font-size:11px;color:#8A857B;margin-top:4px">Fecha: ${d.fecha}</div>
      </td>
    </tr>
  </table>

  <div style="height:2.5px;background:#14130F;border-radius:2px"></div>
  <div style="height:2.5px;background:#C4923A;border-radius:2px;margin-top:2.5px;margin-bottom:20px;width:42%"></div>

  <!-- CLIENTE -->
  <table style="margin-bottom:18px;background:#FBFAF7;border:1px solid #ECE8E0;border-radius:10px;overflow:hidden">
    <tr>
      <td style="padding:13px 18px;width:50%;border-right:1px solid #ECE8E0">
        <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:1.5px;color:#A67C2E;font-weight:700;margin-bottom:5px">Cliente</div>
        <div class="serif" style="font-size:17px;font-weight:600;color:#14130F">${d.cliente}</div>
        ${d.contacto ? `<div style="font-size:12px;color:#423E37;margin-top:3px">Atención: ${d.contacto}</div>` : ''}
      </td>
      <td style="padding:13px 18px">
        <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:1.5px;color:#A67C2E;font-weight:700;margin-bottom:5px">Condiciones</div>
        <div style="font-size:12px;color:#423E37">Entrega: <strong style="color:#14130F">${d.entrega}</strong></div>
        <div style="font-size:12px;color:#423E37">Validez: <strong style="color:#14130F">${d.validez}</strong></div>
      </td>
    </tr>
  </table>

  <p style="font-size:12px;color:#423E37;margin-bottom:14px;line-height:1.65">
    Reciba un cordial saludo y nuestros mejores deseos de éxito en sus labores diarias.
    Con gusto sometemos a su amable consideración la siguiente cotización:
  </p>

  <!-- TABLA -->
  <table style="margin-bottom:4px">
    <thead>
      <tr style="background:#14130F;color:#fff">
        <th style="padding:11px 13px;text-align:center;width:5%;font-size:10px;text-transform:uppercase;letter-spacing:.8px;font-weight:600">#</th>
        <th style="padding:11px 13px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.8px;font-weight:600">Descripción</th>
        <th style="padding:11px 13px;text-align:center;width:9%;font-size:10px;text-transform:uppercase;letter-spacing:.8px;font-weight:600">Cant.</th>
        <th style="padding:11px 13px;text-align:right;width:12%;font-size:10px;text-transform:uppercase;letter-spacing:.8px;font-weight:600">P. Unit.</th>
        <th style="padding:11px 13px;text-align:right;width:14%;font-size:10px;text-transform:uppercase;letter-spacing:.8px;font-weight:600">Total</th>
      </tr>
    </thead>
    <tbody>
      ${filas}
      ${filaSubtotal}
      <tr style="background:#14130F;color:#fff">
        <td colspan="4" style="padding:13px;text-align:right;font-weight:600;font-size:13px;letter-spacing:.5px">TOTAL</td>
        <td class="serif" style="padding:13px;text-align:right;font-weight:600;font-size:20px;color:#E6BE73">$${Number(d.total).toFixed(2)}</td>
      </tr>
    </tbody>
  </table>

  <!-- PAGO -->
  <div style="margin-top:18px;padding:14px 18px;background:#FBFAF7;border:1px solid #ECE8E0;border-radius:10px;font-size:12px;color:#423E37">
    <strong style="color:#14130F">Forma de pago:</strong> ${d.formaPago}
    ${bancoDatos}
  </div>

  <!-- CIERRE -->
  <p style="margin-top:18px;font-size:12px;color:#423E37;line-height:1.65">
    Esperando que nuestra propuesta haya sido satisfactoria, quedo pendiente de sus instrucciones.
  </p>

  <div style="margin-top:16px;padding-top:13px;border-top:2px solid #C4923A">
    <div class="serif" style="font-weight:600;color:#14130F;font-size:14px">Juan Ramón Caballero</div>
    <div style="font-size:10.5px;color:#8A857B;margin-top:2px">Both Company · WhatsApp 7585-9073 · bothcompanysv@gmail.com</div>
  </div>

  ${firmaSection}

</body>
</html>`;
}

// ───────────────────────────────────────────────────────────────────
//  PREVIEW PARA LA WEB
// ───────────────────────────────────────────────────────────────────
function generarPreviewHtml(d) {
  const filas = d.items.map((item, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#FBFAF7'}">
      <td style="padding:8px 10px;border-bottom:1px solid #ECE8E0;color:#423E37">
        <strong style="color:#14130F;font-weight:600">${item.descripcion}</strong>
        ${item.tallas ? `<br><small style="color:#8A857B">${item.tallas}</small>` : ''}
      </td>
      <td style="padding:8px 10px;text-align:center;border-bottom:1px solid #ECE8E0">${item.cantidad}</td>
      <td style="padding:8px 10px;text-align:right;border-bottom:1px solid #ECE8E0">$${Number(item.precioUnit).toFixed(2)}</td>
      <td style="padding:8px 10px;text-align:right;border-bottom:1px solid #ECE8E0;color:#14130F"><strong>$${Number(item.total).toFixed(2)}</strong></td>
    </tr>`).join('');

  const ivaFila = d.iva > 0 ? `
    <tr>
      <td colspan="3" style="padding:6px 10px;text-align:right;color:#8A857B;font-size:12px">IVA (13%)</td>
      <td style="padding:6px 10px;text-align:right;font-size:12px;color:#423E37;font-weight:600">$${Number(d.iva).toFixed(2)}</td>
    </tr>` : '';

  return `
    <div style="background:#ffffff;border-radius:10px;padding:20px 22px;color:#423E37;font-family:'Plus Jakarta Sans',sans-serif">
      <div style="border-left:3px solid #C4923A;padding-left:12px;margin-bottom:14px">
        <h3 style="font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:18px;color:#14130F;margin:0">${d.cliente}</h3>
        <p style="font-size:12px;color:#8A857B;margin:2px 0 0">${d.numero} · ${d.fecha}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#14130F;color:#fff">
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.7px;font-weight:600">Descripción</th>
            <th style="padding:9px 10px;text-align:center;width:10%;font-size:10px;text-transform:uppercase;letter-spacing:.7px;font-weight:600">Cant.</th>
            <th style="padding:9px 10px;text-align:right;width:12%;font-size:10px;text-transform:uppercase;letter-spacing:.7px;font-weight:600">P.Unit.</th>
            <th style="padding:9px 10px;text-align:right;width:13%;font-size:10px;text-transform:uppercase;letter-spacing:.7px;font-weight:600">Total</th>
          </tr>
        </thead>
        <tbody>
          ${filas}
          ${ivaFila}
        </tbody>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding:11px 14px;background:#14130F;border-radius:8px">
        <span style="font-size:12px;color:#E6BE73;letter-spacing:.5px;text-transform:uppercase;font-weight:600">Total</span>
        <span style="font-family:'Fraunces',Georgia,serif;font-size:19px;font-weight:600;color:#E6BE73">$${Number(d.total).toFixed(2)}</span>
      </div>
      <div style="margin-top:8px;font-size:12px;color:#8A857B">
        Pago: ${d.formaPago} &nbsp;·&nbsp; Entrega: ${d.entrega}
      </div>
    </div>`;
}

// ───────────────────────────────────────────────────────────────────
//  SYNC AL CRM (Supabase) — fire-and-forget, no bloquea la respuesta
// ───────────────────────────────────────────────────────────────────
async function guardarEnCRM(datos, pdfBuffer, opciones = {}) {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!SUPA_URL || !SUPA_KEY) return;

  const h = {
    apikey: SUPA_KEY,
    Authorization: `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // 1 — Buscar cliente existente por nombre exacto
  const searchRes = await fetch(
    `${SUPA_URL}/rest/v1/clientes?nombre=eq.${encodeURIComponent(datos.cliente)}&limit=1&select=id`,
    { headers: h }
  );
  const encontrados = await searchRes.json();

  let clienteId;
  if (Array.isArray(encontrados) && encontrados.length > 0) {
    clienteId = encontrados[0].id;
  } else {
    // 2 — Insertar nuevo cliente
    const insertRes = await fetch(`${SUPA_URL}/rest/v1/clientes`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify({ nombre: datos.cliente }),
    });
    const [nuevoCliente] = await insertRes.json();
    clienteId = nuevoCliente?.id;
  }

  if (!clienteId) { console.error('[CRM sync] No se pudo obtener cliente_id'); return; }

  // 3 — Subir PDF a Supabase Storage
  let pdfUrl = null;
  if (pdfBuffer) {
    const filename = `${datos.numero}.pdf`;
    const storageRes = await fetch(
      `${SUPA_URL}/storage/v1/object/cotizaciones-pdf/${filename}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/pdf',
          'x-upsert': 'true',
        },
        body: pdfBuffer,
      }
    );
    if (storageRes.ok) {
      pdfUrl = `${SUPA_URL}/storage/v1/object/public/cotizaciones-pdf/${filename}`;
      console.log(`[CRM sync] 📎 PDF subido: ${filename}`);
    } else {
      const errTxt = await storageRes.text();
      console.error('[CRM sync] PDF upload error:', errTxt);
    }
  }

  // 4 — Insertar cotización con estado borrador, pdf_url y snapshot de datos para edición
  await fetch(`${SUPA_URL}/rest/v1/cotizaciones`, {
    method: 'POST',
    headers: { ...h, Prefer: 'return=minimal' },
    body: JSON.stringify({
      cliente_id: clienteId,
      numero:     datos.numero,
      estado:     'borrador',
      total:      datos.total,
      notas:      `Cotización web · Entrega: ${datos.entrega}`,
      pdf_url:    pdfUrl,
      datos: {
        cliente:     datos.cliente,
        contacto:    datos.contacto || null,
        items:       datos.items,
        subtotal:    datos.subtotal,
        iva:         datos.iva,
        formaPago:   datos.formaPago,
        formaPagoKey: opciones.formaPagoKey || '',
        entrega:     datos.entrega,
        validez:     datos.validez,
        conIva:      opciones.conIva || false,
        conBanco:    opciones.conBanco || false,
        conFirma:    opciones.conFirma || false,
      },
    }),
  });

  console.log(`[CRM sync] ✅ ${datos.numero} guardado para cliente "${datos.cliente}"`);
}

// ───────────────────────────────────────────────────────────────────
(async () => {
  await inicializarContador();
  await inicializarContadorGob();
  app.listen(PORT, () => {
    console.log(`✅ Both Company Cotizador corriendo en puerto ${PORT} (com: ${quoteCounter} · gob: ${quoteCounterGob})`);
  });
})();

