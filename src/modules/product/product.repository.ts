import { Injectable } from '@nestjs/common'


@Injectable()
export class ProductRepository {
	constructor() {}

	findBySlug(slug: string) {}
}
