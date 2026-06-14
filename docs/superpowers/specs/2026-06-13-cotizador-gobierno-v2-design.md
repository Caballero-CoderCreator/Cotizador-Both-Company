# Cotizador v2 — Versión Gobierno (Compras Públicas)

Fecha: 2026-06-13
Estado: Aprobado por el usuario, pendiente de plan de implementación.

## Objetivo

Agregar una **segunda versión** del cotizador para licitaciones del Estado de El Salvador, sin
modificar el flujo comercial v1 ya existente. Dentro de la misma web, un selector permite cambiar
entre la versión **Comercial (v1)** y la versión **Gobierno (v2)**. La versión gobierno genera un
PDF de 2 páginas con los datos legales del oferente, un cuadro de oferta con columnas específicas
y una declaración jurada firmada y sellada.

## Restricción central

El código de v1 **no se modifica**: el endpoint `POST /cotizar`, la función
`generarHtmlCotizacion()`, `generarPreviewHtml()`, `/actualizar` y su markup/JS en `index.html`
quedan intactos. Todo lo de gobierno se **agrega** en paralelo. En `index.html` solo se añade el
selector de versión y el bloque de formulario de gobierno; el bloque v1 se conserva tal cual,
envuelto para poder ocultarse/mostrarse.

## Datos fijos del oferente (constante `OFERENTE` en server.js)

Persona Natural (no aplica representante legal):

- Nombre completo: **JUAN RAMÓN CABALLERO MACHADO**
- Nombre comercial: **Both Company**
- Tipo de persona: **Natural**
- Fecha de nacimiento: **27/07/1975**
- Dirección: **Block 26, Senda 4, Urbanización Nuevo Lourdes, Casa #4, Colón, La Libertad**
- DUI: **06556130-4**
- NIT: **9615-270775-101-0**
- NRC: **251642-9**
- Profesión / giro: Comerciante — Venta al por mayor de otros productos
- Persona de contacto: **Juan Ramón Caballero**
- Teléfono / WhatsApp: **7585-9073**
- Correo para notificaciones: **bothcompanysv@gmail.com**

## Campos variables por cotización

Capturados en el formulario de gobierno:

- Institución destinataria (editable, **default: "Alcaldía de San Salvador Centro"**)
- Mensaje del cliente / requerimiento (para que la IA arme el borrador)
- Tipo de persona en la declaración (natural / jurídica, **default: natural**)
- Validez de la oferta
- Forma de pago
- Forma de entrega
- Lugar donde se requiere el bien
- Garantía de fabricación o funcionamiento (texto libre, opcional)
- Texto de la declaración jurada (**textarea precargado** con el texto completo de SS Centro;
  editable por si cambia la institución)

## Cuadro de oferta — columnas exactas

| ÍTEM | CANTIDAD | U/M | BIEN | DESCRIPCIÓN DEL BIEN | PRECIO UNITARIO (CON IVA INCLUIDO) | PRECIO TOTAL (CON IVA INCLUIDO) |

- Cada ítem se ingresa con **precio base** (sin IVA). El sistema calcula el precio unitario con
  IVA = `base × 1.13`, y el total de la línea = `cantidad × precioUnitConIva`.
- U/M por defecto: "Unidad".
- "BIEN" = nombre corto del bien; "DESCRIPCIÓN DEL BIEN" = descripción detallada.

## Arquitectura — server.js (solo se agrega)

### Constante `OFERENTE`
Objeto con los datos legales fijos listados arriba.

### `POST /gobierno/borrador`
- Entrada: `{ mensaje }`.
- Llama a Claude (mismo modelo Haiku, system prompt propio de gobierno) para extraer los ítems:
  `[{ item, cantidad, um, bien, descripcion, precioBase }]`.
- Devuelve el JSON de ítems para edición en la UI.
- **No genera PDF. No consume correlativo. No sincroniza con CRM.**

### `POST /gobierno/generar`
- Entrada: `{ institucion, tipoPersona, items (ya editados), validez, formaPago, formaEntrega,
  lugarEntrega, garantia, declaracion }`.
- Calcula precios con IVA y totales en el servidor (no confía en el cliente).
- Asigna correlativo de **serie separada**: `COT-GOB-001`, `COT-GOB-002`, … (contador propio,
  persistido en `counter-gobierno.json` e inicializado desde Supabase igual que el comercial).
- Genera el PDF de 2 páginas con `generarHtmlCotizacionGobierno()` + Puppeteer (misma config A4).
- Sube el PDF a Supabase Storage y registra la cotización en el CRM (reutiliza `guardarEnCRM` o
  una variante que marque el tipo "gobierno").
- Devuelve `{ numero, previewHtml, pdfBase64, pdfUrl }`.

### `generarHtmlCotizacionGobierno(d)`
Función nueva e independiente de `generarHtmlCotizacion`. Mantiene la marca blanca actual
(Fraunces + Plus Jakarta Sans, negro/dorado). Produce 2 páginas:

