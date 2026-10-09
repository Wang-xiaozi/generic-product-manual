import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  LineRuleType,
  Packer,
  PageOrientation,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  convertMillimetersToTwip,
} from 'docx'

const BODY_FONT = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: 'SimSun' }
const TITLE_FONT = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'SimHei' }
const BODY_WIDTH = convertMillimetersToTwip(190)
const THIN_BORDER = { color: '111111', size: 4, style: BorderStyle.SINGLE }
const LIGHT_BORDER = { color: 'B7B7B7', size: 4, style: BorderStyle.SINGLE }
const NO_BORDER = { color: 'FFFFFF', size: 0, style: BorderStyle.NIL }
const TABLE_BORDERS = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
  insideHorizontal: THIN_BORDER,
  insideVertical: THIN_BORDER,
}
const NO_TABLE_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
}

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim()
}

function elementText(element) {
  return cleanText(element?.innerText ?? element?.textContent ?? '')
}

function textRuns(text, options = {}) {
  const lines = cleanText(text).split('\n')
  if (!lines.length) return [new TextRun({ text: '', ...options })]
  return lines.map(
    (line, index) => new TextRun({ text: line, break: index === 0 ? undefined : 1, ...options }),
  )
}

function textParagraph(text, options = {}) {
  const {
    alignment = AlignmentType.LEFT,
    after = 70,
    before = 0,
    bold = false,
    color = '000000',
    font = BODY_FONT,
    indent,
    keepNext = false,
    line = 276,
    size = 21,
    ...paragraphOptions
  } = options
  return new Paragraph({
    alignment,
    children: textRuns(text, { bold, color, font, size }),
    indent,
    keepNext,
    spacing: { after, before, line, lineRule: LineRuleType.AUTO },
    ...paragraphOptions,
  })
}

function headingParagraph(element) {
  const runs = []
  Array.from(element?.childNodes || []).forEach((node) => {
    const isCondition = node.nodeType === Node.ELEMENT_NODE && node.classList.contains('condition')
    const text = cleanText(node.textContent)
    if (!text) return
    runs.push(
      new TextRun({
        bold: !isCondition,
        font: isCondition ? BODY_FONT : TITLE_FONT,
        size: 24,
        text: runs.length && !/^\s/.test(node.textContent || '') ? ` ${text}` : text,
      }),
    )
  })
  if (!runs.length) runs.push(new TextRun({ bold: true, font: TITLE_FONT, size: 24, text: '' }))
  return new Paragraph({
    children: runs,
    keepNext: true,
    spacing: { after: 80, before: 130, line: 300, lineRule: LineRuleType.AUTO },
  })
}

function imageTypeFrom(contentType, source) {
  const type = String(contentType || '').toLowerCase()
  const path = String(source || '')
    .split(/[?#]/, 1)[0]
    .toLowerCase()
  if (type.includes('png') || path.endsWith('.png')) return 'png'
  if (
    type.includes('jpeg') ||
    type.includes('jpg') ||
    path.endsWith('.jpeg') ||
    path.endsWith('.jpg')
  ) {
    return 'jpg'
  }
  if (type.includes('gif') || path.endsWith('.gif')) return 'gif'
  if (type.includes('bmp') || path.endsWith('.bmp')) return 'bmp'
  return null
}

async function rasterizeImage(image) {
  if (!image.complete && image.decode) await image.decode()
  const width = Math.max(
    1,
    image.naturalWidth || Math.round(image.getBoundingClientRect().width) || 1,
  )
  const height = Math.max(
    1,
    image.naturalHeight || Math.round(image.getBoundingClientRect().height) || 1,
  )
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('图片转换失败'))),
      'image/png',
    )
  })
  return { data: new Uint8Array(await blob.arrayBuffer()), type: 'png' }
}

