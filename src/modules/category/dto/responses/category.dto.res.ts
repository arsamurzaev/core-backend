import { ApiProperty } from '@nestjs/swagger'

import { ProductWithAttributesDto } from '@/modules/product/dto/responses/product.dto.res'
import { MediaDto } from '@/shared/media/dto/media.dto.res'

export class CategoryDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: String, nullable: true })
	parentId: string | null

	@ApiProperty({ type: Number })
	position: number

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: MediaDto, nullable: true })
	imageMedia: MediaDto | null

	@ApiProperty({ type: String, nullable: true })
	descriptor: string | null

	@ApiProperty({ type: Number, nullable: true })
	discount: number | null

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}

export class CategoryParentDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string
}

export class CategoryChildDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String, nullable: true })
	parentId: string | null

	@ApiProperty({ type: Number })
	position: number

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: MediaDto, nullable: true })
	imageMedia: MediaDto | null
}

export class CategoryProductDto {
	@ApiProperty({ type: String })
	productId: string

	@ApiProperty({ type: Number })
	position: number
}

export class CategoryProductWithDetailsDto extends CategoryProductDto {
	@ApiProperty({ type: ProductWithAttributesDto })
	product: ProductWithAttributesDto
}

export class CategoryProductsPageDto {
	@ApiProperty({ type: [CategoryProductWithDetailsDto] })
	items: CategoryProductWithDetailsDto[]

	@ApiProperty({ type: String, nullable: true })
	nextCursor: string | null
}

export class CategoryWithRelationsDto extends CategoryDto {
	@ApiProperty({ type: CategoryParentDto, nullable: true })
	parent: CategoryParentDto | null

	@ApiProperty({ type: [CategoryChildDto] })
	children: CategoryChildDto[]
}
