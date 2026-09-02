import pdfParse from 'pdf-parse/lib/pdf-parse.js'   // lib path: the package index runs a self-test when imported from ESM

/** Text layer of a PDF buffer ('' when the PDF is a scan with no text). */
export async function pdfText(buf) {
  try { const d = await pdfParse(buf); return { text: d.text || '', pages: d.numpages || 0 } }
  catch (e) { return { text: '', pages: 0, error: String(e.message || e) } }
}
