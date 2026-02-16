import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

@Injectable()
export class MediaRepository {
	constructor(private readonly prisma: PrismaService) {}

	findByIds(ids: string[], catalogId: string) {
		if (!ids.length) return Promise.resolve([])
		return this.prisma.media.findMany({
			where: { id: { in: ids }, catalogId },
			select: { id: true }
		})
	}

	findById(id: string, catalogId: string) {
		return this.prisma.media.findFirst({
			where: { id, catalogId },
			select: { id: true }
		})
	}
}
