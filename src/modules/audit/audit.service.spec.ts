import { Role } from '@generated/enums'
import { Test, TestingModule } from '@nestjs/testing'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { RequestContext } from '@/shared/tenancy/request-context'

import { AuditService } from './audit.service'

describe('AuditService', () => {
	let service: AuditService
	let prisma: { auditEvent: { create: jest.Mock } }

	beforeEach(async () => {
		prisma = {
			auditEvent: {
				create: jest.fn().mockResolvedValue({ id: 'audit-1' })
			}
		}

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AuditService,
				{
					provide: PrismaService,
					useValue: prisma
				}
			]
		}).compile()

		service = module.get(AuditService)
	})

	it('writes audit event with actor, request context, targets, and changes', async () => {
		await RequestContext.run(
			{
				requestId: 'req-1',
				host: 'catalog.test',
				catalogId: 'catalog-1'
			},
			() =>
				service.record({
					action: 'inventory.manual_movement.create',
					category: 'inventory',
					actor: {
						id: 'user-1',
						role: Role.CATALOG,
						login: 'owner',
						name: 'Owner'
					},
					targetType: 'INVENTORY_MOVEMENT',
					targetId: 'movement-1',
					changes: [
						{
							field: 'quantityOnHand',
							oldValue: 1,
							newValue: 6
						}
					],
					targets: [
						{
							targetType: 'INVENTORY_WAREHOUSE',
							targetId: 'warehouse-1',
							catalogId: 'catalog-1'
						}
					]
				})
		)

		expect(prisma.auditEvent.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				action: 'inventory.manual_movement.create',
				category: 'inventory',
				actorUserId: 'user-1',
				actorRole: Role.CATALOG,
				targetCatalogId: 'catalog-1',
				requestId: 'req-1',
				host: 'catalog.test',
				targets: {
					create: [expect.objectContaining({ targetId: 'warehouse-1' })]
				},
				changes: {
					create: [
						expect.objectContaining({
							field: 'quantityOnHand',
							oldValue: 1,
							newValue: 6
						})
					]
				}
			})
		})
	})

	it('does not throw when audit write fails', async () => {
		prisma.auditEvent.create.mockRejectedValueOnce(new Error('db down'))

		await expect(
			service.record({
				action: 'catalog.inventory_mode.enable_internal'
			})
		).resolves.toBeUndefined()
	})
})
