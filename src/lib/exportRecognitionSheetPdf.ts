// Exports the recognition sheet as a single-page 10in x 8in (landscape 8x10)
// PDF. The page is rasterized from the same sheet DOM used for the preview
// and browser printing, so the PDF always matches what the coach arranged.

/** 300 DPI for a 10in x 8in page. */
export const RECOGNITION_PDF_PX = { width: 3000, height: 2400 } as const;
export const RECOGNITION_PDF_IN = { width: 10, height: 8 } as const;

async function waitForImages(node: HTMLElement): Promise<void> {
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : img.decode().catch(() => undefined),
    ),
  );
}

export async function exportRecognitionSheetPdf(opts: {
  node: HTMLElement;
  fileName: string;
}): Promise<void> {
  const { node, fileName } = opts;
  const [{ toCanvas }, { default: jsPDF }] = await Promise.all([
    import("html-to-image"),
    import("jspdf"),
  ]);

  await waitForImages(node);

  const width = node.offsetWidth;
  const height = node.offsetHeight;
  const options = {
    width,
    height,
    canvasWidth: RECOGNITION_PDF_PX.width,
    canvasHeight: RECOGNITION_PDF_PX.height,
    pixelRatio: 1,
    // The sheet only uses system fonts.
    skipFonts: true,
    style: { transform: "none", margin: "0" },
  };

  // Safari can drop images from the first foreignObject render.
  if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
    await toCanvas(node, options);
  }
  const canvas = await toCanvas(node, options);

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "in",
    format: [RECOGNITION_PDF_IN.height, RECOGNITION_PDF_IN.width],
    compress: true,
  });

  doc.addImage(
    canvas.toDataURL("image/jpeg", 0.92),
    "JPEG",
    0,
    0,
    RECOGNITION_PDF_IN.width,
    RECOGNITION_PDF_IN.height,
  );

  doc.save(fileName);
}
