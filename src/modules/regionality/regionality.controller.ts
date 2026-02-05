import { Controller } from '@nestjs/common'

import { RegionalityService } from './regionality.service'

@Controller('regionality')
export class RegionalityController {
	constructor(private readonly regionalityService: RegionalityService) {}
}