function svgRasterSize(svg) {
  const bounds = svg.getBoundingClientRect()
  const viewBox = svg.viewBox?.baseVal
  const sourceX = viewBox?.x || 0
  const sourceY = viewBox?.y || 0
  const sourceWidth = viewBox?.width || bounds.width || 1200
  const sourceHeight = viewBox?.height || bounds.height || 800
  const renderedWidth = bounds.width || sourceWidth
  const renderedHeight = bounds.height || sourceHeight
  let width = Math.max(1, Math.round(renderedWidth * 2))
  let height = Math.max(1, Math.round(renderedHeight * 2))
  const maximumDimension = 2400
  const scale = Math.min(1, maximumDimension / Math.max(width, height))
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))
  return { height, sourceHeight, sourceWidth, sourceX, sourceY, width }
}

async function rasterizeSvg(svg) {
  if (document.fonts?.ready) await document.fonts.ready
  const { height, sourceHeight, sourceWidth, sourceX, sourceY, width } = svgRasterSize(svg)
  const clone = svg.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `${sourceX} ${sourceY} ${sourceWidth} ${sourceHeight}`)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.querySelectorAll('.scene-element-selected').forEach((element) => {
    element.classList.remove('scene-element-selected')
  })
  clone.querySelectorAll('rect[fill="transparent"]').forEach((element) => {
    element.setAttribute('stroke', 'transparent')
  })

  const source = new XMLSerializer().serializeToString(clone)
  const sourceBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
  const sourceUrl = URL.createObjectURL(sourceBlob)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true })
      image.addEventListener('error', () => reject(new Error('SVG 场景转换失败')), { once: true })
      image.src = sourceUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('SVG 场景转换失败'))),
        'image/png',
      )
    })
    return { data: new Uint8Array(await blob.arrayBuffer()), type: 'png' }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function displayedImageSize(image, maxWidth, maxHeight) {
  const bounds = image.getBoundingClientRect()
  let width = bounds.width || image.naturalWidth || maxWidth
  let height = bounds.height || image.naturalHeight || maxHeight
  if (!width || !height) return { width: Math.round(maxWidth), height: Math.round(maxHeight * 0.6) }
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))
  return { width, height }
}

function createImageLoader() {
  const cache = new Map()
  return async function loadImage(image) {
    const source = image.currentSrc || image.src
    if (!source) throw new Error('图片缺少地址')
    if (!cache.has(source)) {
      cache.set(
        source,
        (async () => {
          const response = await fetch(source)
          if (!response.ok) throw new Error(`无法读取图片：${response.status}`)
          const type = imageTypeFrom(response.headers.get('content-type'), source)
          if (!type) return rasterizeImage(image)
          return { data: new Uint8Array(await response.arrayBuffer()), type }
        })(),
      )
    }
    return cache.get(source)
  }
}

function visualDescription(visual) {
  if (visual.tagName === 'IMG') return cleanText(visual.alt) || '手册图片'
  const zone = visual.closest('[data-image-zone]')
  if (zone?.classList.contains('function-block-image')) return '功能框图'
  if (zone?.classList.contains('dimension-images')) return '外形尺寸图'
  if (zone?.classList.contains('assembly-image')) return '建议装配图'
  return '手册图形'
}

async function imageParagraph(visual, loadImage, limits = {}, spacing = { after: 80, before: 40 }) {
  const asset =
    visual.tagName === 'svg' || visual.tagName === 'SVG'
      ? await rasterizeSvg(visual)
      : await loadImage(visual)
  const dimensions = displayedImageSize(visual, limits.maxWidth || 680, limits.maxHeight || 560)
  const description = visualDescription(visual)
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        altText: { description, name: description, title: description },
        data: asset.data,
        transformation: dimensions,
        type: asset.type,
      }),
    ],
    spacing,
  })
}

async function imageParagraphs(container, loadImage, limits) {
  const paragraphs = []
  const visuals = Array.from(container?.querySelectorAll('img, svg.scene-svg') || []).filter(
    (visual) => !visual.closest('.curve-embed-header'),
  )
  for (const visual of visuals) {
    try {
      paragraphs.push(await imageParagraph(visual, loadImage, limits))
    } catch (error) {
      console.warn('Word 导出时跳过无法读取的图片或图形', error)
    }
  }
  return paragraphs
}

