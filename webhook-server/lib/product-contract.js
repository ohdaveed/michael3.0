"use strict";

const contract = require("../product-contract.json");

const labelToCode = new Map(contract.products.map((p) => [p.label, p.code]));

function mapLabelToCode(label) {
  return labelToCode.get(label) || null;
}

module.exports = { mapLabelToCode };
