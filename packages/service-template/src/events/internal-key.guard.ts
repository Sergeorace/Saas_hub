import { timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { SERVICE_CONFIG, type ServiceConfig } from '../config';
import { readHeader, type TenantRequest } from '../tenant/tenant.guard';

/** Protège /internal/* : clé partagée entre services, jamais exposée aux clients. */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(@Inject(SERVICE_CONFIG) private readonly config: ServiceConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const provided = readHeader(request, 'x-internal-key') ?? '';
    const expected = this.config.internalApiKey;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException({
        code: 'invalid_internal_key',
        message: 'Clé interne invalide.',
      });
    }
    return true;
  }
}
