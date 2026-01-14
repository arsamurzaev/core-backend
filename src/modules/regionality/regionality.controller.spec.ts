import { Test, TestingModule } from '@nestjs/testing';
import { RegionalityController } from './regionality.controller';
import { RegionalityService } from './regionality.service';

describe('RegionalityController', () => {
  let controller: RegionalityController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RegionalityController],
      providers: [RegionalityService],
    }).compile();

    controller = module.get<RegionalityController>(RegionalityController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
