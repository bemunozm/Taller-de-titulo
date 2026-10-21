/**
 * Metadata de Nest de un handler de controller (`@UseGuards`,
 * `@RequirePermissions`, etc.), leída desde el descriptor del prototipo: así
 * el spec no referencia el método suelto (regla `unbound-method`). `undefined`
 * si el método no existe o no tiene esa metadata.
 */
export function handlerMetadata<T extends object>(
  controller: abstract new (...args: never[]) => T,
  method: keyof T & string,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(
    controller.prototype,
    method,
  );
  const handler: unknown = descriptor?.value;
  return typeof handler === 'function'
    ? (Reflect.getMetadata(key, handler) as unknown)
    : undefined;
}

/** Metadata de Nest de una clase (p. ej. los guards de `@UseGuards` de clase). */
export function classMetadata(target: object, key: string): unknown {
  return Reflect.getMetadata(key, target) as unknown;
}
