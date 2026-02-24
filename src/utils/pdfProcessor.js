import * as pdfjsLib from 'pdfjs-dist'

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

/**
 * Minimum average characters per page to consider a PDF as "text-based".
 * Below this threshold we treat pages as scanned images.
 */
const TEXT_THRESHOLD_PER_PAGE = 50

/**
 * Scale factor for rendering scanned pages to images.
 * 2 gives a good balance of quality vs size (~150 DPI for typical PDFs).
 */
const RENDER_SCALE = 2

/**
 * Process a PDF file and return either extracted text (for text PDFs)
 * or rendered page images (for scanned/image PDFs).
 *
 * @param {ArrayBuffer} arrayBuffer - The PDF file data
 * @param {string} fileName - Original file name
 * @returns {Promise<{ type: 'text' | 'images', text?: string, images?: Array<{data: string, page: number}>, pageCount: number }>}
 */
export async function processPdf(arrayBuffer, fileName) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pageCount = pdf.numPages

  // First pass: extract text from all pages
  const pageTexts = []
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map(item => item.str)
      .join(' ')
      .trim()
    pageTexts.push(pageText)
  }

  const totalChars = pageTexts.reduce((sum, t) => sum + t.length, 0)
  const avgCharsPerPage = totalChars / pageCount

  // If enough text content, return as text document
  if (avgCharsPerPage >= TEXT_THRESHOLD_PER_PAGE) {
    const fullText = pageTexts
      .map((text, i) => `--- Page ${i + 1} ---\n${text}`)
      .join('\n\n')
    return { type: 'text', text: fullText, pageCount }
  }

  // Otherwise render each page as an image
  const images = []
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: RENDER_SCALE })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')

    await page.render({ canvasContext: ctx, viewport }).promise

    const dataUrl = canvas.toDataURL('image/png')
    images.push({ data: dataUrl, page: i })

    // Clean up
    canvas.width = 0
    canvas.height = 0
  }

  return { type: 'images', images, pageCount }
}
