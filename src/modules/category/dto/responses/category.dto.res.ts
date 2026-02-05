import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

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

	@ApiProperty({ type: String })
	imageUrl: string

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

	@ApiProperty({ type: String })
	imageUrl: string
}

export class CategoryProductDto {
	@ApiProperty({ type: String })
	productId: string

	@ApiProperty({ type: Number })
	position: number
}

export class CategoryWithRelationsDto extends CategoryDto {
	@ApiPropertyOptional({ type: CategoryParentDto, nullable: true })
	parent?: CategoryParentDto | null

	@ApiProperty({ type: [CategoryChildDto] })
	children: CategoryChildDto[]

	@ApiProperty({ type: [CategoryProductDto] })
	products: CategoryProductDto[]
}
