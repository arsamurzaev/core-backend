import { Prisma } from '@generated/client'
import { BadRequestException, Injectable } from '@nestjs/common'
import { hash } from 'argon2'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { AuthService } from '../auth/auth.service'

import { CreateUserDtoReq } from './dto/requests/create-user.dto.req'

@Injectable()
export class UserService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly authService: AuthService
	) {}

	async register(
		dto: CreateUserDtoReq,
		meta?: { ip?: string | null; userAgent?: string | null }
	) {
		const { login, password, role, regionalityIds, name } = dto

		const hashedPassword = await hash(password)

		const regionConnect =
			regionalityIds && regionalityIds.length > 0
				? { connect: regionalityIds.map(regionalityId => ({ id: regionalityId })) }
				: undefined

		const formatDto: Prisma.UserCreateInput = {
			name,
			login,
			password: hashedPassword,
			isEmailConfirmed: false,
			role,
			...(regionConnect ? { regions: regionConnect } : {})
		}

		const existUser = await this.prisma.user.findFirst({ where: { login } })
		if (existUser) {
			throw new BadRequestException('Пользователь с таким логином уже существует')
		}

		const user = await this.prisma.user.create({ data: formatDto })

		const token = await this.authService.createSessionForUser(user.id, meta, null)

		return token
	}
}
