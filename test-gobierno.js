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
