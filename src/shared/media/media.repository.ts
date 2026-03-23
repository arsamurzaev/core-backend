import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

type MediaIdRecord = { id: string }
type OrphanMediaRecord = {
	id: string
	storage: string
	key: string
	variants: { key: string; storage: string }[]
}

@Injectable()
export class MediaRepository {
	constructor(private readonly prisma: PrismaService) {}

	findByIds(ids: string[], catalogId: string): Promise<MediaIdRecord[]> {
		if (!ids.length) return Promise.resolve<MediaIdRecord[]>([])
		return this.prisma.media.findMany({
			where: { id: { in: ids }, catalogId },
			select: { id: true }
		})
	}

	findById(id: string, catalogId: string): Promise<MediaIdRecord | null> {
		return this.prisma.media.findFirst({
			where: { id, catalogId },
			select: { id: true }
		})
	}

	findOrphanedByIds(
		ids: string[],
		catalogId: string
	): Promise<OrphanMediaRecord[]> {
		if (!ids.length) return Promise.resolve<OrphanMediaRecord[]>([])

		return this.prisma.media.findMany({
			where: {
				id: { in: ids },
				catalogId,
				productMedia: { none: {} },
				categoryImages: { none: { deleteAt: null } },
				catalogConfigLogos: { none: { deleteAt: null } },
				catalogConfigBackgrounds: { none: { deleteAt: null } },
				seoOgMedia: { none: { deleteAt: null } },
				seoTwitterMedia: { none: { deleteAt: null } }
			},
			select: {
				id: true,
				storage: true,
				key: true,
				variants: {
					select: {
						key: true,
						storage: true
					}
				}
			}
		})
	}

	async deleteOrphanedByIds(ids: string[], catalogId: string): Promise<number> {
		if (!ids.length) return 0

		const result = await this.prisma.media.deleteMany({
			where: {
				id: { in: ids },
				catalogId,
				productMedia: { none: {} },
				categoryImages: { none: { deleteAt: null } },
				catalogConfigLogos: { none: { deleteAt: null } },
				catalogConfigBackgrounds: { none: { deleteAt: null } },
				seoOgMedia: { none: { deleteAt: null } },
				seoTwitterMedia: { none: { deleteAt: null } }
			}
		})

		return result.count
	}
}
