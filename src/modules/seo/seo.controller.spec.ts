import { Test, TestingModule } from '@nestjs/testing';
import { SeoController } from './seo.controller';
import { SeoService } from './seo.service';

describe('SeoController', () => {
  let controller: SeoController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SeoController],
      providers: [SeoService],
    }).compile();

    controller = module.get<SeoController>(SeoController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
