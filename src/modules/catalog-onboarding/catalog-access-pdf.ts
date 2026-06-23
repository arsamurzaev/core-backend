import jsPDF from 'jspdf'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

type CatalogAccessPdfInput = {
	catalogName: string
	catalogUrl: string
	loginUrl: string
	login: string
	password: string
	supportContact?: string
}

type CatalogAccessPdf = {
	filename: string
	content: Buffer
	contentType: 'application/pdf'
}

const PAGE_WIDTH = 530
const PAGE_HEIGHT = 756
const SUPPORT_CONTACT =
	process.env.CATALOG_ACCESS_SUPPORT_CONTACT ?? '+7 938 001 87 78'

export async function generateCatalogAccessPdf(
	data: CatalogAccessPdfInput
): Promise<CatalogAccessPdf> {
	const doc = new jsPDF({
		orientation: 'p',
		unit: 'px',
		format: [PAGE_WIDTH, PAGE_HEIGHT]
	})

	const fonts = addFonts(doc)
	const setFont = (style: 'normal' | 'bold' = 'normal') => {
		if (style === 'bold' && fonts.bold) {
			doc.setFont('NotoSans', 'bold')
			return
		}
		if (fonts.regular) {
			doc.setFont('NotoSans', 'normal')
			return
		}
		doc.setFont('helvetica', style)
	}

	doc.setTextColor(0, 0, 0)
	addLogo(doc, setFont)

	doc.setFontSize(22)
	setFont('bold')
	doc.text('Данные доступа к каталогу', PAGE_WIDTH / 2, 74, {
		align: 'center'
	})

	doc.setFontSize(12)
	setFont('normal')
	doc.text('данная информация является конфиденциальной', PAGE_WIDTH / 2, 94, {
		align: 'center'
	})

	drawValueBlock(doc, setFont, {
		label: 'Название бизнеса',
		value: data.catalogName,
		y: 132
	})
	drawValueBlock(doc, setFont, {
		label: 'Сайт каталога',
		value: data.catalogUrl,
		y: 252,
		link: data.catalogUrl
	})
	drawValueBlock(doc, setFont, {
		label: 'Вход в кабинет',
		value: data.loginUrl,
		y: 372,
		link: data.loginUrl
	})

	doc.setFontSize(16)
	setFont('bold')
	doc.text('Данные для входа', 58, 498)

	doc.setFillColor('#F7F7F8')
	doc.roundedRect(32, 518, PAGE_WIDTH - 64, 96, 20, 20, 'F')
	doc.setFontSize(24)
	setFont('bold')
	doc.text('Логин:', 58, 560)
	doc.text('Пароль:', 58, 590)
	setFont('normal')
	doc.text(data.login, 158, 560)
	doc.text(data.password, 158, 590)

	const supportContact = data.supportContact ?? SUPPORT_CONTACT
	const supportDigits = supportContact.replace(/\D/g, '')
	doc.setFontSize(15)
	setFont('bold')
	doc.text('Контактный номер для технической поддержки', PAGE_WIDTH / 2, 670, {
		align: 'center'
	})
	doc.setFontSize(16)
	setFont('normal')
	doc.textWithLink(supportContact, PAGE_WIDTH / 2, 697, {
		align: 'center',
		url: supportDigits ? `https://wa.me/${supportDigits}` : supportContact
	})
	doc.line(PAGE_WIDTH / 2 - 82, 704, PAGE_WIDTH / 2 + 82, 704)

	const createdAt = new Date()
	doc.setFontSize(11)
	doc.text(
		`Дата создания: ${createdAt.toLocaleDateString('ru-RU')} ${createdAt.toLocaleTimeString(
			'ru-RU',
			{
				hour: '2-digit',
				minute: '2-digit'
			}
		)}`,
		PAGE_WIDTH / 2,
		PAGE_HEIGHT - 14,
		{ align: 'center' }
	)

	return {
		filename: `access-${sanitizeFileName(data.login)}.pdf`,
		content: Buffer.from(doc.output('arraybuffer')),
		contentType: 'application/pdf'
	}
}

function drawValueBlock(
	doc: jsPDF,
	setFont: (style?: 'normal' | 'bold') => void,
	params: { label: string; value: string; y: number; link?: string }
) {
	doc.setFontSize(16)
	setFont('bold')
	doc.text(params.label, 58, params.y)

	doc.setFillColor('#F7F7F8')
	doc.roundedRect(32, params.y + 20, PAGE_WIDTH - 64, 66, 20, 20, 'F')
	doc.setFontSize(22)
	setFont('normal')

	const lines = doc.splitTextToSize(params.value, PAGE_WIDTH - 120).slice(0, 2)
	const y = params.y + 58 - (lines.length - 1) * 9

	if (params.link) {
		doc.textWithLink(lines.join('\n'), PAGE_WIDTH / 2, y, {
			align: 'center',
			url: params.link
		})
		return
	}

	doc.text(lines, PAGE_WIDTH / 2, y, { align: 'center' })
}

function addFonts(doc: jsPDF) {
	const regularFont = readAsset('fonts/NotoSans-Regular.ttf')
	const boldFont = readAsset('fonts/NotoSans-Bold.ttf')
	const result = { regular: false, bold: false }

	if (regularFont) {
		doc.addFileToVFS('NotoSans-Regular.ttf', regularFont.toString('base64'))
		doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal')
		result.regular = true
	}

	if (boldFont) {
		doc.addFileToVFS('NotoSans-Bold.ttf', boldFont.toString('base64'))
		doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold')
		result.bold = true
	}

	return result
}

function addLogo(doc: jsPDF, setFont: (style?: 'normal' | 'bold') => void) {
	const logo = readAsset('logo.png')
	if (logo) {
		try {
			doc.addImage(
				`data:image/png;base64,${logo.toString('base64')}`,
				'PNG',
				PAGE_WIDTH / 2 - 60,
				16,
				117,
				34
			)
			return
		} catch {
			// Fall through to text logo when the image cannot be decoded by jsPDF.
		}
	}

	doc.setFontSize(24)
	setFont('bold')
	doc.text('myctlg', PAGE_WIDTH / 2, 42, { align: 'center' })
}

function readAsset(relativePath: string): Buffer | null {
	for (const baseDir of getAssetBaseDirs()) {
		const filePath = path.join(baseDir, relativePath)
		if (existsSync(filePath)) return readFileSync(filePath)
	}
	return null
}

function getAssetBaseDirs(): string[] {
	return [
		path.resolve(process.cwd(), 'public'),
		path.resolve(process.cwd(), '../dashboard/public')
	]
}

function sanitizeFileName(value: string): string {
	return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || 'catalog'
}
