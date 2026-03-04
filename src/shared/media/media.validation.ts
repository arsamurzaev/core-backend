import { BadRequestException } from '@nestjs/common'

import { MediaRepository } from './media.repository'

export async function ensureMediaInCatalog(
	mediaRepo: Pick<MediaRepository, 'findById'>,
	mediaId: string,
	catalogId: string
): Promise<void> {
	const existing = await mediaRepo.findById(mediaId, catalogId)
	if (!existing) {
		throw new BadRequestException(`Медиа ${mediaId} не найдено в каталоге`)
	}
}
