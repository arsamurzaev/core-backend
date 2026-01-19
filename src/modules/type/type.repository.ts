import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { CreateTypeDtoReq } from './dto/req/create-type.dto.req'
import { UpdateTypeDtoReq } from './dto/req/update-type.dto.req'

@Injectable()
export class TypeRepository {
	constructor(private readonly prismaService: PrismaService) {}

	findByCode(code: string) {
		return this.prismaService.type.findUnique({ where: { code } })
	}

	findById(id: string) {
		return this.prismaService.type.findUnique({ where: { id } })
	}

	findAll() {
		return this.prismaService.type.findMany({
			select: { id: true, code: true, name: true }
		})
	}

	create(dto: CreateTypeDtoReq) {
		return this.prismaService.type.create({ data: dto })
	}

	update(id: string, dto: UpdateTypeDtoReq) {
		return this.prismaService.type.update({ where: { id }, data: dto })
	}

	delete(id: string) {
		return this.prismaService.type.delete({ where: { id } })
	}
}
