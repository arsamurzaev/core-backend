import { BadRequestException } from '@nestjs/common'
import sharp from 'sharp'

export async function fileTo34(buffer: Buffer) {
	try {
		const targetW = 1500 // пример ширины
		const targetH = 2000 // пример высоты (3:4)
		const result = await sharp(buffer)
			.resize(targetW, targetH, {
				fit: 'contain',
				background: { r: 0, g: 0, b: 0, alpha: 0 }
			})
			.png({ quality: 100 })
			.toBuffer()
		return result
	} catch (error) {
		throw new BadRequestException(error)
	}
}