async function curveGridTable(container, loadImage) {
  const embeds = Array.from(container.querySelectorAll('.curve-frame-list > .curve-embed'))
  if (!embeds.length) return null

  const gap = convertMillimetersToTwip(6)
  const leftWidth = Math.floor((BODY_WIDTH - gap) / 2)
  const rightWidth = BODY_WIDTH - gap - leftWidth
  const columnWidths = [leftWidth, gap, rightWidth]
  const charts = []
  for (const embed of embeds) {
    const visual = embed.querySelector('.curve-media > img, .curve-media > svg.scene-svg')
    if (!visual) continue
    try {
      const width = charts.length % 2 === 0 ? leftWidth : rightWidth
      const children = [
        await imageParagraph(
          visual,
          loadImage,
          { maxWidth: Math.floor(width / 15), maxHeight: 440 },
          { after: 0, before: 0 },
        ),
      ]
      const caption = elementText(embed.querySelector('.curve-caption'))
      if (caption) {
        children.push(
          textParagraph(caption, { after: 0, alignment: AlignmentType.CENTER, size: 16 }),
        )
      }
      charts.push(children)
    } catch (error) {
      console.warn('Word 导出时跳过无法读取的曲线图', error)
    }
  }
  if (!charts.length) return null

  function chartCell(children, width) {
    return new TableCell({
      borders: { bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, top: NO_BORDER },
      children: children || [textParagraph('', { after: 0 })],
      margins: { bottom: gap, left: 0, right: 0, top: 0 },
      verticalAlign: VerticalAlign.TOP,
      width: { size: width, type: WidthType.DXA },
    })
  }

  const rows = []
  for (let index = 0; index < charts.length; index += 2) {
    rows.push(
      new TableRow({
        cantSplit: true,
        children: [
          chartCell(charts[index], leftWidth),
          chartCell(null, gap),
          chartCell(charts[index + 1], rightWidth),
        ],
      }),
    )
  }
  return new Table({
    borders: NO_TABLE_BORDERS,
    columnWidths,
    layout: TableLayoutType.FIXED,
    rows,
    width: { size: BODY_WIDTH, type: WidthType.DXA },
  })
}

function listParagraphs(list) {
  return Array.from(list.children)
    .filter((item) => item.tagName === 'LI')
    .map((item, index) => {
      const text = elementText(item)
      return textParagraph(`${list.tagName === 'OL' ? `${index + 1}.` : '•'} ${text}`, {
        after: 45,
        indent: { hanging: convertMillimetersToTwip(4), left: convertMillimetersToTwip(7) },
      })
    })
}

function tableWidths(table, totalWidth) {
  const firstRow = table.rows[0]
  if (!firstRow) return []
  const cells = Array.from(firstRow.cells)
  const measured = cells.map((cell) => cell.getBoundingClientRect().width)
  const measuredTotal = measured.reduce((sum, width) => sum + width, 0)
  if (measuredTotal > 0) {
    return measured.map((width) => Math.max(480, Math.round((width / measuredTotal) * totalWidth)))
  }
  return cells.map(() => Math.round(totalWidth / Math.max(1, cells.length)))
}

function wordTable(table) {
  const ratio = table.classList.contains('narrow')
    ? 0.65
    : table.classList.contains('wide')
      ? 0.92
      : 0.86
  const totalWidth = Math.round(BODY_WIDTH * ratio)
  const columnWidths = tableWidths(table, totalWidth)
  const rows = Array.from(table.rows).map((row) => {
    const isHeader = Boolean(row.closest('thead'))
    return new TableRow({
      cantSplit: true,
      children: Array.from(row.cells).map(
        (cell, index) =>
          new TableCell({
            children: [
              textParagraph(elementText(cell), {
                alignment: AlignmentType.CENTER,
                after: 0,
                bold: false,
                line: 250,
                size: 19,
              }),
            ],
            columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
            margins: { bottom: 55, left: 70, right: 70, top: 55 },
            rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
            shading: isHeader ? { fill: 'FFFFFF', type: ShadingType.CLEAR } : undefined,
            verticalAlign: VerticalAlign.CENTER,
            width: {
              size: columnWidths[index] || Math.round(totalWidth / row.cells.length),
              type: WidthType.DXA,
            },
          }),
      ),
      tableHeader: isHeader,
    })
  })
  return new Table({
    alignment: AlignmentType.CENTER,
    borders: TABLE_BORDERS,
    columnWidths,
    layout: TableLayoutType.FIXED,
    rows,
    width: { size: totalWidth, type: WidthType.DXA },
  })
}

