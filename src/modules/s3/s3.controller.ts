import { Role } from '@generated/enums'
import {
	BadRequestException,
	Body,
	Controller,
	Get,
	MessageEvent,
	Param,
	Post,
	Sse,
	UseGuards
} from '@nestjs/common'
import {
	ApiBadRequestResponse,
	ApiBody,
	ApiCreatedResponse,
	ApiExtraModels,
	ApiForbiddenResponse,
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiSecurity,
	ApiTags,
	getSchemaPath
} from '@nestjs/swagger'
import { from, interval, type Observable } from 'rxjs'
import { map, startWith, switchMap, takeWhile } from 'rxjs/operators'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'

import { MultipartAbortDtoReq } from './dto/requests/multipart-abort.dto.req'
import { MultipartCompleteDtoReq } from './dto/requests/multipart-complete.dto.req'
import { MultipartPartDtoReq } from './dto/requests/multipart-part.dto.req'
import { MultipartStartDtoReq } from './dto/requests/multipart-start.dto.req'
import { PresignPostUploadDtoReq } from './dto/requests/presign-post-upload.dto.req'
import { PresignUploadDtoReq } from './dto/requests/presign-upload.dto.req'
import {
	UploadFromS3DtoReq,
	UploadFromS3ItemDtoReq
} from './dto/requests/upload-from-s3.dto.req'
import { MultipartCompleteResponseDto } from './dto/responses/multipart-complete.dto.res'
import { MultipartPartResponseDto } from './dto/responses/multipart-part.dto.res'
import { MultipartStartResponseDto } from './dto/responses/multipart-start.dto.res'
import { PresignPostUploadResponseDto } from './dto/responses/presign-post-upload.dto.res'
import { PresignUploadResponseDto } from './dto/responses/presign-upload.dto.res'
import {
	UploadQueueResponseDto,
	UploadQueueStatusDto
} from './dto/responses/upload-queue.dto.res'
import { S3Service } from './s3.service'

@ApiTags('S3')
@Controller('s3')
export class S3Controller {
	constructor(private readonly s3Service: S3Service) {}

	@Post('/images/presign')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Получить presigned URL для загрузки' })
	@ApiCreatedResponse({
		description: 'Presigned URL создан',
		type: PresignUploadResponseDto
	})
	@ApiBadRequestResponse({ description: 'Ошибка запроса' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async presignUpload(@Body() dto: PresignUploadDtoReq) {
		return this.s3Service.createPresignedUpload(dto.contentType, dto)
	}

	@Post('/images/presign-post')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Получить presigned POST для загрузки с лимитом размера'
	})
	@ApiCreatedResponse({
		description: 'Presigned POST создан',
		type: PresignPostUploadResponseDto
	})
	@ApiBadRequestResponse({ description: 'Ошибка запроса' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async presignPostUpload(@Body() dto: PresignPostUploadDtoReq) {
		return this.s3Service.createPresignedPost(
			dto.contentType,
			dto,
			dto.contentLength
		)
	}

	@Post('/images/multipart/start')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Начать multipart загрузку' })
	@ApiCreatedResponse({
		description: 'Multipart загрузка создана',
		type: MultipartStartResponseDto
	})
	@ApiBadRequestResponse({ description: 'Ошибка запроса' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async startMultipart(@Body() dto: MultipartStartDtoReq) {
		return this.s3Service.startMultipartUpload(dto)
	}

	@Post('/images/multipart/part')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Получить URL для загрузки части' })
	@ApiCreatedResponse({
		description: 'URL для части создан',
		type: MultipartPartResponseDto
	})
	@ApiBadRequestResponse({ description: 'Ошибка запроса' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async presignMultipartPart(@Body() dto: MultipartPartDtoReq) {
		return this.s3Service.createMultipartPartUrl(
			dto.key,
			dto.uploadId,
			dto.partNumber
		)
	}

	@Post('/images/multipart/complete')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Завершить multipart загрузку и поставить обработку в очередь'
	})
	@ApiCreatedResponse({
		description: 'Multipart загрузка завершена, очередь создана',
		type: MultipartCompleteResponseDto
	})
	@ApiBadRequestResponse({ description: 'Ошибка запроса' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async completeMultipart(@Body() dto: MultipartCompleteDtoReq) {
		return this.s3Service.completeMultipartUpload(dto)
	}

	@Post('/images/multipart/abort')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Отменить multipart загрузку' })
	@ApiCreatedResponse({ description: 'Multipart загрузка отменена' })
	@ApiBadRequestResponse({ description: 'Ошибка запроса' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async abortMultipart(@Body() dto: MultipartAbortDtoReq) {
		return this.s3Service.abortMultipartUpload(dto.key, dto.uploadId)
	}

	@Post('/images/queue/complete')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Поставить в очередь обработку загруженных файлов',
		description: 'Поддерживаются оба формата тела запроса: key или items.'
	})
	@ApiExtraModels(UploadFromS3ItemDtoReq)
	@ApiBody({
		schema: {
			oneOf: [
				{
					type: 'object',
					required: ['key'],
					properties: {
						key: {
							type: 'string',
							example: 'catalogs/catalog-id/products/2026/02/09/raw/uuid.jpg'
						}
					}
				},
				{
					type: 'object',
					required: ['items'],
					properties: {
						items: {
							type: 'array',
							items: { $ref: getSchemaPath(UploadFromS3ItemDtoReq) }
						}
					}
				}
			]
		}
	})
	@ApiCreatedResponse({
		description: 'Задания в очереди созданы',
		type: UploadQueueResponseDto
	})
	@ApiBadRequestResponse({ description: 'Ошибка запроса' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async enqueueFromS3(@Body() dto: UploadFromS3DtoReq) {
		const key = dto.key?.trim()
		const items = [...(dto.items ?? [])]
		if (key) {
			items.unshift({ key })
		}
		if (!items.length) {
			throw new BadRequestException('Список ключей пуст')
		}
		return this.s3Service.enqueueFromS3(items)
	}

	@Get('/images/queue/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Статус загрузки изображений' })
	@ApiParam({ name: 'id', description: 'ID задания очереди' })
	@ApiOkResponse({
		description: 'Статус очереди',
		type: UploadQueueStatusDto
	})
	@ApiBadRequestResponse({ description: 'Некорректный запрос' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async getQueueStatus(@Param('id') id: string) {
		return this.s3Service.getUploadStatus(id)
	}

	@Sse('/images/queue/:id/stream')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Стрим статуса загрузки (SSE)' })
	@ApiParam({ name: 'id', description: 'ID задания очереди' })
	@ApiOkResponse({
		description: 'Стрим статуса очереди',
		type: UploadQueueStatusDto
	})
	streamQueue(@Param('id') id: string): Observable<MessageEvent> {
		return interval(1000).pipe(
			startWith(0),
			switchMap(() => from(this.s3Service.getUploadStatus(id))),
			map(status => ({ data: status }) as MessageEvent),
			takeWhile(event => {
				const status = (event.data as UploadQueueStatusDto).status
				return status !== 'completed' && status !== 'failed'
			}, true)
		)
	}
}
