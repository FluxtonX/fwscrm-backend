import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentOrgId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    // Resolves from authenticated user context (Phase 2) or custom header fallback for dev/testing
    return (
      request.user?.organizationId ||
      request.headers['x-organization-id'] ||
      'default-org'
    );
  },
);
