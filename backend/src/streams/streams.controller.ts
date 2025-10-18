import { Controller, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { StreamsService } from './streams.service';

import { AuthGuard } from 'src/auth/auth.guard';
import { AuthorizationGuard } from 'src/auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CameraViewGuard } from 'src/cameras/guards/camera-view.guard';

import { ApiTags, ApiOperation, ApiResponse, ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { WhepOfferDto } from './dto/whep-offer.dto';
import { WhepAnswerDto } from './dto/whep-answer.dto';

@ApiTags('streams')
@ApiBearerAuth()
@Controller('streams')
@UseGuards(AuthGuard, AuthorizationGuard)
export class StreamsController {
  constructor(private readonly streamsService: StreamsService) {}

  @Post('whep')
  @UseGuards(CameraViewGuard)
  // @RequirePermissions('streams.read')
  @ApiOperation({ summary: 'Negociar oferta WHEP y devolver la respuesta SDP desde el gateway de medios' })
  @ApiBody({ type: WhepOfferDto })
  @ApiResponse({ status: 200, description: 'Respuesta SDP devuelta', type: WhepAnswerDto })
  @ApiBadRequestResponse({ description: 'Entrada faltante o inválida' })
  @ApiUnauthorizedResponse({ description: 'No autorizado' })
  async whep(@Body() body: WhepOfferDto) {

    // body.cameraMount may be either a mountPath or an id; StreamsService will resolve appropriately
    return await this.streamsService.forwardOfferToMediaMtx(body.offer, body.cameraMount);
  }
}
