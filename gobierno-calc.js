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
