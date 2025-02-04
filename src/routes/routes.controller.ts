// src/routes/routes.controller.ts
import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { RoutesService } from './routes.service';

@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Post('compute')
  async computeRoutes(@Body() body: any): Promise<any> {
    // Llama al servicio para obtener las rutas según el objeto recibido
    return this.routesService.getRoutes(body);
  }

  @Get('distance')
  async getDistance(@Query() query: any): Promise<any> {
    // Llama al servicio para obtener la distancia utilizando los parámetros de consulta
    return this.routesService.getDistance(query);
  }
}
