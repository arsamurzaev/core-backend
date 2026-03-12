import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

@Injectable()
export class TypeRepository {
	constructor(private readonly prismaService: PrismaService) {}

	async existsCode(code: string): Promise<boolean> {
		const type = await this.prismaService.type.findUnique({
			where: { code },
			select: { id: true }
		})
		return Boolean(type)
	}

	findById(id: string) {
		return this.prismaService.type.findUnique({ where: { id } })
	}

	findAll() {
		return this.prismaService.type.findMany({
			select: { id: true, code: true, name: true }
		})
	}

	create(data: { code: string; name: string }) {
		return this.prismaService.type.create({ data })
	}

	delete(id: string) {
		return this.prismaService.type.delete({ where: { id } })
	}
}
