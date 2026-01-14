import { Controller } from '@nestjs/common';
import { MetricService } from './metric.service';

@Controller('metric')
export class MetricController {
  constructor(private readonly metricService: MetricService) {}
}
