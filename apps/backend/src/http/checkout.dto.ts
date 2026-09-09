import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import type { CartItem, CheckoutRequest } from '@core/shared';

/**
 * Linea del carrito tal como llega en el cuerpo (BC-R2.2).
 *
 * `implements CartItem` no es decorativo: es la comprobacion en compilacion de que la
 * clase decorada no se separa del contrato compartido. Si `CartItem` cambia de forma,
 * `tsc` falla aqui y no en runtime contra un cuerpo ya validado.
 */
export class CartItemDto implements CartItem {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  // Entero estrictamente mayor a 0: `Min(1)` sobre un `IsInt` es exactamente `> 0`.
  @IsInt()
  @Min(1)
  quantity!: number;
}

/**
 * Cuerpo unico de `POST /api/checkout/preview` y `POST /api/checkout` (BC-R2.1, BC-R2.4).
 *
 * Declara **solo** lineas y cupon. No existe campo donde el cliente pueda mandar un
 * subtotal, un descuento ni un total: con `forbidNonWhitelisted` activo en el
 * `ValidationPipe` global, intentarlo devuelve `400` sin llegar al servicio (BC-R2.3).
 * Es la parte del contrato que hace estructuralmente imposible que el cliente influya en
 * los montos.
 *
 * `@Type` es obligatorio para que `@ValidateNested` valide instancias de `CartItemDto` y
 * no objetos planos: sin el, las reglas de la linea no se ejecutan.
 */
export class CheckoutRequestDto implements CheckoutRequest {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  couponCode?: string;
}
