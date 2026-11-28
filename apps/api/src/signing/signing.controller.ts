import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Put,
} from '@nestjs/common';
import { SigningError, SigningInput, SigningService } from './signing.service';

function toHttp(err: unknown): never {
  if (err instanceof SigningError) {
    if (err.code === 'not_found') throw new NotFoundException(err.message);
    throw new BadRequestException(err.message);
  }
  throw err;
}

// None of these responses ever contain the secret: it is write-only.
@Controller('api/endpoints/:slug/signing')
export class SigningController {
  constructor(private readonly signing: SigningService) {}

  @Get()
  get(@Param('slug') slug: string) {
    try {
      return this.signing.get(slug);
    } catch (e) {
      return toHttp(e);
    }
  }

  @Put()
  set(@Param('slug') slug: string, @Body() body: SigningInput) {
    try {
      return this.signing.set(slug, body);
    } catch (e) {
      return toHttp(e);
    }
  }

  @Delete()
  @HttpCode(204)
  clear(@Param('slug') slug: string) {
    try {
      this.signing.clear(slug);
    } catch (e) {
      toHttp(e);
    }
  }
}
