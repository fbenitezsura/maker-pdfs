// src/pdf/price.controller.ts
import { Controller, Post, Body, Res, HttpStatus } from '@nestjs/common';
import { PriceService } from './price.service';
import { Response } from 'express';

@Controller('price')
export class PriceController {
  constructor(private readonly PriceService: PriceService) {}

  @Post()
  async getPrice(@Body('kmInput') kmInput: string, @Res() res: Response) {
    try {
      // Llama al método getPrice del servicio, el cual implementa la lógica de cálculo
      const result = await this.PriceService.getPrice(kmInput);
      return res.status(HttpStatus.OK).json(result);
    } catch (error) {
      console.error(error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: error.message });
    }
  }
}