**Página 1:**
1. Encabezado: logo + "COTIZACIÓN" + número (`COT-GOB-###`) + fecha.
2. Bloque "Datos del Oferente" con todos los campos legales fijos.
3. Institución destinataria.
4. Cuadro de oferta con las 7 columnas exactas + fila TOTAL.
5. Bloque de condiciones: Validez, Forma de Pago, Forma de entrega, Lugar donde se requiere el
   bien, Garantía.

**Página 2** (`page-break-before`):
6. Declaración jurada completa, con "persona natural" y "JUAN RAMÓN CABALLERO MACHADO" e
   institución insertados en los lugares correspondientes.
7. Espacio de firma y sello de la empresa.
8. DUI: **06556130-4**.

## Texto de la declaración jurada (default, SS Centro)

> "Manifiesto que la persona (natural/jurídica) {OFERENTE}, cuenta con la capacidad legal para
> poder ofertar y contratar con cualquier institución del Estado, según se establece en el art. 24
> de LCP, ni se encuentra impedido para ofertar, acorde al art. 25 de LCP, ni está inhabilitado
> para participar en procesos de compras institucionales según se establece en el art. 181 de LCP;
> además declaro que "no empleo" a niños, niñas y adolescentes por debajo de la edad mínima de
> admisión al empleo, y se cumple con normativa vigente en El Salvador que prohíbe el trabajo
> infantil y de protección de la persona adolescente trabajadora" y tengo conocimiento que la
> {INSTITUCION}, está comprometida con los más altos estándares de ética y responsabilidad en
> todos nuestros procesos y relaciones comerciales. Por lo cual, la Municipalidad de San Salvador
> Centro ha implementado un Sistema de Gestión Antisoborno, de conformidad a lo establecido en el
> artículo 16, de la Ley de Compras Públicas, y en relación con la Norma ISO 37001, conforme a las
> mejores prácticas internacionales, con el objetivo de prevenir y erradicar cualquier forma de
> soborno o corrupción en nuestras operaciones, me comprometo a cumplir y hacer cumplir su Sistema
> de Gestión Antisoborno, lo cual incluye sus políticas, procedimientos y demás documentos de
> gestión, garantizando el cumplimiento de la legislación en materia de prevención de delitos y la
> gestión de riesgos de soborno, bajo el conocimiento que nuestra colaboración es crucial para
> fortalecer el compromiso conjunto en la lucha contra el soborno y la corrupción. Por lo tanto,
> ante el incumplimiento de la Política Antisoborno de la Alcaldía de San Salvador Centro o
> posibles hechos de soborno, se me aplicará el procedimiento establecido en el artículo 166
> literal "d" de la LCP, lo que dará paso al procedimiento del artículo 158 de la Ley de
> Procedimientos Administrativos para la extinción de la relación comercial."

`{OFERENTE}` → "natural, JUAN RAMÓN CABALLERO MACHADO". `{INSTITUCION}` → valor del campo
institución. El usuario puede editar el textarea completo si oferta a otra institución.

## Arquitectura — index.html (v1 intacto, solo se agrega)

- **Selector de versión** (segmented toggle "Comercial · Gobierno") en la parte superior.
- Bloque v1 existente envuelto en un contenedor que se oculta en modo Gobierno.
- **Bloque Gobierno** nuevo: institución (default SS Centro), mensaje, tipo persona, validez,
  forma de pago, forma de entrega, lugar de entrega, garantía, declaración (textarea precargado).
- Flujo gobierno:
  1. Botón **"Generar borrador"** → `POST /gobierno/borrador` → renderiza una **tabla editable**
     de ítems (item, cantidad, U/M, bien, descripción, precio base), con opción de agregar/quitar
     filas.
  2. Botón **"Generar PDF"** → `POST /gobierno/generar` con los ítems ya corregidos → descarga el
     PDF y muestra preview.
- El badge del header puede mostrar la versión activa.

## Manejo de errores

- Validar campos obligatorios en cliente y servidor (institución, al menos un ítem con cantidad y
  precio > 0).
- Si Claude no devuelve JSON válido en `/gobierno/borrador`, intentar extraer con regex; si falla,
  devolver error claro y permitir armar la tabla manualmente (fila vacía).
- El cálculo de precios/totales y el correlativo se hacen **siempre en el servidor**.

## Pruebas

- Generar un borrador desde un mensaje de ejemplo y verificar columnas/U-M.
- Verificar cálculo IVA: base 10.00 → unitario con IVA 11.30; cantidad 5 → total 56.50.
- Verificar correlativo `COT-GOB-001` independiente del comercial `COT-###`.
- Verificar el PDF: página 1 con cuadro y condiciones, página 2 con declaración + firma/sello + DUI.
- Verificar que v1 (`/cotizar`) sigue funcionando sin cambios.

## Fuera de alcance (YAGNI)

- No se construye edición posterior (`/actualizar`) para gobierno en esta primera versión.
- No se agregan múltiples plantillas de declaración; solo la de SS Centro editable.
