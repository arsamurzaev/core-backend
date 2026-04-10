import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
	UseGuards
} from '@nestjs/common'
import {
	ApiNoContentResponse,
	ApiOkResponse,
	ApiOperation,
	ApiSecurity,
	ApiTags
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { SessionGuard } from '@/modules/auth/guards/session.guard'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { AdminService } from './admin.service'
import { AdminCatalogsQueryDto } from './dto/requests/admin-catalogs-query.dto'
import { AdminOrdersQueryDto } from './dto/requests/admin-orders-query.dto'
import { AdminPaginationDto } from './dto/requests/admin-pagination.dto'
import { AdminUpdateCatalogDto } from './dto/requests/admin-update-catalog.dto'
import { AdminUpdateOrderDto } from './dto/requests/admin-update-order.dto'
import { AdminUpdateUserRoleDto } from './dto/requests/admin-update-user-role.dto'
import { AdminUsersQueryDto } from './dto/requests/admin-users-query.dto'

@ApiTags('Admin')
@ApiSecurity('csrf')
@SkipThrottle()
@SkipCatalog()
@UseGuards(SessionGuard)
@Roles(Role.ADMIN)
@Controller('/admin')
export class AdminController {
	constructor(private readonly adminService: AdminService) {}

	// ─── Platform ─────────────────────────────────────────────────────────────

	@Get('/stats')
	@ApiOperation({ summary: 'Общая статистика платформы' })
	@ApiOkResponse()
	getPlatformStats() {
		return this.adminService.getPlatformStats()
	}

	// ─── Catalogs ─────────────────────────────────────────────────────────────

	@Get('/catalogs')
	@ApiOperation({ summary: 'Список каталогов' })
	@ApiOkResponse()
	listCatalogs(@Query() query: AdminCatalogsQueryDto) {
		return this.adminService.listCatalogs(query)
	}

	@Get('/catalogs/:id')
	@ApiOperation({ summary: 'Детали каталога' })
	@ApiOkResponse()
	getCatalog(@Param('id', ParseUUIDPipe) id: string) {
		return this.adminService.getCatalogById(id)
	}

	@Patch('/catalogs/:id')
	@ApiOperation({ summary: 'Обновить каталог' })
	@ApiOkResponse()
	updateCatalog(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: AdminUpdateCatalogDto
	) {
		return this.adminService.updateCatalog(id, dto)
	}

	@Post('/catalogs/:id/suspend')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Приостановить каталог' })
	@ApiOkResponse()
	suspendCatalog(@Param('id', ParseUUIDPipe) id: string) {
		return this.adminService.suspendCatalog(id)
	}

	@Post('/catalogs/:id/restore')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Восстановить каталог' })
	@ApiOkResponse()
	restoreCatalog(@Param('id', ParseUUIDPipe) id: string) {
		return this.adminService.restoreCatalog(id)
	}

	@Delete('/catalogs/:id')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Удалить каталог (soft delete)' })
	@ApiNoContentResponse()
	deleteCatalog(@Param('id', ParseUUIDPipe) id: string) {
		return this.adminService.deleteCatalog(id)
	}

	// ─── Users ────────────────────────────────────────────────────────────────

	@Get('/users')
	@ApiOperation({ summary: 'Список пользователей' })
	@ApiOkResponse()
	listUsers(@Query() query: AdminUsersQueryDto) {
		return this.adminService.listUsers(query)
	}

	@Get('/users/:id')
	@ApiOperation({ summary: 'Профиль пользователя + сессии' })
	@ApiOkResponse()
	getUser(@Param('id', ParseUUIDPipe) id: string) {
		return this.adminService.getUserById(id)
	}

	@Patch('/users/:id/role')
	@ApiOperation({ summary: 'Изменить роль пользователя' })
	@ApiOkResponse()
	updateUserRole(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: AdminUpdateUserRoleDto
	) {
		return this.adminService.updateUserRole(id, dto)
	}

	@Post('/users/:id/block')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Заблокировать пользователя + выкинуть из сессий' })
	@ApiOkResponse()
	blockUser(@Param('id', ParseUUIDPipe) id: string) {
		return this.adminService.blockUser(id)
	}

	@Post('/users/:id/unblock')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Разблокировать пользователя' })
	@ApiOkResponse()
	unblockUser(@Param('id', ParseUUIDPipe) id: string) {
		return this.adminService.unblockUser(id)
	}

	@Get('/users/:id/sessions')
	@ApiOperation({ summary: 'Активные сессии пользователя' })
	@ApiOkResponse()
	listUserSessions(@Param('id', ParseUUIDPipe) id: string) {
		return this.adminService.listUserSessions(id)
	}

	@Delete('/users/:id/sessions')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Завершить все сессии пользователя' })
	@ApiNoContentResponse()
	destroyUserSessions(@Param('id', ParseUUIDPipe) id: string) {
		return this.adminService.destroyUserSessions(id)
	}

	// ─── Orders ───────────────────────────────────────────────────────────────

	@Get('/orders')
	@ApiOperation({ summary: 'Все заказы платформы' })
	@ApiOkResponse()
	listOrders(@Query() query: AdminOrdersQueryDto) {
		return this.adminService.listOrders(query)
	}

	@Get('/orders/:id')
	@ApiOperation({ summary: 'Детали заказа' })
	@ApiOkResponse()
	getOrder(@Param('id', ParseUUIDPipe) id: string) {
		return this.adminService.getOrderById(id)
	}

	@Patch('/orders/:id')
	@ApiOperation({ summary: 'Обновить статус / комментарий заказа' })
	@ApiOkResponse()
	updateOrder(
		@Param('id', ParseUUIDPipe) id: string,
		@Body() dto: AdminUpdateOrderDto
	) {
		return this.adminService.updateOrder(id, dto)
	}

	// ─── Integrations ─────────────────────────────────────────────────────────

	@Get('/integrations')
	@ApiOperation({ summary: 'Все интеграции платформы' })
	@ApiOkResponse()
	listIntegrations(@Query() query: AdminPaginationDto) {
		return this.adminService.listIntegrations(query.page, query.limit)
	}

	@Post('/integrations/:catalogId/sync')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Запустить синхронизацию каталога' })
	@ApiOkResponse()
	triggerSync(@Param('catalogId', ParseUUIDPipe) catalogId: string) {
		return this.adminService.triggerSync(catalogId)
	}

	@Get('/integrations/:catalogId/runs')
	@ApiOperation({ summary: 'История синхронизаций каталога' })
	@ApiOkResponse()
	listSyncRuns(
		@Param('catalogId', ParseUUIDPipe) catalogId: string,
		@Query() query: AdminPaginationDto
	) {
		return this.adminService.listSyncRuns(catalogId, query.page, query.limit)
	}
}
