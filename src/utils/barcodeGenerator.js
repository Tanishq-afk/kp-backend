import { customAlphabet } from 'nanoid';

// ----------------------------------------------------------------------------
// Barcode helpers.
//
// The backend owns the unique *code* for every physical unit; the React label
// renders the scannable image (JsBarcode) from this code. Codes are numeric and
// zero-padded so they encode cleanly as Code128 / EAN-style barcodes and remain
// human-readable on the printed label.
// ----------------------------------------------------------------------------

const CODE_PREFIX = 'KP'; // shop prefix shown on the label
const SERIAL_PAD = 8; // zero-pad serials to a fixed width

// nanoid using digits only — a short collision-guard suffix appended to codes.
const numericNano = customAlphabet('0123456789', 4);

// Builds the scannable code for a unit from its global serial number.
//   buildBarcodeValue(123) -> "KP00000123-4821"
// The serial guarantees ordering/uniqueness (counter-backed); the suffix is an
// extra guard so codes never collide even if a counter is ever reset.
export const buildBarcodeValue = (serial) => {
  const padded = String(serial).padStart(SERIAL_PAD, '0');
  return `${CODE_PREFIX}${padded}-${numericNano()}`;
};

// Sum of all per-size quantities on a product => total units / barcodes needed.
export const countUnits = (sizes = []) =>
  sizes.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);

// Expands a product's per-size quantities into one barcode document per unit.
//
//   sizes: [{ size: 'XL', quantity: 3 }, { size: 'L', quantity: 4 }]
//          -> 7 docs (3 x XL, 4 x L), each with a unique serial + code.
//
// `startSerial` is the first serial of a block reserved atomically by the
// caller (see utils/sequence.reserveSequenceBlock). This function is pure: given
// the same inputs it produces the same structure, so it is easy to unit test.
export const buildBarcodeDocs = (product, { startSerial, createdBy }) => {
  const docs = [];
  let serial = startSerial;

  for (const { size, quantity } of product.sizes) {
    for (let i = 0; i < Number(quantity); i += 1) {
      docs.push({
        code: buildBarcodeValue(serial),
        serialNumber: serial,
        product: product._id,
        // denormalized snapshots for the printed label + historical accuracy
        productName: product.name,
        articleNumber: product.articleNumber,
        category: product.category,
        mrp: product.mrp,
        size,
        createdBy,
      });
      serial += 1;
    }
  }

  return docs;
};

export default buildBarcodeDocs;
