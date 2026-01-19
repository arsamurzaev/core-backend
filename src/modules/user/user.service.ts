import { Prisma } from '@generated/client'
import { BadRequestException, Injectable } from '@nestjs/common'
import { hash } from 'argon2'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { SessionService } from '../auth/session/session.service'

import { CreateUserDtoReq } from './dto/requests/create-user.dto.req'

@Injectable()
export class UserService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly sessionService: SessionService
	) {}

	async register(dto: CreateUserDtoReq) {
		const { login, password, role, regionalityIds, name } = dto

		const hashedPassword = await hash(password) 

		const formatDto: Prisma.UserCreateInput = {
			name,
			login,
			password: hashedPassword,
			isEmailConfirmed: false,
			role,
			regions: {
				connect: regionalityIds.map(regionalityId => ({ id: regionalityId }))
			}
		}

		const existUser = await this.prisma.user.findFirst({ where: { login } })
		if (existUser) {
			throw new BadRequestException('Пользователь с таким логином уже существует')
		}

		const user = await this.prisma.user.create({ data: formatDto })

		const token = await this.sessionService.createForUser(user.id)

		return token
	}
}
