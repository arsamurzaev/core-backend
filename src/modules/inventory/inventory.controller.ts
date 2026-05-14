import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Query,
	Req,
	UseGuards
} from '@nestjs/common'
import {
	ApiCreatedResponse,
	ApiForbiddenResponse,
	ApiNotFoundResponse,
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiSecurity,
	ApiTags
} from '@nestjs/swagger'

import { CAPABILITY_INVENTORY_INTERNAL } from '@/modules/capability/capability.constants'
import { RequireCapability } from '@/modules/capability/decorators/require-capability.decorator'
import { CapabilityGuard } from '@/modules/capability/guards/capability.guard'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'
import type { AuthRequest } from '../auth/types/auth-request'

import { CreateInventoryStockAdjustmentDtoReq } from './dto/requests/create-inventory-stock-adjustment.dto.req'
import { CreateInventoryWarehouseDtoReq } from './dto/requests/create-inventory-warehouse.dto.req'
import { UpdateInventoryWarehouseDtoReq } from './dto/requests/update-inventory-warehouse.dto.req'
import {
	InventoryMovementDto,
	InventoryStockAdjustmentDto
} from './dto/responses/inventory-movement.dto.res'
import { InventoryReservationDto } from './dto/responses/inventory-reservation.dto.res'
import { InventoryStockBalanceDto } from './dto/responses/inventory-stock-balance.dto.res'
import { InventoryWarehouseDto } from './dto/responses/inventory-warehouse.dto.res'
import { InventoryService } from './inventory.service'

@ApiTags('Inventory')
@ApiSecurity('csrf')
@Roles(Role.CATALOG)
@RequireCapability(CAPABILITY_INVENTORY_INTERNAL)
@UseGuards(SessionGuard, CatalogAccessGuard, CapabilityGuard)
@Controller('catalog/current/inventory/warehouses')
export class InventoryController {
	constructor(private readonly inventoryService: InventoryService) {}

	@Get()
	@ApiOperation({ summary: 'List internal inventory warehouses' })
	@ApiOkResponse({ type: InventoryWarehouseDto, isArray: true })
	@ApiForbiddenResponse({ description: 'Internal inventory is not enabled' })
	async getWarehouses() {
		return this.inventoryService.getWarehouses()
	}

	@Get('/:id')
	@ApiOperation({ summary: 'Get internal inventory warehouse' })
	@ApiParam({ name: 'id', description: 'Inventory warehouse ID' })
	@ApiOkResponse({ type: InventoryWarehouseDto })
	@ApiNotFoundResponse({ description: 'Inventory warehouse not found' })
	@ApiForbiddenResponse({ description: 'Internal inventory is not enabled' })
	async getWarehouseById(@Param('id') id: string) {
		return this.inventoryService.getWarehouseById(id)
	}

	@Post()
	@ApiOperation({ summary: 'Create internal inventory warehouse' })
	@ApiCreatedResponse({ type: InventoryWarehouseDto })
	@ApiForbiddenResponse({ description: 'Internal inventory is not enabled' })
	async createWarehouse(@Body() dto: CreateInventoryWarehouseDtoReq) {
		return this.inventoryService.createWarehouse(dto)
	}

	@Patch('/:id')
	@ApiOperation({ summary: 'Update internal inventory warehouse' })
	@ApiParam({ name: 'id', description: 'Inventory warehouse ID' })
	@ApiOkResponse({ type: InventoryWarehouseDto })
	@ApiNotFoundResponse({ description: 'Inventory warehouse not found' })
	@ApiForbiddenResponse({ description: 'Internal inventory is not enabled' })
	async updateWarehouse(
		@Param('id') id: string,
		@Body() dto: UpdateInventoryWarehouseDtoReq
	) {
		return this.inventoryService.updateWarehouse(id, dto)
	}

	@Get('/:id/balances')
	@ApiOperation({
		summary: 'List stock balances for internal inventory warehouse'
	})
	@ApiParam({ name: 'id', description: 'Inventory warehouse ID' })
	@ApiOkResponse({ type: InventoryStockBalanceDto, isArray: true })
	@ApiNotFoundResponse({ description: 'Inventory warehouse not found' })
	@ApiForbiddenResponse({ description: 'Internal inventory is not enabled' })
	async getWarehouseBalances(@Param('id') id: string) {
		return this.inventoryService.getWarehouseBalances(id)
	}

	@Get('/:id/movements')
	@ApiOperation({
		summary: 'List movement journal for internal inventory warehouse'
	})
	@ApiParam({ name: 'id', description: 'Inventory warehouse ID' })
	@ApiOkResponse({ type: InventoryMovementDto, isArray: true })
	@ApiNotFoundResponse({ description: 'Inventory warehouse not found' })
	@ApiForbiddenResponse({ description: 'Internal inventory is not enabled' })
	async getWarehouseMovements(
		@Param('id') id: string,
		@Query('limit') limit?: number | string
	) {
		return this.inventoryService.getWarehouseMovements(id, limit)
	}

	@Get('/:id/reservations')
	@ApiOperation({
		summary: 'List reservations for internal inventory warehouse'
	})
	@ApiParam({ name: 'id', description: 'Inventory warehouse ID' })
	@ApiOkResponse({ type: InventoryReservationDto, isArray: true })
	@ApiNotFoundResponse({ description: 'Inventory warehouse not found' })
	@ApiForbiddenResponse({ description: 'Internal inventory is not enabled' })
	async getWarehouseReservations(
		@Param('id') id: string,
		@Query('limit') limit?: number | string
	) {
		return this.inventoryService.getWarehouseReservations(id, limit)
	}

	@Post('/:id/adjustments')
	@ApiOperation({
		summary: 'Create manual stock movement for internal inventory'
	})
	@ApiParam({ name: 'id', description: 'Inventory warehouse ID' })
	@ApiCreatedResponse({ type: InventoryStockAdjustmentDto })
	@ApiNotFoundResponse({
		description: 'Inventory warehouse or variant not found'
	})
	@ApiForbiddenResponse({ description: 'Internal inventory is not enabled' })
	async adjustWarehouseStock(
		@Param('id') id: string,
		@Body() dto: CreateInventoryStockAdjustmentDtoReq,
		@Req() req: AuthRequest
	) {
		return this.inventoryService.adjustWarehouseStock(id, dto, req)
	}

	@Delete('/:id')
	@ApiOperation({ summary: 'Delete internal inventory warehouse' })
	@ApiParam({ name: 'id', description: 'Inventory warehouse ID' })
	@ApiOkResponse({ type: OkResponseDto })
	@ApiNotFoundResponse({ description: 'Inventory warehouse not found' })
	@ApiForbiddenResponse({ description: 'Internal inventory is not enabled' })
	async removeWarehouse(@Param('id') id: string) {
		return this.inventoryService.removeWarehouse(id)
	}
}
