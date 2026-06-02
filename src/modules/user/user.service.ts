import { Prisma } from '@generated/client'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { hash } from 'argon2'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
	AUTH_SESSION_ISSUER_PORT,
	type AuthSessionIssuerPort
} from '@/modules/auth/contracts'

import { CreateUserDtoReq } from './dto/requests/create-user.dto.req'

@Injectable()
export class UserService {
	constructor(
		private readonly prisma: PrismaService,
		@Inject(AUTH_SESSION_ISSUER_PORT)
		private readonly authService: AuthSessionIssuerPort
	) {}

	async register(
		dto: CreateUserDtoReq,
		meta?: { ip?: string | null; userAgent?: string | null }
	) {
		const { login, password, role, regionalityIds, countryIds, name } = dto

		const hashedPassword = await hash(password)

		const countryConnect =
			countryIds && countryIds.length > 0
				? { connect: countryIds.map(countryId => ({ id: countryId })) }
				: undefined

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
			...(countryConnect ? { countries: countryConnect } : {}),
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