function textBlockParagraphs(element, options = {}) {
  const directLines = Array.from(element.children || [])
    .filter((child) => !child.matches('button, .placeholder, .table-toolbar, script, style'))
    .map(elementText)
    .filter(Boolean)
  const lines = directLines.length ? directLines : [elementText(element)].filter(Boolean)
  return lines.map((line) => textParagraph(line, options))
}

async function blocksFromElement(element, loadImage, options = {}) {
  if (!element || element.hidden) return []
  if (element.matches('.table-toolbar, .placeholder, button, input, script, style')) return []
  if (element.matches('.section-title')) return [headingParagraph(element)]
  if (element.tagName === 'TABLE') return [wordTable(element)]
  if (element.matches('UL, OL')) return listParagraphs(element)
  if (element.matches('[data-curve-target], .curve-frame-list')) {
    const grid = await curveGridTable(element, loadImage)
    return grid ? [grid] : imageParagraphs(element, loadImage, options.imageLimits)
  }
  if (element.matches('[data-image-zone]')) {
    return imageParagraphs(element, loadImage, options.imageLimits)
  }
  if (element.matches('.note-text')) {
    return textBlockParagraphs(element, {
      after: 55,
      indent: { left: convertMillimetersToTwip(4) },
    })
  }
  if (element.matches('.static-warning')) {
    return textBlockParagraphs(element, {
      after: 70,
      alignment: AlignmentType.CENTER,
      bold: true,
      font: TITLE_FONT,
      line: 320,
      size: 24,
    })
  }
  if (element.matches('.intro-text, .free-text')) {
    return textBlockParagraphs(element, {
      after: 70,
      indent: { firstLine: convertMillimetersToTwip(7) },
    })
  }
  if (element.matches('.dimension-caption, .dimension-note')) {
    return textBlockParagraphs(element, {
      after: 70,
      alignment: element.matches('.dimension-note') ? AlignmentType.CENTER : AlignmentType.LEFT,
      size: 20,
    })
  }
  const blocks = []
  for (const child of Array.from(element.children || [])) {
    blocks.push(...(await blocksFromElement(child, loadImage, options)))
  }
  if (!blocks.length) {
    const text = elementText(element)
    if (text) blocks.push(textParagraph(text))
  }
  return blocks
}

async function twoColumnTable(element, loadImage) {
  const panels = Array.from(element.querySelectorAll(':scope > .half-panel')).slice(0, 2)
  const cells = []
  for (const panel of panels) {
    const children = []
    for (const child of Array.from(panel.children)) {
      children.push(
        ...(await blocksFromElement(child, loadImage, {
          imageLimits: { maxHeight: 210, maxWidth: 300 },
        })),
      )
    }
    cells.push(
      new TableCell({
        borders: { bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, top: NO_BORDER },
        children: children.length ? children : [textParagraph('', { after: 0 })],
        margins: { bottom: 0, left: 70, right: 180, top: 0 },
        verticalAlign: VerticalAlign.TOP,
        width: { size: Math.round(BODY_WIDTH / 2), type: WidthType.DXA },
      }),
    )
  }
  while (cells.length < 2) {
    cells.push(new TableCell({ children: [textParagraph('', { after: 0 })] }))
  }
  return new Table({
    borders: NO_TABLE_BORDERS,
    columnWidths: [Math.round(BODY_WIDTH / 2), Math.round(BODY_WIDTH / 2)],
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({ cantSplit: true, children: cells })],
    width: { size: BODY_WIDTH, type: WidthType.DXA },
  })
}

async function pageContent(page, loadImage) {
  const content = page.querySelector(':scope > .page-content')
  const blocks = []
  for (const child of Array.from(content?.children || [])) {
    if (child.matches('.two-column')) blocks.push(await twoColumnTable(child, loadImage))
    else blocks.push(...(await blocksFromElement(child, loadImage)))
  }
  return blocks.length ? blocks : [textParagraph('', { after: 0 })]
}

