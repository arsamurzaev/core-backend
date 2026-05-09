import { ApiProperty } from '@nestjs/swagger'

export class CatalogYandexMetrikaDto {
	@ApiProperty({ type: String, nullable: true })
	counterId: string | null
}
