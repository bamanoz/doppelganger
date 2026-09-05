export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]

export interface JsonValueLimits {
  readonly maximumBytes: number
  readonly maximumDepth: number
}

export function isJsonObjectPrototype(prototype: object | null): boolean {
  if (prototype === null || prototype === Object.prototype) return true
  if (Object.getPrototypeOf(prototype) !== null) return false
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')
  if (constructor === undefined || !('value' in constructor) || typeof constructor.value !== 'function') return false
  return constructor.value.name === 'Object'
    && Function.prototype.toString.call(constructor.value).includes('[native code]')
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`
}

function cloneValue(
  input: unknown,
  label: string,
  maximumDepth: number,
  seen: WeakSet<object>,
  depth: number,
): JsonValue {
  if (depth > maximumDepth) throw new TypeError(`${label} exceeds maximum depth ${maximumDepth}`)
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new TypeError(`${label} contains a non-finite number`)
    return input
  }
  if (typeof input !== 'object') throw new TypeError(`${label} must be JSON-compatible`)
  if (seen.has(input)) throw new TypeError(`${label} must not contain cycles`)
  if (Object.getOwnPropertySymbols(input).length > 0) throw new TypeError(`${label} must not contain symbol properties`)

  seen.add(input)
  try {
    if (Array.isArray(input)) {
      const descriptors = Object.getOwnPropertyDescriptors(input)
      const names = Object.getOwnPropertyNames(input)
      if (names.length !== input.length + 1 || names.some(name => name !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(name))) {
        throw new TypeError(`${label} must contain a dense JSON array without extra properties`)
      }
      const result: JsonValue[] = []
      for (let index = 0; index < input.length; index += 1) {
        const descriptor = descriptors[String(index)]
        if (descriptor === undefined) throw new TypeError(`${label} must not contain sparse arrays`)
        if (!('value' in descriptor)) throw new TypeError(`${label}[${index}] must not be an accessor`)
        if (descriptor.enumerable !== true) throw new TypeError(`${label}[${index}] must be enumerable`)
        result.push(cloneValue(descriptor.value, `${label}[${index}]`, maximumDepth, seen, depth + 1))
      }
      return Object.freeze(result)
    }

    const prototype = Object.getPrototypeOf(input)
    if (!isJsonObjectPrototype(prototype)) {
      throw new TypeError(`${label} must contain only JSON objects`)
    }
    const result = Object.create(null) as Record<string, JsonValue>
    const descriptors = Object.getOwnPropertyDescriptors(input)
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key]!
      const path = propertyPath(label, key)
      if (!('value' in descriptor)) throw new TypeError(`${path} must not be an accessor`)
      if (descriptor.enumerable !== true) throw new TypeError(`${path} must be enumerable`)
      Object.defineProperty(result, key, {
        value: cloneValue(descriptor.value, path, maximumDepth, seen, depth + 1),
        enumerable: true,
        configurable: false,
        writable: false,
      })
    }
    return Object.freeze(result)
  } finally {
    seen.delete(input)
  }
}

export function cloneJsonValue<T extends JsonValue>(
  input: unknown,
  label: string,
  limits: JsonValueLimits,
): T {
  if (!Number.isSafeInteger(limits.maximumDepth) || limits.maximumDepth < 0) {
    throw new TypeError('JSON maximumDepth must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(limits.maximumBytes) || limits.maximumBytes <= 0) {
    throw new TypeError('JSON maximumBytes must be a positive safe integer')
  }
  const value = cloneValue(input, label, limits.maximumDepth, new WeakSet(), 0)
  const encoded = JSON.stringify(value)
  if (Buffer.byteLength(encoded, 'utf8') > limits.maximumBytes) {
    throw new TypeError(`${label} exceeds ${limits.maximumBytes} bytes`)
  }
  return value as T
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Readonly<Record<string, JsonValue>>
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`)
    .join(',')}}`
}