async function headerForPage(page) {
  const header = page.querySelector(':scope > .manual-header')
  const model = elementText(header?.querySelector('.model'))
  const subtitle = elementText(header?.querySelector('.subtitle'))
  const version = elementText(header?.querySelector('.version'))
  const strip = new Table({
    borders: NO_TABLE_BORDERS,
    columnWidths: [BODY_WIDTH],
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({
      children: [new TableCell({
        children: [textParagraph(version, {
          after: 0, alignment: AlignmentType.RIGHT, bold: true,
          color: 'FFFFFF', font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'SimHei' }, size: 21,
        })],
        margins: { bottom: 50, left: 440, right: 440, top: 50 },
        shading: { fill: '999999', type: ShadingType.CLEAR },
        verticalAlign: VerticalAlign.CENTER,
      })],
    })],
    width: { size: BODY_WIDTH, type: WidthType.DXA },
  })
  return new Header({ children: [
    textParagraph(model, {
      after: 20, alignment: AlignmentType.RIGHT,
      font: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: 'SimSun' },
      line: 300, size: 28,
    }),
    textParagraph(subtitle, {
      after: 0, alignment: AlignmentType.RIGHT,
      font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft YaHei' }, line: 270, size: 24,
    }),
    textParagraph('', { after: 55, line: 120 }), strip,
  ] })
}

function footerForPage(page) {
  const text = elementText(page.querySelector(':scope > .footer'))
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { bottom: LIGHT_BORDER, top: LIGHT_BORDER },
        children: textRuns(text, { font: BODY_FONT, size: 18 }),
        spacing: { after: 25, before: 25, line: 220, lineRule: LineRuleType.AUTO },
      }),
    ],
  })
}

function safeFileName(value) {
  return (
    cleanText(value)
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/[. ]+$/g, '') || 'product_manual'
  )
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportManualAsWord(manual) {
  if (!manual) throw new Error('未找到可导出的手册内容')
  window.ProductManualTemplateToolContext?.prepareForExport?.()

  const pages = Array.from(manual.querySelectorAll(':scope > .page'))
  if (!pages.length) throw new Error('当前手册没有可导出的页面')
  const loadImage = createImageLoader()
  const children = []
  for (const page of pages) {
    children.push(...(await pageContent(page, loadImage)))
  }
  const firstPage = pages[0]
  const primaryHeader = await headerForPage(firstPage, loadImage)
  const evenHeader = await headerForPage(firstPage, loadImage)
  const sections = [
    {
      children,
      footers: { default: footerForPage(firstPage), even: footerForPage(firstPage) },
      headers: { default: primaryHeader, even: evenHeader },
      properties: {
        page: {
          margin: {
            bottom: convertMillimetersToTwip(18),
            footer: convertMillimetersToTwip(6),
            header: convertMillimetersToTwip(7),
            left: convertMillimetersToTwip(10),
            right: convertMillimetersToTwip(10),
            top: convertMillimetersToTwip(37),
          },
          size: {
            height: convertMillimetersToTwip(297),
            orientation: PageOrientation.PORTRAIT,
            width: convertMillimetersToTwip(210),
          },
        },
        type: SectionType.NEXT_PAGE,
      },
    },
  ]

  const model = elementText(manual.querySelector('.model')) || '产品手册'
  const wordDocument = new Document({
    creator: 'Pre-installed Manual',
    description: '由产品手册编辑器导出的可编辑 Word 文档',
    evenAndOddHeaderAndFooters: true,
    sections,
    styles: {
      default: {
        document: {
          paragraph: { spacing: { after: 0, line: 276, lineRule: LineRuleType.AUTO } },
          run: { color: '000000', font: BODY_FONT, size: 21 },
        },
      },
    },
    subject: '产品手册',
    title: model,
  })
  const blob = await Packer.toBlob(wordDocument)
  const fileName = `${safeFileName(model)}_产品手册.docx`
  downloadBlob(blob, fileName)
  return { blob, fileName, pageCount: pages.length }
}
