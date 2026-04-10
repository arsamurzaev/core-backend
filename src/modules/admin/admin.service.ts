import { CatalogStatus, OrderStatus, Role } from '@generated/enums'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { SessionService } from '@/modules/auth/session/session.service'
import { MoySkladQueueService } from '@/modules/integration/providers/moysklad/moysklad.queue.service'

import type { AdminCatalogsQueryDto } from './dto/requests/admin-catalogs-query.dto'
import type { AdminOrdersQueryDto } from './dto/requests/admin-orders-query.dto'
import type { AdminUpdateCatalogDto } from './dto/requests/admin-update-catalog.dto'
import type { AdminUpdateOrderDto } from './dto/requests/admin-update-order.dto'
import type { AdminUpdateUserRoleDto } from './dto/requests/admin-update-user-role.dto'
import type { AdminUsersQueryDto } from './dto/requests/admin-users-query.dto'

@Injectable()
export class AdminService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly sessions: SessionService,
		private readonly moyskladQueue: MoySkladQueueService
	) {}

	// ─── Catalogs ─────────────────────────────────────────────────────────────

	async listCatalogs(query: AdminCatalogsQueryDto) {
		const where = {
			deleteAt: null,
			...(query.status && { config: { status: query.status } }),
			...(query.search && {
				OR: [
					{ name: { contains: query.search, mode: 'insensitive' as const } },
					{ slug: { contains: query.search, mode: 'insensitive' as const } },
					{ domain: { contains: query.search, mode: 'insensitive' as const } }
				]
			})
		}

		const [items, total] = await this.prisma.$transaction([
			this.prisma.catalog.findMany({
				where,
				skip: query.skip,
				take: query.limit,
				orderBy: { createdAt: 'desc' },
				select: {
					id: true,
					name: true,
					slug: true,
					domain: true,
					subscriptionEndsAt: true,
					createdAt: true,
					user: { select: { id: true, name: true, login: true } },
					config: { select: { status: true, note: true } },
					_count: { select: { products: true, order: true } }
				}
			}),
			this.prisma.catalog.count({ where })
		])

		return { items, total, page: query.page, limit: query.limit }
	}

	async getCatalogById(id: string) {
		const catalog = await this.prisma.catalog.findUnique({
			where: { id, deleteAt: null },
			select: {
				id: true,
				name: true,
				slug: true,
				domain: true,
				subscriptionEndsAt: true,
				createdAt: true,
				updatedAt: true,
				user: { select: { id: true, name: true, login: true, role: true } },
				type: { select: { id: true, name: true } },
				config: {
					select: {
						status: true,
						about: true,
						description: true,
						currency: true,
						note: true
					}
				},
				settings: { select: { isActive: true } },
				_count: {
					select: {
						products: true,
						order: true,
						category: true,
						brands: true,
						media: true
					}
				}
			}
		})

		if (!catalog) throw new NotFoundException('Каталог не найден')

		const revenue = await this.prisma.order.aggregate({
			where: { catalogId: id, status: OrderStatus.COMPLETED },
			_sum: { totalAmount: true }
		})

		return { ...catalog, revenue: revenue._sum.totalAmount ?? 0 }
	}

	async updateCatalog(id: string, dto: AdminUpdateCatalogDto) {
		const catalog = await this.prisma.catalog.findUnique({
			where: { id, deleteAt: null }
		})
		if (!catalog) throw new NotFoundException('Каталог не найден')

		return this.prisma.catalog.update({
			where: { id },
			data: {
				...(dto.name !== undefined && { name: dto.name }),
				...(dto.domain !== undefined && { domain: dto.domain }),
				...(dto.subscriptionEndsAt !== undefined && {
					subscriptionEndsAt: dto.subscriptionEndsAt
				}),
				...(dto.status !== undefined || dto.note !== undefined
					? {
							config: {
								update: {
									...(dto.status !== undefined && { status: dto.status }),
									...(dto.note !== undefined && { note: dto.note })
								}
							}
						}
					: {})
			},
			select: { id: true, name: true, slug: true }
		})
	}

	async suspendCatalog(id: string) {
		const catalog = await this.prisma.catalog.findUnique({
			where: { id, deleteAt: null },
			select: { config: { select: { status: true } } }
		})
		if (!catalog) throw new NotFoundException('Каталог не найден')
		if (catalog.config?.status === CatalogStatus.REFUSAL) {
			throw new BadRequestException('Каталог уже приостановлен')
		}

		return this.prisma.catalog.update({
			where: { id },
			data: { config: { update: { status: CatalogStatus.REFUSAL } } },
			select: { id: true, name: true }
		})
	}

	async restoreCatalog(id: string) {
		const catalog = await this.prisma.catalog.findUnique({
			where: { id, deleteAt: null },
			select: { config: { select: { status: true } } }
		})
		if (!catalog) throw new NotFoundException('Каталог не найден')
		if (catalog.config?.status !== CatalogStatus.REFUSAL) {
			throw new BadRequestException('Каталог не приостановлен')
		}

		return this.prisma.catalog.update({
			where: { id },
			data: { config: { update: { status: CatalogStatus.OPERATIONAL } } },
			select: { id: true, name: true }
		})
	}

	async deleteCatalog(id: string) {
		const catalog = await this.prisma.catalog.findUnique({
			where: { id, deleteAt: null }
		})
		if (!catalog) throw new NotFoundException('Каталог не найден')

		await this.prisma.catalog.update({
			where: { id },
			data: { deleteAt: new Date() }
		})
	}

	// ─── Users ────────────────────────────────────────────────────────────────

	async listUsers(query: AdminUsersQueryDto) {
		const where = {
			deleteAt: null,
			...(query.role && { role: query.role }),
			...(query.search && {
				OR: [
					{ login: { contains: query.search, mode: 'insensitive' as const } },
					{ name: { contains: query.search, mode: 'insensitive' as const } }
				]
			})
		}

		const [items, total] = await this.prisma.$transaction([
			this.prisma.user.findMany({
				where,
				skip: query.skip,
				take: query.limit,
				orderBy: { createdAt: 'desc' },
				select: {
					id: true,
					name: true,
					login: true,
					role: true,
					createdAt: true,
					_count: { select: { catalogs: true } }
				}
			}),
			this.prisma.user.count({ where })
		])

		return { items, total, page: query.page, limit: query.limit }
	}

	async getUserById(id: string) {
		const user = await this.prisma.user.findUnique({
			where: { id, deleteAt: null },
			select: {
				id: true,
				name: true,
				login: true,
				role: true,
				createdAt: true,
				catalogs: {
					where: { deleteAt: null },
					select: {
						id: true,
						name: true,
						slug: true,
						config: { select: { status: true } }
					}
				}
			}
		})

		if (!user) throw new NotFoundException('Пользователь не найден')

		const sessions = await this.sessions.listForUser(id)
		return { ...user, sessions }
	}

	async updateUserRole(id: string, dto: AdminUpdateUserRoleDto) {
		const user = await this.prisma.user.findUnique({
			where: { id, deleteAt: null }
		})
		if (!user) throw new NotFoundException('Пользователь не найден')

		return this.prisma.user.update({
			where: { id },
			data: { role: dto.role },
			select: { id: true, login: true, role: true }
		})
	}

	async blockUser(id: string) {
		const user = await this.prisma.user.findUnique({
			where: { id, deleteAt: null }
		})
		if (!user) throw new NotFoundException('Пользователь не найден')
		if (user.role === Role.ADMIN) {
			throw new BadRequestException('Нельзя заблокировать администратора')
		}

		await this.sessions.destroyAllForUser(id)

		return this.prisma.user.update({
			where: { id },
			data: { deleteAt: new Date() },
			select: { id: true, login: true }
		})
	}

	async unblockUser(id: string) {
		const user = await this.prisma.user.findFirst({ where: { id } })
		if (!user) throw new NotFoundException('Пользователь не найден')

		return this.prisma.user.update({
			where: { id },
			data: { deleteAt: null },
			select: { id: true, login: true }
		})
	}

	async listUserSessions(userId: string) {
		const user = await this.prisma.user.findFirst({
			where: { id: userId },
			select: { id: true }
		})
		if (!user) throw new NotFoundException('Пользователь не найден')

		return this.sessions.listForUser(userId)
	}

	async destroyUserSessions(userId: string) {
		const user = await this.prisma.user.findFirst({
			where: { id: userId },
			select: { id: true }
		})
		if (!user) throw new NotFoundException('Пользователь не найден')

		await this.sessions.destroyAllForUser(userId)
	}

	// ─── Orders ───────────────────────────────────────────────────────────────

	async listOrders(query: AdminOrdersQueryDto) {
		const where = {
			...(query.catalogId && { catalogId: query.catalogId }),
			...(query.status && { status: query.status }),
			...(query.dateFrom || query.dateTo
				? {
						createdAt: {
							...(query.dateFrom && { gte: query.dateFrom }),
							...(query.dateTo && { lte: query.dateTo })
						}
					}
				: {})
		}

		const [items, total] = await this.prisma.$transaction([
			this.prisma.order.findMany({
				where,
				skip: query.skip,
				take: query.limit,
				orderBy: { createdAt: 'desc' },
				select: {
					id: true,
					status: true,
					totalAmount: true,
					paymentMethod: true,
					comment: true,
					createdAt: true,
					catalog: { select: { id: true, name: true, slug: true } },
					_count: { select: { items: true } }
				}
			}),
			this.prisma.order.count({ where })
		])

		return { items, total, page: query.page, limit: query.limit }
	}

	async getOrderById(id: string) {
		const order = await this.prisma.order.findUnique({
			where: { id },
			select: {
				id: true,
				status: true,
				totalAmount: true,
				paymentMethod: true,
				paymentProof: true,
				comment: true,
				commentByAdmin: true,
				createdAt: true,
				updatedAt: true,
				catalog: { select: { id: true, name: true, slug: true } },
				items: {
					select: {
						quantity: true,
						unitPrice: true,
						product: { select: { id: true, name: true } }
					}
				}
			}
		})

		if (!order) throw new NotFoundException('Заказ не найден')
		return order
	}

	async updateOrder(id: string, dto: AdminUpdateOrderDto) {
		const order = await this.prisma.order.findUnique({ where: { id } })
		if (!order) throw new NotFoundException('Заказ не найден')

		return this.prisma.order.update({
			where: { id },
			data: {
				...(dto.status !== undefined && { status: dto.status }),
				...(dto.commentByAdmin !== undefined && {
					commentByAdmin: dto.commentByAdmin
				})
			},
			select: { id: true, status: true, commentByAdmin: true }
		})
	}

	// ─── Integrations ─────────────────────────────────────────────────────────

	async listIntegrations(page: number, limit: number) {
		const skip = (page - 1) * limit
		const [items, total] = await this.prisma.$transaction([
			this.prisma.integration.findMany({
				skip,
				take: limit,
				orderBy: { lastSyncAt: 'desc' },
				select: {
					id: true,
					provider: true,
					isActive: true,
					lastSyncAt: true,
					lastSyncStatus: true,
					lastSyncError: true,
					totalProducts: true,
					createdProducts: true,
					updatedProducts: true,
					catalog: { select: { id: true, name: true, slug: true } }
				}
			}),
			this.prisma.integration.count()
		])

		return { items, total, page, limit }
	}

	async triggerSync(catalogId: string) {
		const integration = await this.prisma.integration.findFirst({
			where: { catalogId, isActive: true }
		})
		if (!integration) {
			throw new NotFoundException('Активная интеграция для каталога не найдена')
		}

		return this.moyskladQueue.enqueueCatalogSync(catalogId)
	}

	async listSyncRuns(catalogId: string, page: number, limit: number) {
		const skip = (page - 1) * limit
		const [items, total] = await this.prisma.$transaction([
			this.prisma.integrationSyncRun.findMany({
				where: { catalogId },
				skip,
				take: limit,
				orderBy: { requestedAt: 'desc' },
				select: {
					id: true,
					provider: true,
					mode: true,
					trigger: true,
					status: true,
					error: true,
					totalProducts: true,
					createdProducts: true,
					updatedProducts: true,
					deletedProducts: true,
					durationMs: true,
					requestedAt: true,
					startedAt: true,
					finishedAt: true
				}
			}),
			this.prisma.integrationSyncRun.count({ where: { catalogId } })
		])

		return { items, total, page, limit }
	}

	// ─── Platform stats ───────────────────────────────────────────────────────

	async getPlatformStats() {
		const [
			totalCatalogs,
			activeCatalogs,
			totalUsers,
			totalOrders,
			completedOrders,
			revenue
		] = await this.prisma.$transaction([
			this.prisma.catalog.count({ where: { deleteAt: null } }),
			this.prisma.catalog.count({
				where: {
					deleteAt: null,
					config: { status: CatalogStatus.OPERATIONAL }
				}
			}),
			this.prisma.user.count({ where: { deleteAt: null } }),
			this.prisma.order.count(),
			this.prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
			this.prisma.order.aggregate({
				where: { status: OrderStatus.COMPLETED },
				_sum: { totalAmount: true }
			})
		])

		return {
			catalogs: { total: totalCatalogs, active: activeCatalogs },
			users: { total: totalUsers },
			orders: {
				total: totalOrders,
				completed: completedOrders,
				conversionRate:
					totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0
			},
			revenue: { total: revenue._sum.totalAmount ?? 0 }
		}
	}
}
