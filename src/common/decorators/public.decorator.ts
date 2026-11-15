import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marca uma rota como pública (sem token). Use só para health-check. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
