export type AnyFunction = (...args: any[]) => any;
export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
