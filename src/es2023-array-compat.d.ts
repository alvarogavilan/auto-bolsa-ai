interface Array<T> {
  findLastIndex(
    predicate: (value: T, index: number, array: T[]) => unknown,
    thisArg?: unknown,
  ): number;
}

interface ReadonlyArray<T> {
  findLastIndex(
    predicate: (value: T, index: number, array: readonly T[]) => unknown,
    thisArg?: unknown,
  ): number;
}
