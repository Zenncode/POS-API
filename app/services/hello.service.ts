import type { HelloQueryDto } from '../../zod/hello.schema';

export async function getHello(dto: HelloQueryDto) {
  const name = dto.name?.trim() || 'World';
  return { message: `Hello, ${name}!`, timestamp: new Date().toISOString() };
}