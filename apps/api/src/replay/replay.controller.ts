import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  GatewayTimeoutException,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ReplayError, ReplayInput, ReplayService } from './replay.service';

@Controller()
export class ReplayController {
  constructor(private readonly replay: ReplayService) {}

  @Post('api/endpoints/:slug/requests/:id/replay')
  @HttpCode(200)
  async run(@Param('slug') slug: string, @Param('id') id: string, @Body() body: ReplayInput) {
    try {
      return await this.replay.replay(slug, id, body ?? ({} as ReplayInput));
    } catch (err) {
      if (!(err instanceof ReplayError)) throw err;
      switch (err.code) {
        case 'not_found':
          throw new NotFoundException(err.message);
        case 'invalid':
          throw new BadRequestException(err.message);
        case 'blocked':
          throw new ForbiddenException(err.message);
        case 'timeout':
          throw new GatewayTimeoutException(err.message);
        default:
          throw new BadGatewayException(err.message);
      }
    }
  }
}
