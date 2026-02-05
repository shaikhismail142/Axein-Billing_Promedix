import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

export function registerPdfFonts(doc: PDFDocument) {
  const firstExisting = (arr: string[]) => arr.find(p => p && fs.existsSync(p)) || null;

  const regularCandidates = [
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    path.join(process.cwd(), 'public', 'fonts', 'NotoSans-Regular.ttf'),
  ];
  const boldCandidates = [
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    path.join(process.cwd(), 'public', 'fonts', 'NotoSans-Bold.ttf'),
    path.join(process.cwd(), 'public', 'fonts', 'NotoSans-SemiBold.ttf'),
  ];

  let regularFace = 'AxEin-Regular';
  let boldFace = 'AxEin-Bold';

  try {
    const reg = firstExisting(regularCandidates);
    const bold = firstExisting(boldCandidates);

    if (reg) {
      doc.registerFont(regularFace, fs.readFileSync(reg));
      doc.font(regularFace);
    } else {
      regularFace = 'Times-Roman';
      doc.font(regularFace);
    }

    if (bold) {
      doc.registerFont(boldFace, fs.readFileSync(bold));
    } else {
      boldFace = regularFace;
    }
  } catch {
    regularFace = 'Times-Roman';
    boldFace = 'Times-Bold';
    doc.font(regularFace);
  }

  return { regularFace, boldFace };
}
