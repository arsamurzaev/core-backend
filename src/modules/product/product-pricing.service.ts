import { Injectable } from '@nestjs/common'

import {
	type PriceLineInput,
	type ResolvedLinePricing,
	resolveLinePricing
} from '@/shared/order/price-resolver.utils'

import type { ProductPricingPort } from './contracts'

@Injectable()
export class ProductPricingService implements ProductPricingPort {
	resolveLinePrice(input: PriceLineInput): ResolvedLinePricing {
		return resolveLinePricing(input)
	}
}
