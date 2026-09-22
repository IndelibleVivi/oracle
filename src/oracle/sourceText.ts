import { FileValidationError } from "./errors.js";

// Preserve a valid BOM and original newlines here. The sealed-bundle layer owns
// its documented normalization; validation must see the original source bytes.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function decodeSourceText(bytes: Uint8Array, displayPath: string): string {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch (cause) {
    throw new FileValidationError(
      `Source is not valid UTF-8 text: ${displayPath}. Convert it explicitly before including it as text.`,
      { path: displayPath, code: "invalid-source-utf8" },
      cause,
    );
  }
  if (text.includes("\0")) {
    throw new FileValidationError(
      `Source contains binary NUL bytes: ${displayPath}. It cannot be included as text.`,
      { path: displayPath, code: "binary-source-text" },
    );
  }
  return text;
}
