require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const puppeteer = require('puppeteer');

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
5. El número de cotización sigue el formato COT-YYYYMMDD-XXX donde XXX son las 3 primeras letras del cliente en mayúsculas.
6. Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código markdown.

FORMATO JSON DE RESPUESTA:
{
  "numero": "COT-20260509-PRO",
  "cliente": "Nombre del cliente",
  "contacto": "Persona de contacto o vacío",
  "fecha": "09/05/2026",
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
      `Fecha de hoy: ${new Date().toLocaleDateString('es-SV', { day:'2-digit', month:'2-digit', year:'numeric' })}`,
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

    // 3 — Generar HTML → PDF con Puppeteer
    const html       = generarHtmlCotizacion(datos, conBanco, conFirma);
    const browser    = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '15mm', right: '20mm', bottom: '15mm', left: '20mm' },
      printBackground: true,
    });
    await browser.close();

    res.json({
      numero:      datos.numero,
      previewHtml: generarPreviewHtml(datos),
      pdfBase64:   pdfBuffer.toString('base64'),
    });

  } catch (err) {
    console.error('Error al generar cotización:', err.message);
    res.status(500).json({ error: 'Error al generar la cotización: ' + err.message });
  }
});

// ───────────────────────────────────────────────────────────────────
//  HTML DEL PDF
// ───────────────────────────────────────────────────────────────────
function generarHtmlCotizacion(d, conBanco, conFirma) {
  const filas = d.items.map((item, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8fafc'}">
      <td style="padding:10px 12px;text-align:center;color:#64748b">${i + 1}</td>
      <td style="padding:10px 12px">
        <strong>${item.descripcion}</strong>
        ${item.tallas ? `<br><small style="color:#64748b;font-size:11px">${item.tallas}</small>` : ''}
      </td>
      <td style="padding:10px 12px;text-align:center">${item.cantidad}</td>
      <td style="padding:10px 12px;text-align:right">$${Number(item.precioUnit).toFixed(2)}</td>
      <td style="padding:10px 12px;text-align:right"><strong>$${Number(item.total).toFixed(2)}</strong></td>
    </tr>`).join('');

  const filaSubtotal = d.iva > 0 ? `
    <tr>
      <td colspan="4" style="padding:7px 12px;text-align:right;color:#64748b;font-size:13px">Subtotal</td>
      <td style="padding:7px 12px;text-align:right;font-size:13px">$${Number(d.subtotal).toFixed(2)}</td>
    </tr>
    <tr>
      <td colspan="4" style="padding:7px 12px;text-align:right;color:#64748b;font-size:13px">IVA (13%)</td>
      <td style="padding:7px 12px;text-align:right;font-size:13px">$${Number(d.iva).toFixed(2)}</td>
    </tr>` : '';

  const bancoDatos = conBanco ? `
    <p style="margin-top:8px;font-size:12px;color:#475569">
      <strong style="color:#1e293b">Depósito:</strong>
      Banco Cuscatlán · Cta. Ahorro #001-401-00-053402-6 · A nombre de: Juan Ramon Caballero
    </p>` : '';

  const firmaSection = conFirma ? `
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0">
      <p style="font-size:12px;color:#64748b;margin-bottom:28px">
        Al firmar esta cotización, el cliente acepta los productos, cantidades, precios y condiciones descritos arriba.
      </p>
      <table style="width:100%">
        <tr>
          <td style="width:45%;padding-right:20px">
            <div style="border-top:1.5px solid #1a2e4a;padding-top:6px">
              <div style="font-size:12px;color:#64748b">Firma y nombre del cliente</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px">Fecha: _______________</div>
            </div>
          </td>
          <td style="width:10%"></td>
          <td style="width:45%;padding-left:20px">
            <div style="border-top:1.5px solid #1a2e4a;padding-top:6px">
              <div style="font-size:12px;color:#64748b">Sello / DUI</div>
            </div>
          </td>
        </tr>
      </table>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  @page { size: A4; margin: 15mm 20mm; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; font-size: 13px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; }
</style>
</head>
<body>

  <!-- ENCABEZADO -->
  <table style="margin-bottom:20px">
    <tr>
      <td>
        <div style="font-size:26px;font-weight:900;color:#1a2e4a;letter-spacing:-0.5px">BOTH COMPANY</div>
        <div style="width:32px;height:5px;background:#f0b429;border-radius:3px;margin:4px 0 6px"></div>
        <div style="font-size:11px;color:#64748b">Uniformes · Bordados · Estampados · El Salvador</div>
        <div style="font-size:11px;color:#64748b">bothcompanysv@gmail.com · WhatsApp 7585-9073</div>
        <div style="font-size:11px;color:#64748b">NRC: 2516429</div>
      </td>
      <td style="text-align:right;vertical-align:top">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8">Cotización</div>
        <div style="font-size:20px;font-weight:900;color:#1a2e4a">${d.numero}</div>
        <div style="font-size:11px;color:#64748b">Fecha: ${d.fecha}</div>
      </td>
    </tr>
  </table>

  <div style="height:3px;background:#1a2e4a;margin-bottom:2px"></div>
  <div style="height:3px;background:#f0b429;margin-bottom:18px"></div>

  <!-- CLIENTE -->
  <table style="margin-bottom:16px;background:#f5f7fa;border-radius:6px">
    <tr>
      <td style="padding:12px 16px;width:50%;border-right:1px solid #e2e8f0">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:3px">Cliente</div>
        <div style="font-size:15px;font-weight:700">${d.cliente}</div>
        ${d.contacto ? `<div style="font-size:12px;color:#64748b">Atención: ${d.contacto}</div>` : ''}
      </td>
      <td style="padding:12px 16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:3px">Condiciones</div>
        <div style="font-size:12px">Entrega: <strong>${d.entrega}</strong></div>
        <div style="font-size:12px">Validez: <strong>${d.validez}</strong></div>
      </td>
    </tr>
  </table>

  <p style="font-size:12px;color:#475569;margin-bottom:14px;line-height:1.6">
    Reciba un cordial saludo y nuestros mejores deseos de éxito en sus labores diarias.
    Con gusto sometemos a su amable consideración la siguiente cotización:
  </p>

  <!-- TABLA -->
  <table style="margin-bottom:4px">
    <thead>
      <tr style="background:#1a2e4a;color:#fff">
        <th style="padding:9px 12px;text-align:center;width:5%">#</th>
        <th style="padding:9px 12px;text-align:left">Descripción</th>
        <th style="padding:9px 12px;text-align:center;width:9%">Cant.</th>
        <th style="padding:9px 12px;text-align:right;width:12%">P. Unit.</th>
        <th style="padding:9px 12px;text-align:right;width:13%">Total</th>
      </tr>
    </thead>
    <tbody>
      ${filas}
      ${filaSubtotal}
      <tr style="background:#1a2e4a;color:#fff">
        <td colspan="4" style="padding:10px 12px;text-align:right;font-weight:700;font-size:14px">TOTAL</td>
        <td style="padding:10px 12px;text-align:right;font-weight:900;font-size:15px">$${Number(d.total).toFixed(2)}</td>
      </tr>
    </tbody>
  </table>

  <!-- PAGO -->
  <div style="margin-top:16px;padding:12px 16px;background:#f5f7fa;border-radius:6px;font-size:12px">
    <strong>Forma de pago:</strong> ${d.formaPago}
    ${bancoDatos}
  </div>

  <!-- CIERRE -->
  <p style="margin-top:18px;font-size:12px;color:#475569;line-height:1.6">
    Esperando que nuestra propuesta haya sido satisfactoria, quedo pendiente de sus instrucciones.
  </p>

  <div style="margin-top:16px;padding-top:12px;border-top:2px solid #f0b429">
    <div style="font-weight:700;color:#1a2e4a;font-size:13px">Juan Ramon Caballero</div>
    <div style="font-size:11px;color:#64748b">Both Company · WhatsApp 7585-9073 · bothcompanysv@gmail.com</div>
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
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
      <td style="padding:8px 10px">
        ${item.descripcion}
        ${item.tallas ? `<br><small style="color:#94a3b8">${item.tallas}</small>` : ''}
      </td>
      <td style="padding:8px 10px;text-align:center">${item.cantidad}</td>
      <td style="padding:8px 10px;text-align:right">$${Number(item.precioUnit).toFixed(2)}</td>
      <td style="padding:8px 10px;text-align:right"><strong>$${Number(item.total).toFixed(2)}</strong></td>
    </tr>`).join('');

  const ivaFila = d.iva > 0 ? `
    <tr>
      <td colspan="3" style="padding:6px 10px;text-align:right;color:#64748b;font-size:12px">IVA (13%)</td>
      <td style="padding:6px 10px;text-align:right;font-size:12px">$${Number(d.iva).toFixed(2)}</td>
    </tr>` : '';

  return `
    <h3 style="margin-bottom:4px;color:#1a2e4a">${d.cliente}</h3>
    <p style="font-size:12px;color:#64748b;margin-bottom:12px">${d.numero} · ${d.fecha}</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#1a2e4a;color:#fff">
          <th style="padding:8px 10px;text-align:left">Descripción</th>
          <th style="padding:8px 10px;text-align:center;width:10%">Cant.</th>
          <th style="padding:8px 10px;text-align:right;width:12%">P.Unit.</th>
          <th style="padding:8px 10px;text-align:right;width:13%">Total</th>
        </tr>
      </thead>
      <tbody>
        ${filas}
        ${ivaFila}
      </tbody>
    </table>
    <div style="text-align:right;margin-top:10px;font-size:16px;font-weight:800;color:#1a2e4a">
      TOTAL: $${Number(d.total).toFixed(2)}
    </div>
    <div style="margin-top:6px;font-size:12px;color:#64748b">
      Pago: ${d.formaPago} &nbsp;·&nbsp; Entrega: ${d.entrega}
    </div>`;
}

// ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Both Company Cotizador corriendo en puerto ${PORT}`);
});
