import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

type MediaIdRecord = { id: string }

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
}
