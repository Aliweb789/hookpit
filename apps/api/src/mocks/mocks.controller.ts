import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { MockError, MockInput, MocksService } from './mocks.service';

// Turn our own error type into the matching HTTP error.
function toHttp(err: unknown): never {
  if (err instanceof MockError) {
    if (err.code === 'not_found') throw new NotFoundException(err.message);
    throw new BadRequestException(err.message);
  }
  throw err;
}

@Controller('api/endpoints/:slug/mocks')
export class MocksController {
  constructor(private readonly mocks: MocksService) {}

  @Get()
  list(@Param('slug') slug: string) {
    try {
      return this.mocks.list(slug);
    } catch (e) {
      return toHttp(e);
    }
  }

  @Post()
  create(@Param('slug') slug: string, @Body() body: MockInput) {
    try {
      return this.mocks.create(slug, body);
    } catch (e) {
      return toHttp(e);
    }
  }

  @Put(':id')
  update(@Param('slug') slug: string, @Param('id') id: string, @Body() body: MockInput) {
    try {
      return this.mocks.update(slug, id, body);
    } catch (e) {
      return toHttp(e);
    }
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('slug') slug: string, @Param('id') id: string) {
    try {
      this.mocks.remove(slug, id);
    } catch (e) {
      toHttp(e);
    }
  }
}
