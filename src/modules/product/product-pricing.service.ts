import { Injectable } from '@nestjs/common'

import {
	type PriceLineInput,
	type ResolvedLinePricing,
	resolveLinePricing
} from '@/shared/order/price-resolver.utils'

@Injectable()
export class ProductPricingService {
	resolveLinePrice(input: PriceLineInput): ResolvedLinePricing {
		return resolveLinePricing(input)
	}
}
