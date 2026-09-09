import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { CheckoutTotals, OrderConfirmation } from '@core/shared';

import { CheckoutService } from '../application/checkout.service';

import { CheckoutRequestDto } from './checkout.dto';

/**
 * Orquesta y nada mas (BC-R3.1, BC-R5.1): recibe el cuerpo ya validado por el
 * `ValidationPipe` global, delega en UNA sola llamada al caso de uso y devuelve su
 * promesa tal cual.
 *
 * Lo que este controlador deliberadamente NO hace:
 *
 * - **No invoca al motor de descuentos.** El calculo es del servicio; aqui no hay
 *   tasas, umbrales ni redondeo.
 * - **No orquesta transacciones** ni toca la persistencia: la atomicidad del decremento
 *   y la creacion vive detras del `PurchaseConfirmationPort` (BC-R5.1).
 * - **No tiene `try/catch`.** Los `DiscountDomainError` tipados suben al
 *   `ApiExceptionFilter`, unico traductor a HTTP del backend y dueno de la tabla
 *   exhaustiva de codigos (BC-R7.2). Capturarlos aqui solo podria degradar el codigo.
 * - **No transforma la respuesta.** Devolver el resultado del servicio sin remapear es
 *   lo que garantiza que el cuerpo respete `CheckoutTotals` y `OrderConfirmation` sin
 *   una segunda declaracion de su forma.
 */
@Controller('checkout') // con el prefijo global => /api/checkout
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /**
   * Desglose en vivo, sin efectos (BC-R3.1, BC-R3.3).
   *
   * El `@HttpCode(HttpStatus.OK)` no es cosmetico: el valor por defecto de Nest para un
   * `@Post()` es `201 Created`, y previsualizar no crea nada. Sin esta linea el endpoint
   * anunciaria un recurso creado que no existe, y el `200` del contrato tiene que ser
   * explicito precisamente por ese defecto del framework.
   *
   * Es un `POST` y no un `GET` porque el carrito viaja en el cuerpo: un carrito
   * arbitrario no cabe de forma razonable en la query string, y el DTO compartido con
   * `confirm` es lo que hace imposible que los dos endpoints acepten formas distintas
   * (BC-R2.4).
   */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() body: CheckoutRequestDto): Promise<CheckoutTotals> {
    return this.checkout.preview(body);
  }

  /**
   * Compra confirmada (BC-R5.1, BC-R5.5).
   *
   * Se queda con el `201 Created` por defecto de Nest, que aqui si es el correcto: la
   * respuesta describe una orden que acaba de persistirse. Por eso no lleva
   * `@HttpCode`: anotarlo seria repetir el defecto del framework.
   */
  @Post()
  confirm(@Body() body: CheckoutRequestDto): Promise<OrderConfirmation> {
    return this.checkout.confirm(body);
  }
}
